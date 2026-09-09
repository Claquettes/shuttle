import { dirname, resolve } from "path";
import { existsSync, mkdirSync } from "fs";

export function resolvePath(relativePath: string): string {
  return resolve(process.cwd(), relativePath);
}

/**
 * Trouve le répertoire contenant le fichier de configuration
 */
export function findConfigDir(configPath: string): string {
  const resolved = resolvePath(configPath);
  return dirname(resolved);
}

/**
 * Crée un répertoire s'il n'existe pas
 */
export function ensureDir(dirPath: string, mode?: number): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true, mode });
  }
}

/**
 * Génère un nom de fichier de dump basé sur le job et la date
 */
export function generateDumpFilename(
  jobName: string,
  format: "plain" | "custom",
  compress: boolean,
  timestamp?: Date
): string {
  const date = timestamp || new Date();
  const dateStr = date.toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const ext = format === "custom" ? "dump" : "sql";
  const suffix = compress ? ".gz" : "";
  return `${jobName}_${dateStr}.${ext}${suffix}`;
}

export function getLocalBackupDir(): string {
  const dir = process.env.SHUTTLE_LOCAL_BACKUP_DIR || "./backups";
  const resolved = resolvePath(dir);
  // Les dumps contiennent la totalité des données de production : le
  // répertoire ne doit pas être lisible par les autres utilisateurs.
  ensureDir(resolved, 0o700);
  return resolved;
}
