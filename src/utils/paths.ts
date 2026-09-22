import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";

export function resolvePath(relativePath: string): string {
  return resolve(process.cwd(), relativePath);
}

export function ensureDir(dirPath: string, mode?: number): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true, mode });
  }
}

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
