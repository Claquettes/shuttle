import { join } from "path";
import { runPgDump } from "../services/pgDump.js";
import { transferFile } from "../services/sshTransfer.js";
import { applyRetention } from "../services/retention.js";
import { logger } from "../utils/logger.js";
import type { Job } from "../config/schema.js";
import type { ResolvedConfig } from "../config/types.js";

export interface JobExecutionResult {
  jobName: string;
  success: boolean;
  dumpPath?: string;
  remotePath?: string;
  error?: string;
  retention?: {
    localDeleted: number;
    remoteDeleted: number;
  };
}

/**
 * Exécute un job complet : dump, transfert, rétention
 */
export async function executeJob(
  job: Job,
  resolvedConfig: ResolvedConfig
): Promise<JobExecutionResult> {
  const startTime = Date.now();
  logger.info(`[${job.name}] Starting job execution...`);

  try {
    const dbConfig = resolvedConfig.sourceDbConfig;
    const sshConfig = resolvedConfig.targetSshConfig;

    const dumpResult = await runPgDump({
      dbConfig,
      job,
      timeout: job.timeout,
    });

    const remoteJobDir = join(sshConfig.basePath, job.name).replace(/\\/g, "/");
    const dateDir = new Date().toISOString().split("T")[0];
    const remoteDateDir = join(remoteJobDir, dateDir).replace(/\\/g, "/");

    const transferResult = await transferFile(dumpResult.filePath, remoteDateDir, sshConfig);
    const retentionResult = await applyRetention(job, sshConfig, remoteJobDir);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`[${job.name}] Job completed successfully in ${duration}s`);

    return {
      jobName: job.name,
      success: true,
      dumpPath: dumpResult.filePath,
      remotePath: transferResult.remotePath,
      retention: retentionResult,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[${job.name}] Job failed: ${errorMessage}`);

    return {
      jobName: job.name,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Exécute tous les jobs d'une configuration
 */
export async function executeAllJobs(
  resolvedConfig: ResolvedConfig
): Promise<JobExecutionResult[]> {
  const results: JobExecutionResult[] = [];

  for (const job of resolvedConfig.config.shuttle.jobs) {
    const result = await executeJob(job, resolvedConfig);
    results.push(result);
  }

  return results;
}

