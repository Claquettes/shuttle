import cron from "node-cron";
import type { ScheduledTask as CronTask } from "node-cron";
import { logger } from "../utils/logger.js";
import { executeJob } from "./jobs.js";
import type { ResolvedConfig } from "../config/types.js";
import type { Job } from "../config/schema.js";

export interface ScheduledJob {
  cronTask: CronTask;
  job: Job;
}

export interface JobCompletion {
  jobName: string;
  success: boolean;
  error?: string;
}

/**
 * Ensemble des jobs planifiés, avec suivi des exécutions en cours.
 */
export class Scheduler {
  private readonly scheduled: ScheduledJob[] = [];
  private readonly running = new Map<string, Promise<void>>();
  private stopping = false;

  get size(): number {
    return this.scheduled.length;
  }

  get runningCount(): number {
    return this.running.size;
  }

  add(scheduledJob: ScheduledJob): void {
    this.scheduled.push(scheduledJob);
  }

  /**
   * Lance un job en refusant tout chevauchement.
   *
   * Sans ce garde, un job plus lent que son intervalle cron (par exemple un
   * dump de 40 min planifié toutes les 30 min) serait relancé en parallèle :
   * deux pg_dump concurrents sur la production et deux passes de rétention
   * simultanées sur le même jeu de fichiers.
   */
  trigger(job: Job, resolvedConfig: ResolvedConfig, onComplete?: (r: JobCompletion) => void): void {
    if (this.stopping) {
      logger.warn(`[${job.name}] Shutdown in progress, skipping this run`);
      return;
    }

    if (this.running.has(job.name)) {
      logger.warn(
        `[${job.name}] Previous run is still in progress, skipping this trigger. ` +
          `Consider a longer cron interval or a shorter dump.`
      );
      return;
    }

    const execution = (async () => {
      try {
        const result = await executeJob(job, resolvedConfig);
        onComplete?.({
          jobName: result.jobName,
          success: result.success,
          error: result.error,
        });
      } catch (error) {
        // executeJob n'est pas censé rejeter, mais on ne laisse jamais une
        // rejection non gérée tuer le daemon.
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[${job.name}] Unexpected failure: ${message}`);
        onComplete?.({ jobName: job.name, success: false, error: message });
      } finally {
        this.running.delete(job.name);
      }
    })();

    this.running.set(job.name, execution);
  }

  /**
   * Désarme les crons puis attend la fin des exécutions en cours.
   * Interrompre un transfert en vol laisserait une sauvegarde incomplète.
   */
  async shutdown(timeoutMs: number): Promise<boolean> {
    this.stopping = true;

    logger.info(`Stopping ${this.scheduled.length} scheduled job(s)...`);
    for (const { cronTask, job } of this.scheduled) {
      await cronTask.stop();
      logger.debug(`[${job.name}] Stopped`);
    }

    if (this.running.size === 0) {
      return true;
    }

    const names = [...this.running.keys()].join(", ");
    logger.info(`Waiting up to ${Math.round(timeoutMs / 1000)}s for running job(s): ${names}`);

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });

    try {
      const completed = await Promise.race([
        Promise.allSettled([...this.running.values()]).then(() => true),
        timeout,
      ]);

      if (!completed) {
        logger.warn(
          `Timed out waiting for job(s): ${[...this.running.keys()].join(", ")}. ` +
            `A backup may be left incomplete on the remote server.`
        );
      }
      return completed;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Planifie tous les jobs d'une configuration selon leurs expressions cron
 */
export function scheduleJobs(
  resolvedConfig: ResolvedConfig,
  onJobComplete?: (result: JobCompletion) => void
): Scheduler {
  const scheduler = new Scheduler();

  logger.info(`Scheduling ${resolvedConfig.config.shuttle.jobs.length} job(s)...`);

  for (const job of resolvedConfig.config.shuttle.jobs) {
    try {
      if (!cron.validate(job.cron)) {
        logger.error(`[${job.name}] Invalid cron expression: ${job.cron}`);
        continue;
      }

      logger.info(`[${job.name}] Scheduling with cron: ${job.cron}`);

      const task = cron.schedule(
        job.cron,
        () => {
          logger.info(`[${job.name}] Cron triggered, executing job...`);
          scheduler.trigger(job, resolvedConfig, onJobComplete);
        },
        {
          name: job.name,
          timezone: resolvedConfig.config.shuttle.timezone || "UTC",
        }
      );

      scheduler.add({ cronTask: task, job });
    } catch (error) {
      logger.error(`[${job.name}] Failed to schedule job: ${error}`);
    }
  }

  logger.info(`Successfully scheduled ${scheduler.size} job(s)`);

  return scheduler;
}
