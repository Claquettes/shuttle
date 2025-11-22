import { readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { logger } from "../utils/logger.js";
import { getLocalBackupDir } from "../utils/paths.js";
import { listRemoteFiles, deleteRemoteFile } from "./sshTransfer.js";
import type { SSHConfig } from "../utils/env.js";
import type { Job } from "../config/schema.js";

export interface RetentionResult {
  localDeleted: number;
  remoteDeleted: number;
}

/**
 * Applique la rétention (keepLast) pour un job
 * Supprime les anciens fichiers localement et à distance
 */
export async function applyRetention(
  job: Job,
  sshConfig: SSHConfig,
  remoteJobDir: string
): Promise<RetentionResult> {
  const result: RetentionResult = {
    localDeleted: 0,
    remoteDeleted: 0,
  };

  // Rétention locale
  try {
    const localDeleted = applyLocalRetention(job);
    result.localDeleted = localDeleted;
  } catch (error) {
    logger.warn(`[${job.name}] Local retention failed: ${error}`);
  }

  // Rétention distante
  try {
    const remoteDeleted = await applyRemoteRetention(job, sshConfig, remoteJobDir);
    result.remoteDeleted = remoteDeleted;
  } catch (error) {
    logger.warn(`[${job.name}] Remote retention failed: ${error}`);
  }

  return result;
}

/**
 * Applique la rétention locale
 */
function applyLocalRetention(job: Job): number {
  const backupDir = getLocalBackupDir();
  const files = readdirSync(backupDir);

  // Filtrer les fichiers correspondant au job
  const jobFiles = files
    .filter((f) => f.startsWith(`${job.name}_`))
    .map((f) => ({
      name: f,
      path: join(backupDir, f),
      mtime: statSync(join(backupDir, f)).mtime,
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()); // Plus récent en premier

  // Garder les N derniers
  const toKeep = job.keepLast;
  if (jobFiles.length <= toKeep) {
    logger.debug(`[${job.name}] Local: ${jobFiles.length} files, keeping all (limit: ${toKeep})`);
    return 0;
  }

  const toDelete = jobFiles.slice(toKeep);
  let deleted = 0;

  for (const file of toDelete) {
    try {
      unlinkSync(file.path);
      deleted++;
      logger.debug(`[${job.name}] Deleted local file: ${file.name}`);
    } catch (error) {
      logger.warn(`[${job.name}] Failed to delete local file ${file.name}: ${error}`);
    }
  }

  logger.info(`[${job.name}] Local retention: deleted ${deleted} files, kept ${toKeep}`);

  return deleted;
}

/**
 * Applique la rétention distante
 */
async function applyRemoteRetention(
  job: Job,
  sshConfig: SSHConfig,
  remoteJobDir: string
): Promise<number> {
  try {
    const files = await listRemoteFiles(remoteJobDir, sshConfig);

    // Filtrer les fichiers correspondant au job
    const jobFiles = files
      .filter((f) => f.startsWith(`${job.name}_`))
      .map((f) => ({
        name: f,
        // On ne peut pas obtenir mtime facilement via SFTP, on utilise le nom de fichier
        // Le format est: jobName_YYYY-MM-DDTHH-MM-SS.ext(.gz)
        timestamp: extractTimestamp(f),
      }))
      .filter((f): f is { name: string; timestamp: Date } => f.timestamp !== null)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()); // Plus récent en premier

    const toKeep = job.keepLast;
    if (jobFiles.length <= toKeep) {
      logger.debug(`[${job.name}] Remote: ${jobFiles.length} files, keeping all (limit: ${toKeep})`);
      return 0;
    }

    const toDelete = jobFiles.slice(toKeep);
    let deleted = 0;

    for (const file of toDelete) {
      try {
        const remotePath = join(remoteJobDir, file.name).replace(/\\/g, "/");
        await deleteRemoteFile(remotePath, sshConfig);
        deleted++;
        logger.debug(`[${job.name}] Deleted remote file: ${file.name}`);
      } catch (error) {
        logger.warn(`[${job.name}] Failed to delete remote file ${file.name}: ${error}`);
      }
    }

    logger.info(`[${job.name}] Remote retention: deleted ${deleted} files, kept ${toKeep}`);

    return deleted;
  } catch (error) {
    logger.error(`[${job.name}] Remote retention error: ${error}`);
    throw error;
  }
}

/**
 * Extrait le timestamp depuis le nom de fichier
 * Format attendu: jobName_YYYY-MM-DDTHH-MM-SS.ext(.gz)
 */
function extractTimestamp(filename: string): Date | null {
  // Pattern: jobName_YYYY-MM-DDTHH-MM-SS
  const match = filename.match(/_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
  if (!match) {
    return null;
  }

  try {
    // Convertir YYYY-MM-DDTHH-MM-SS en YYYY-MM-DDTHH:MM:SS
    const dateTimeStr = match[1];
    const parts = dateTimeStr.split("T");
    if (parts.length !== 2) {
      return null;
    }

    const datePart = parts[0]; // YYYY-MM-DD
    const timePart = parts[1].replace(/-/g, ":"); // HH-MM-SS -> HH:MM:SS
    const isoString = `${datePart}T${timePart}`;

    return new Date(isoString);
  } catch {
    return null;
  }
}

