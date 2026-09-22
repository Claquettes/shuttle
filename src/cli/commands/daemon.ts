import { Command } from "commander";
import { loadConfig } from "../../config/loader.js";
import { scheduleJobs, type Scheduler } from "../../core/scheduler.js";
import { logger } from "../../utils/logger.js";
import { resolveCommonOptions } from "../options.js";

/** Délai laissé aux sauvegardes en cours pour se terminer à l'arrêt */
const SHUTDOWN_TIMEOUT_MS = 15 * 60 * 1000;

export function daemonCommand(): Command {
  const cmd = new Command("daemon");

  cmd
    .description("Run Shuttle as a daemon with scheduled jobs")
    .option("-c, --config <path>", "Path to config file (.yml, .yaml, .json, .apo)", "shuttle.yml")
    .action(async () => {
      const { configPath } = resolveCommonOptions(cmd);

      let scheduler: Scheduler | null = null;
      let shuttingDown = false;

      /**
       * Couper un dump ou un transfert en vol laisserait une sauvegarde
       * incomplète côté serveur de backup : on désarme les crons, puis on
       * laisse les exécutions en cours se terminer.
       */
      const shutdown = async (signal: string) => {
        if (shuttingDown) {
          logger.warn(`Received ${signal} again, forcing exit. Running backups are aborted.`);
          process.exit(1);
        }
        shuttingDown = true;

        logger.info(`Received ${signal}, shutting down...`);
        const clean = scheduler ? await scheduler.shutdown(SHUTDOWN_TIMEOUT_MS) : true;
        logger.info("Shutdown complete.");
        process.exit(clean ? 0 : 1);
      };

      process.on("SIGINT", () => void shutdown("SIGINT"));
      process.on("SIGTERM", () => void shutdown("SIGTERM"));

      try {
        logger.info(`Loading configuration from: ${configPath}`);
        const resolvedConfig = loadConfig(configPath);

        const { validateConfig } = await import("../../config/loader.js");
        const validation = validateConfig(resolvedConfig);
        if (!validation.valid) {
          logger.error("Configuration validation failed:");
          for (const error of validation.errors) {
            logger.error(`  - ${error}`);
          }
          process.exit(1);
        }

        logger.info(`Starting Shuttle daemon: ${resolvedConfig.config.shuttle.name}`);
        logger.info(`Timezone: ${resolvedConfig.config.shuttle.timezone}`);

        scheduler = scheduleJobs(resolvedConfig, (result) => {
          if (result.success) {
            logger.info(`[${result.jobName}] Scheduled execution completed successfully`);
          } else {
            logger.error(`[${result.jobName}] Scheduled execution failed: ${result.error}`);
          }
        });

        if (scheduler.size === 0) {
          logger.warn("No jobs were scheduled. Exiting.");
          process.exit(1);
        }

        logger.info("");
        logger.info("Shuttle daemon is running. Press Ctrl+C to stop.");
        logger.info("");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Daemon failed to start: ${message}`);
        process.exit(1);
      }
    });

  return cmd;
}
