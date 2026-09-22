import { spawn } from "child_process";
import {
  createReadStream,
  createWriteStream,
  unlinkSync,
  existsSync,
  statSync,
  chmodSync,
} from "fs";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import { join } from "path";
import type { DatabaseConfig } from "../config/types.js";
import type { Job } from "../config/schema.js";
import { logger } from "../utils/logger.js";
import { formatBytes } from "../utils/format.js";
import { getLocalBackupDir, generateDumpFilename } from "../utils/paths.js";

export interface PgDumpOptions {
  dbConfig: DatabaseConfig;
  job: Job;
  timeout?: number;
}

export interface PgDumpResult {
  filePath: string;
  size: number;
}

const DEFAULT_TIMEOUT = 3600000; // 1 hour
/** Délai laissé à pg_dump pour s'arrêter proprement avant SIGKILL */
const KILL_GRACE_MS = 10000;
/** Permissions d'un dump : lecture/écriture par le propriétaire uniquement */
const DUMP_MODE = 0o600;

export async function runPgDump(options: PgDumpOptions): Promise<PgDumpResult> {
  const { dbConfig, job, timeout = DEFAULT_TIMEOUT } = options;
  const outputDir = getLocalBackupDir();
  const filename = generateDumpFilename(job.name, job.format, false, new Date());
  const outputPath = join(outputDir, filename);

  if (job.type === "tables" && (!job.tables || job.tables.length === 0)) {
    throw new Error(`Job '${job.name}' is of type 'tables' but declares no table`);
  }

  logger.info(`[${job.name}] Starting pg_dump...`);
  logger.debug(`[${job.name}] DB: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

  await spawnPgDump({ dbConfig, job, timeout, outputPath });

  // pg_dump peut sortir en code 0 tout en produisant un fichier vide (disque
  // plein, permissions). Un dump vide qui remonterait jusqu'à la rétention
  // ferait supprimer de bonnes sauvegardes : on refuse ici.
  const rawSize = statSync(outputPath).size;
  if (rawSize === 0) {
    safeUnlink(outputPath, job.name);
    throw new Error(`pg_dump produced an empty file for job '${job.name}'`);
  }

  chmodSync(outputPath, DUMP_MODE);

  if (!job.compress) {
    logger.info(`[${job.name}] pg_dump completed: ${outputPath} (${formatBytes(rawSize)})`);
    return { filePath: outputPath, size: rawSize };
  }

  const compressedPath = `${outputPath}.gz`;
  try {
    // Compression en flux : un dump de plusieurs Go ne doit jamais être
    // chargé intégralement en mémoire.
    await pipeline(
      createReadStream(outputPath),
      createGzip(),
      createWriteStream(compressedPath, { mode: DUMP_MODE })
    );
  } catch (error) {
    safeUnlink(compressedPath, job.name);
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[${job.name}] Compression failed, keeping uncompressed dump: ${message}`);
    logger.info(`[${job.name}] pg_dump completed: ${outputPath} (${formatBytes(rawSize)})`);
    return { filePath: outputPath, size: rawSize };
  }

  const compressedSize = statSync(compressedPath).size;
  if (compressedSize === 0) {
    safeUnlink(compressedPath, job.name);
    throw new Error(`Compression produced an empty file for job '${job.name}'`);
  }

  safeUnlink(outputPath, job.name);
  logger.info(
    `[${job.name}] pg_dump completed: ${compressedPath} (${formatBytes(compressedSize)})`
  );

  return { filePath: compressedPath, size: compressedSize };
}

function spawnPgDump(params: {
  dbConfig: DatabaseConfig;
  job: Job;
  timeout: number;
  outputPath: string;
}): Promise<void> {
  const { dbConfig, job, timeout, outputPath } = params;

  const args: string[] = [];
  args.push("-F", job.format === "custom" ? "c" : "p");
  args.push("-h", dbConfig.host);
  args.push("-p", dbConfig.port.toString());
  args.push("-d", dbConfig.database);
  args.push("-U", dbConfig.user);

  if (job.type === "tables" && job.tables) {
    for (const table of job.tables) {
      args.push("-t", table);
    }
  }

  args.push("--no-owner", "--no-acl");
  args.push("-f", outputPath);

  return new Promise((resolve, reject) => {
    // Le mot de passe passe par l'environnement : le mettre dans argv
    // l'exposerait à tout process capable de lire la table des processus.
    const pgDump = spawn("pg_dump", args, {
      env: { ...process.env, PGPASSWORD: dbConfig.password },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      logger.error(`[${job.name}] pg_dump exceeded ${timeout}ms, terminating...`);
      pgDump.kill("SIGTERM");
      // Si pg_dump ignore SIGTERM, on ne laisse pas le process traîner.
      killTimer = setTimeout(() => pgDump.kill("SIGKILL"), KILL_GRACE_MS);
    }, timeout);

    const cleanupTimers = () => {
      clearTimeout(timeoutId);
      if (killTimer) clearTimeout(killTimer);
    };

    let stderr = "";
    pgDump.stderr.on("data", (data) => {
      // Borne la mémoire même si pg_dump devient très bavard.
      if (stderr.length < 64 * 1024) stderr += data.toString();
    });
    pgDump.stdout.on("data", () => undefined);

    pgDump.on("close", (code, signal) => {
      cleanupTimers();
      if (settled) return;
      settled = true;

      if (timedOut) {
        safeUnlink(outputPath, job.name);
        reject(new Error(`pg_dump timeout after ${timeout}ms`));
        return;
      }

      if (code !== 0) {
        safeUnlink(outputPath, job.name);
        const errorMsg = stderr.trim() || `pg_dump exited with code ${code} (signal ${signal})`;
        logger.error(`[${job.name}] pg_dump failed: ${errorMsg}`);
        reject(new Error(`pg_dump failed with code ${code}: ${errorMsg}`));
        return;
      }

      if (!existsSync(outputPath)) {
        reject(new Error(`Output file was not created: ${outputPath}`));
        return;
      }

      resolve();
    });

    pgDump.on("error", (err) => {
      cleanupTimers();
      if (settled) return;
      settled = true;
      logger.error(`[${job.name}] Failed to spawn pg_dump: ${err.message}`);
      reject(new Error(`Failed to execute pg_dump: ${err.message}`));
    });
  });
}

function safeUnlink(path: string, jobName: string): void {
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch (err) {
    logger.warn(`[${jobName}] Failed to cleanup ${path}: ${err}`);
  }
}
