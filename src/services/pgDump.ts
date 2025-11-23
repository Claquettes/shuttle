import { spawn } from "child_process";
import { writeFileSync, unlinkSync, existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { DatabaseConfig } from "../utils/env.js";
import type { Job } from "../config/schema.js";
import { logger } from "../utils/logger.js";
import { getLocalBackupDir, generateDumpFilename } from "../utils/paths.js";
import { gzipSync } from "zlib";

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

/**
 * Exécute pg_dump et génère un fichier de dump
 */
export async function runPgDump(options: PgDumpOptions): Promise<PgDumpResult> {
  const { dbConfig, job, timeout = DEFAULT_TIMEOUT } = options;
  const outputDir = getLocalBackupDir();
  const filename = generateDumpFilename(job.name, job.format, false, new Date());
  const outputPath = join(outputDir, filename);

  logger.info(`[${job.name}] Starting pg_dump...`);
  logger.debug(`[${job.name}] DB: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

  // Construire la commande pg_dump
  const args: string[] = [];

  // Format
  if (job.format === "custom") {
    args.push("-F", "c");
  } else {
    args.push("-F", "p");
  }

  // Host, port, database, user
  args.push("-h", dbConfig.host);
  args.push("-p", dbConfig.port.toString());
  args.push("-d", dbConfig.database);
  args.push("-U", dbConfig.user);

  // Tables spécifiques si type = "tables"
  if (job.type === "tables" && job.tables && job.tables.length > 0) {
    for (const table of job.tables) {
      args.push("-t", table);
    }
  }

  // Options supplémentaires
  args.push("--no-owner", "--no-acl"); // Évite les problèmes de permissions

  // Fichier de sortie
  args.push("-f", outputPath);

  return new Promise((resolve, reject) => {
    // Préparer l'environnement avec PGPASSWORD
    const env = {
      ...process.env,
      PGPASSWORD: dbConfig.password,
    };

    const pgDump = spawn("pg_dump", args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeoutId = setTimeout(() => {
      pgDump.kill("SIGTERM");
      reject(new Error(`pg_dump timeout after ${timeout}ms`));
    }, timeout);

    let stdout = "";
    let stderr = "";

    pgDump.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    pgDump.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    pgDump.on("close", (code) => {
      clearTimeout(timeoutId);

      if (code !== 0) {
        // Nettoyer le fichier en cas d'erreur
        if (existsSync(outputPath)) {
          try {
            unlinkSync(outputPath);
          } catch (err) {
            logger.warn(`[${job.name}] Failed to cleanup output file: ${err}`);
          }
        }

        const errorMsg = stderr || stdout || `pg_dump exited with code ${code}`;
        logger.error(`[${job.name}] pg_dump failed: ${errorMsg}`);
        reject(new Error(`pg_dump failed with code ${code}: ${errorMsg}`));
        return;
      }

      // Vérifier que le fichier existe
      if (!existsSync(outputPath)) {
        reject(new Error(`Output file was not created: ${outputPath}`));
        return;
      }

          // Compression si demandée
      let finalPath = outputPath;
      let finalSize = 0;

      if (job.compress) {
        try {
          const content = readFileSync(outputPath);
          const compressed = gzipSync(content);
          const compressedPath = `${outputPath}.gz`;
          writeFileSync(compressedPath, compressed);
          unlinkSync(outputPath); // Supprimer le fichier non compressé
          finalPath = compressedPath;
          finalSize = compressed.length;
          logger.debug(`[${job.name}] Compressed dump: ${finalSize} bytes`);
        } catch (err) {
          logger.warn(`[${job.name}] Compression failed, keeping uncompressed: ${err}`);
          finalSize = statSync(outputPath).size;
        }
      } else {
        finalSize = statSync(outputPath).size;
      }

      logger.info(`[${job.name}] pg_dump completed: ${finalPath} (${formatBytes(finalSize)})`);

      resolve({
        filePath: finalPath,
        size: finalSize,
      });
    });

    pgDump.on("error", (err) => {
      clearTimeout(timeoutId);
      logger.error(`[${job.name}] Failed to spawn pg_dump: ${err.message}`);
      reject(new Error(`Failed to execute pg_dump: ${err.message}`));
    });
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

