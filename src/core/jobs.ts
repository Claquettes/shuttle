import { basename } from "path";
import { runPgDump } from "../services/pgDump.js";
import { withSftp, remotePathJoin } from "../services/sshTransfer.js";
import { applyRetention } from "../services/retention.js";
import { sendBackupReport, getRunnerHostname } from "../services/emailReport.js";
import type { BackupReport } from "../services/emailReport.js";
import { logger } from "../utils/logger.js";
import type { Job } from "../config/schema.js";
import type { ResolvedConfig } from "../config/types.js";

export interface JobExecutionResult {
  jobName: string;
  success: boolean;
  dumpPath?: string;
  remotePath?: string;
  size?: number;
  durationMs?: number;
  error?: string;
  retention?: {
    localDeleted: number;
    remoteDeleted: number;
  };
}

/**
 * Exécute un job complet : dump, transfert, rétention, puis rapport email
 */
export async function executeJob(
  job: Job,
  resolvedConfig: ResolvedConfig
): Promise<JobExecutionResult> {
  const startedAt = new Date();
  const startTime = Date.now();
  logger.info(`[${job.name}] Starting job execution...`);

  const dbConfig = resolvedConfig.sourceDbConfig;
  const sshConfig = resolvedConfig.targetSshConfig;

  let artifact: BackupReport["artifact"];
  let retentionResult: { localDeleted: number; remoteDeleted: number } | undefined;

  try {
    const dumpResult = await runPgDump({
      dbConfig,
      job,
      timeout: job.timeout,
    });

    const remoteJobDir = remotePathJoin(sshConfig.basePath, job.name);
    const dateDir = new Date().toISOString().split("T")[0];
    const remoteDateDir = remotePathJoin(remoteJobDir, dateDir);

    // Une seule connexion SSH pour le transfert et la rétention : la rétention
    // ne s'exécute que si le transfert a été vérifié.
    const { transfer, retention } = await withSftp(sshConfig, async (session) => {
      const uploaded = await session.upload(dumpResult.filePath, remoteDateDir);
      const purged = await applyRetention(job, session, remoteJobDir, {
        protectLocalPath: dumpResult.filePath,
        protectRemotePath: uploaded.remotePath,
      });
      return { transfer: uploaded, retention: purged };
    });

    artifact = {
      filename: basename(dumpResult.filePath),
      localPath: dumpResult.filePath,
      remotePath: transfer.remotePath,
      size: transfer.size,
      format: job.format,
      compressed: dumpResult.filePath.endsWith(".gz"),
    };

    retentionResult = retention;

    const durationMs = Date.now() - startTime;
    logger.info(`[${job.name}] Job completed successfully in ${(durationMs / 1000).toFixed(2)}s`);

    await notify(resolvedConfig, {
      job,
      success: true,
      startedAt,
      durationMs,
      artifact,
      retention: retentionResult,
    });

    return {
      jobName: job.name,
      success: true,
      dumpPath: dumpResult.filePath,
      remotePath: transfer.remotePath,
      size: transfer.size,
      durationMs,
      retention: retentionResult,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startTime;
    logger.error(`[${job.name}] Job failed: ${errorMessage}`);

    await notify(resolvedConfig, {
      job,
      success: false,
      startedAt,
      durationMs,
      artifact,
      retention: retentionResult,
      error: errorMessage,
    });

    return {
      jobName: job.name,
      success: false,
      durationMs,
      error: errorMessage,
    };
  }
}

/**
 * Construit et envoie le rapport email si les notifications sont configurées.
 * Toute erreur d'envoi est absorbée : elle ne doit pas changer l'issue du job.
 */
async function notify(
  resolvedConfig: ResolvedConfig,
  params: {
    job: Job;
    success: boolean;
    startedAt: Date;
    durationMs: number;
    artifact?: BackupReport["artifact"];
    retention?: { localDeleted: number; remoteDeleted: number };
    error?: string;
  }
): Promise<void> {
  const emailConfig = resolvedConfig.config.shuttle.notifications?.email;
  if (!emailConfig) {
    return;
  }

  const { sourceDbConfig, targetSshConfig } = resolvedConfig;

  const report: BackupReport = {
    shuttleName: resolvedConfig.config.shuttle.name,
    jobName: params.job.name,
    jobType: params.job.type,
    tables: params.job.type === "tables" ? params.job.tables : undefined,
    success: params.success,
    startedAt: params.startedAt,
    durationMs: params.durationMs,
    error: params.error,
    source: {
      host: sourceDbConfig.host,
      port: sourceDbConfig.port,
      database: sourceDbConfig.database,
      user: sourceDbConfig.user,
    },
    runnerHostname: getRunnerHostname(),
    target: {
      host: targetSshConfig.host,
      port: targetSshConfig.port,
      user: targetSshConfig.user,
    },
    artifact: params.artifact,
    retention: params.retention,
  };

  try {
    await sendBackupReport(emailConfig, report);
  } catch (error) {
    logger.warn(`[${params.job.name}] Email report failed unexpectedly: ${error}`);
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
