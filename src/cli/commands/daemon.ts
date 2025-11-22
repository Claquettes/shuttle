import { Command } from "commander";
import { loadConfig } from "../../config/loader.js";
import { scheduleJobs, stopScheduledJobs } from "../../core/scheduler.js";
import { logger, initLogger } from "../../utils/logger.js";

export function daemonCommand(): Command {
  const cmd = new Command("daemon");

  cmd
    .description("Run Shuttle as a daemon with scheduled jobs")
    .option("-c, --config <path>", "Path to .apo config file", "shuttle.apo")
    .action(async (options) => {
      const globalOpts = cmd.parent?.opts() || {};
      initLogger({
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
      });

      let scheduled: ReturnType<typeof scheduleJobs> = [];

      // Gestion de l'arrêt propre
      const shutdown = () => {
        logger.info("Shutting down...");
        stopScheduledJobs(scheduled);
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      try {
        logger.info(`Loading configuration from: ${options.config}`);
        const resolvedConfig = loadConfig(options.config);

        // Valider les variables d'environnement
        const { validateEnvVars } = await import("../../config/loader.js");
        const envValidation = validateEnvVars(resolvedConfig);
        if (!envValidation.valid) {
          logger.error("Missing required environment variables:");
          for (const error of envValidation.errors) {
            logger.error(`  - ${error}`);
          }
          process.exit(1);
        }

        logger.info(`Starting Shuttle daemon: ${resolvedConfig.config.shuttle.name}`);
        logger.info(`Timezone: ${resolvedConfig.config.shuttle.timezone}`);

        // Planifier les jobs
        scheduled = scheduleJobs(resolvedConfig, (result) => {
          if (result.success) {
            logger.info(`[${result.jobName}] Scheduled execution completed successfully`);
          } else {
            logger.error(`[${result.jobName}] Scheduled execution failed: ${result.error}`);
          }
        });

        if (scheduled.length === 0) {
          logger.warn("No jobs were scheduled. Exiting.");
          process.exit(1);
        }

        logger.info("");
        logger.info("Shuttle daemon is running. Press Ctrl+C to stop.");
        logger.info("");

        // Garder le processus actif
        // Les jobs sont exécutés par node-cron
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Daemon failed to start: ${message}`);
        process.exit(1);
      }
    });

  return cmd;
}

