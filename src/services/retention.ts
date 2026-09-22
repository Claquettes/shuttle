import { readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { logger } from "../utils/logger.js";
import { getLocalBackupDir } from "../utils/paths.js";
import { remotePathJoin } from "./sshTransfer.js";
import type { SftpSession } from "./sshTransfer.js";
import type { Job } from "../config/schema.js";

export interface RetentionResult {
  localDeleted: number;
  remoteDeleted: number;
}

export interface RetentionOptions {
  /**
   * Chemins de la sauvegarde qui vient d'être produite. La rétention ne doit
   * jamais les supprimer, quelle que soit l'horloge ou l'ordre de tri.
   */
  protectLocalPath?: string;
  protectRemotePath?: string;
}

interface RemoteBackup {
  name: string;
  path: string;
  timestamp: Date;
}

/**
 * Volontairement défensive : toute anomalie (listing impossible, horodatage
 * illisible, fichier protégé) fait renoncer à la suppression plutôt que de
 * risquer de détruire une sauvegarde valide.
 */
export async function applyRetention(
  job: Job,
  session: SftpSession,
  remoteJobDir: string,
  options: RetentionOptions = {}
): Promise<RetentionResult> {
  const result: RetentionResult = { localDeleted: 0, remoteDeleted: 0 };

  try {
    result.localDeleted = applyLocalRetention(job, options.protectLocalPath);
  } catch (error) {
    logger.warn(`[${job.name}] Local retention failed: ${error}`);
  }

  try {
    result.remoteDeleted = await applyRemoteRetention(
      job,
      session,
      remoteJobDir,
      options.protectRemotePath
    );
  } catch (error) {
    logger.warn(`[${job.name}] Remote retention failed: ${error}`);
  }

  return result;
}

function applyLocalRetention(job: Job, protectPath?: string): number {
  const backupDir = getLocalBackupDir();

  const jobFiles = readdirSync(backupDir)
    .filter((f) => belongsToJob(f, job.name))
    .map((f) => {
      const path = join(backupDir, f);
      return { name: f, path, stat: statSync(path) };
    })
    // Ne jamais toucher aux répertoires ni aux uploads en cours.
    .filter((f) => f.stat.isFile() && !f.name.endsWith(".part"))
    .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

  const toKeep = job.keepLast;
  if (jobFiles.length <= toKeep) {
    logger.debug(`[${job.name}] Local: ${jobFiles.length} files, keeping all (limit: ${toKeep})`);
    return 0;
  }

  const toDelete = jobFiles.slice(toKeep).filter((f) => f.path !== protectPath);
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

  logger.info(`[${job.name}] Local retention: deleted ${deleted} file(s), kept ${toKeep}`);

  return deleted;
}

/**
 * Les sauvegardes sont rangées dans `<remoteJobDir>/<YYYY-MM-DD>/<fichier>` :
 * il faut descendre dans les sous-répertoires de date, et non lister seulement
 * `remoteJobDir`.
 */
async function applyRemoteRetention(
  job: Job,
  session: SftpSession,
  remoteJobDir: string,
  protectPath?: string
): Promise<number> {
  const entries = await session.list(remoteJobDir);
  const backups: RemoteBackup[] = [];
  let unreadable = 0;

  for (const entry of entries) {
    if (entry.type === "d") {
      for (const child of await session.list(remotePathJoin(remoteJobDir, entry.name))) {
        if (child.type === "d") continue;
        collect(child.name, remotePathJoin(remoteJobDir, entry.name, child.name));
      }
      continue;
    }
    collect(entry.name, remotePathJoin(remoteJobDir, entry.name));
  }

  function collect(name: string, path: string): void {
    if (!belongsToJob(name, job.name)) return;
    // Un `.part` est un transfert interrompu : il ne compte pas comme une
    // sauvegarde, et il n'est pas supprimé ici (le transfert s'en charge).
    if (name.endsWith(".part")) return;

    const timestamp = extractTimestamp(name);
    if (!timestamp) {
      // On ne sait pas dater ce fichier : on refuse de le classer, donc de le
      // supprimer. Mieux vaut garder un fichier de trop qu'en perdre un bon.
      unreadable++;
      return;
    }
    backups.push({ name, path, timestamp });
  }

  if (unreadable > 0) {
    logger.warn(
      `[${job.name}] Remote: ${unreadable} file(s) with an unreadable timestamp were left untouched`
    );
  }

  backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const toKeep = job.keepLast;
  if (backups.length <= toKeep) {
    logger.debug(`[${job.name}] Remote: ${backups.length} backups, keeping all (limit: ${toKeep})`);
    return 0;
  }

  const toDelete = backups.slice(toKeep).filter((f) => f.path !== protectPath);
  let deleted = 0;

  for (const file of toDelete) {
    try {
      await session.delete(file.path);
      deleted++;
    } catch (error) {
      logger.warn(`[${job.name}] Failed to delete remote file ${file.path}: ${error}`);
    }
  }

  logger.info(`[${job.name}] Remote retention: deleted ${deleted} file(s), kept ${toKeep}`);

  return deleted;
}

/**
 * Un fichier appartient au job si son nom est exactement `<job>_<horodatage>...`.
 * Le séparateur explicite évite qu'un job `full` s'approprie les fichiers de
 * `full-nightly`.
 */
function belongsToJob(filename: string, jobName: string): boolean {
  return filename.startsWith(`${jobName}_`);
}

/**
 * Les noms de fichiers sont horodatés en UTC (`toISOString`) : on parse en UTC
 * pour que la comparaison reste correcte quel que soit le fuseau du process.
 */
export function extractTimestamp(filename: string): Date | null {
  const match = filename.match(/_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!match) {
    return null;
  }

  const [, datePart, hours, minutes, seconds] = match;
  const date = new Date(`${datePart}T${hours}:${minutes}:${seconds}Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}
