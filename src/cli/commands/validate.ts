import { Command } from "commander";
import { loadConfig, validateConfig } from "../../config/loader.js";
import { logger, initLogger } from "../../utils/logger.js";

export function validateCommand(): Command {
  const cmd = new Command("validate");

  cmd
    .description("Validate Shuttle configuration and environment variables")
    .option("-c, --config <path>", "Path to config file (.yml, .yaml, .json, .apo)", "shuttle.yml")
    .action((options) => {
      const globalOpts = cmd.parent?.opts() || {};
      initLogger({
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
      });

      try {
        logger.info(`Loading configuration from: ${options.config}`);
        const resolvedConfig = loadConfig(options.config);

        logger.info("");
        logger.info("=== Configuration Summary ===");
        logger.info(`Name: ${resolvedConfig.config.shuttle.name}`);
        logger.info(`Timezone: ${resolvedConfig.config.shuttle.timezone}`);
        logger.info(`Jobs: ${resolvedConfig.config.shuttle.jobs.length}`);

        logger.info("");
        logger.info("=== Source Database ===");
        logger.info(`Host: ${resolvedConfig.sourceDbConfig.host}`);
        logger.info(`Port: ${resolvedConfig.sourceDbConfig.port}`);
        logger.info(`Database: ${resolvedConfig.sourceDbConfig.database}`);
        logger.info(`User: ${resolvedConfig.sourceDbConfig.user}`);

        logger.info("");
        logger.info("=== Target Backup Server ===");
        logger.info(`Host: ${resolvedConfig.targetSshConfig.host}`);
        logger.info(`Port: ${resolvedConfig.targetSshConfig.port}`);
        logger.info(`User: ${resolvedConfig.targetSshConfig.user}`);
        logger.info(`Key Path: ${resolvedConfig.targetSshConfig.keyPath}`);
        logger.info(`Base Path: ${resolvedConfig.targetSshConfig.basePath}`);

        logger.info("");
        logger.info("=== Jobs ===");
        for (const job of resolvedConfig.config.shuttle.jobs) {
          logger.info(`  - ${job.name}`);
          logger.info(`    Type: ${job.type}`);
          logger.info(`    Cron: ${job.cron}`);
          logger.info(`    Format: ${job.format}`);
          logger.info(`    Compress: ${job.compress}`);
          logger.info(`    Keep last: ${job.keepLast}`);
          if (job.type === "tables" && job.tables) {
            logger.info(`    Tables: ${job.tables.join(", ")}`);
          }
        }

        logger.info("");
        logger.info("=== Validation ===");
        const validation = validateConfig(resolvedConfig);

        if (validation.valid) {
          logger.info("Configuration is valid and ready to use!");
        } else {
          logger.error("Configuration validation failed:");
          for (const error of validation.errors) {
            logger.error(`  - ${error}`);
          }
          logger.error("");
          logger.error("Please check your configuration file.");
          process.exit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Validation failed: ${message}`);
        process.exit(1);
      }
    });

  return cmd;
}

