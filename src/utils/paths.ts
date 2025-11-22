import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync } from "fs";

/**
 * Gestion des chemins, notamment pour Docker
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Résout un chemin relatif depuis le répertoire de travail courant
 * ou depuis le répertoire du projet si en mode développement
 */
export function resolvePath(relativePath: string): string {
  return resolve(process.cwd(), relativePath);
}

/**
 * Trouve le répertoire contenant le fichier .apo
 */
export function findConfigDir(configPath: string): string {
  const resolved = resolvePath(configPath);
  return dirname(resolved);
}

/**
 * Crée un répertoire s'il n'existe pas
 */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
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
  const dateStr = date.toISOString().replace(/[:.]/g, "-").slice(0, -5); // YYYY-MM-DDTHH-MM-SS
  const ext = format === "custom" ? "dump" : "sql";
  const suffix = compress ? ".gz" : "";
  return `${jobName}_${dateStr}.${ext}${suffix}`;
}

/**
 * Retourne le répertoire local pour les dumps
 * Par défaut: ./backups dans le répertoire de travail
 */
export function getLocalBackupDir(): string {
  const dir = process.env.SHUTTLE_LOCAL_BACKUP_DIR || "./backups";
  const resolved = resolvePath(dir);
  ensureDir(resolved);
  return resolved;
}

