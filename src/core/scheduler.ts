import cron from "node-cron";
import { logger } from "../utils/logger.js";
import { executeJob } from "./jobs.js";
import type { ResolvedConfig } from "../config/types.js";
import type { Job } from "../config/schema.js";

export interface ScheduledJob {
  cronTask: cron.ScheduledTask;
  job: Job;
}

/**
 * Planifie tous les jobs d'une configuration selon leurs expressions cron
 */
export function scheduleJobs(
  resolvedConfig: ResolvedConfig,
  onJobComplete?: (result: { jobName: string; success: boolean; error?: string }) => void
): ScheduledJob[] {
  const scheduled: ScheduledJob[] = [];

  logger.info(`Scheduling ${resolvedConfig.config.shuttle.jobs.length} job(s)...`);

  for (const job of resolvedConfig.config.shuttle.jobs) {
    try {
      // Valider l'expression cron
      if (!cron.validate(job.cron)) {
        logger.error(`[${job.name}] Invalid cron expression: ${job.cron}`);
        continue;
      }

      logger.info(`[${job.name}] Scheduling with cron: ${job.cron}`);

      const task = cron.schedule(
        job.cron,
        async () => {
          logger.info(`[${job.name}] Cron triggered, executing job...`);
          const result = await executeJob(job, resolvedConfig);
          if (onJobComplete) {
            onJobComplete({
              jobName: result.jobName,
              success: result.success,
              error: result.error,
            });
          }
        },
        {
          scheduled: true,
          timezone: resolvedConfig.config.shuttle.timezone || "UTC",
        }
      );

      scheduled.push({
        cronTask: task,
        job,
      });
    } catch (error) {
      logger.error(`[${job.name}] Failed to schedule job: ${error}`);
    }
  }

  logger.info(`Successfully scheduled ${scheduled.length} job(s)`);

  return scheduled;
}

/**
 * Arrête tous les jobs planifiés
 */
export function stopScheduledJobs(scheduled: ScheduledJob[]): void {
  logger.info(`Stopping ${scheduled.length} scheduled job(s)...`);
  for (const { cronTask, job } of scheduled) {
    cronTask.stop();
    logger.debug(`[${job.name}] Stopped`);
  }
}

