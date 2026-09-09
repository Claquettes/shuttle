import { Command } from "commander";
import { loadConfig } from "../../config/loader.js";
import { executeAllJobs } from "../../core/jobs.js";
import { logger } from "../../utils/logger.js";
import { resolveCommonOptions } from "../options.js";

export function runCommand(): Command {
  const cmd = new Command("run");

  cmd
    .description("Run all jobs once immediately")
    .option("-c, --config <path>", "Path to config file (.yml, .yaml, .json, .apo)", "shuttle.yml")
    .action(async () => {
      const { configPath } = resolveCommonOptions(cmd);

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

        logger.info(`Executing ${resolvedConfig.config.shuttle.jobs.length} job(s)...`);
        logger.info("");

        const results = await executeAllJobs(resolvedConfig);

        logger.info("");
        logger.info("=== Execution Summary ===");
        for (const result of results) {
          if (result.success) {
            logger.info(`${result.jobName}: Success`);
            if (result.retention) {
              logger.info(
                `  Retention: ${result.retention.localDeleted} local, ${result.retention.remoteDeleted} remote files deleted`
              );
            }
          } else {
            logger.error(`${result.jobName}: Failed - ${result.error}`);
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
