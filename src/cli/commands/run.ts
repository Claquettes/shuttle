import { Command } from "commander";
import { loadConfig } from "../../config/loader.js";
import { executeAllJobs } from "../../core/jobs.js";
import { logger, initLogger } from "../../utils/logger.js";

export function runCommand(): Command {
  const cmd = new Command("run");

  cmd
    .description("Run all jobs once immediately")
    .option("-c, --config <path>", "Path to .apo config file", "shuttle.apo")
    .action(async (options) => {
      const globalOpts = cmd.parent?.opts() || {};
      initLogger({
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
      });

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

        logger.info(`Executing ${resolvedConfig.config.shuttle.jobs.length} job(s)...`);
        logger.info("");

        const results = await executeAllJobs(resolvedConfig);

        logger.info("");
        logger.info("=== Execution Summary ===");
        for (const result of results) {
          if (result.success) {
            logger.info(`✓ ${result.jobName}: Success`);
            if (result.retention) {
              logger.info(
                `  Retention: ${result.retention.localDeleted} local, ${result.retention.remoteDeleted} remote files deleted`
              );
            }
          } else {
            logger.error(`✗ ${result.jobName}: Failed - ${result.error}`);
          }
        }

        const allSuccess = results.every((r) => r.success);
        if (!allSuccess) {
          process.exit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Execution failed: ${message}`);
        process.exit(1);
      }
    });

  return cmd;
}

