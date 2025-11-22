import { Command } from "commander";
import { loadConfig, validateEnvVars } from "../../config/loader.js";
import { logger, initLogger } from "../../utils/logger.js";

export function validateCommand(): Command {
  const cmd = new Command("validate");

  cmd
    .description("Validate Shuttle configuration and environment variables")
    .option("-c, --config <path>", "Path to .apo config file", "shuttle.apo")
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
        logger.info(
          `Source connection ID: ${resolvedConfig.sourceDbConfig.connectionId}`
        );
        logger.info(
          `Target connection ID: ${resolvedConfig.targetSshConfig.connectionId}`
        );
        logger.info(`Jobs: ${resolvedConfig.config.shuttle.jobs.length}`);

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
        logger.info("=== Environment Variables Validation ===");
        const envValidation = validateEnvVars(resolvedConfig);

        if (envValidation.valid) {
          logger.info("✓ All required environment variables are present");
          logger.info("");
          logger.info("Source DB variables:");
          const sourcePrefix = `SHUTTLE_${resolvedConfig.sourceDbConfig.connectionId
            .toUpperCase()
            .replace(/-/g, "_")}_DB_`;
          logger.info(`  ✓ ${sourcePrefix}HOST`);
          logger.info(`  ✓ ${sourcePrefix}PORT`);
          logger.info(`  ✓ ${sourcePrefix}NAME`);
          logger.info(`  ✓ ${sourcePrefix}USER`);
          logger.info(`  ✓ ${sourcePrefix}PASSWORD`);

          logger.info("");
          logger.info("Target SSH variables:");
          const targetPrefix = `SHUTTLE_${resolvedConfig.targetSshConfig.connectionId
            .toUpperCase()
            .replace(/-/g, "_")}_SSH_`;
          logger.info(`  ✓ ${targetPrefix}HOST`);
          logger.info(`  ✓ ${targetPrefix}PORT`);
          logger.info(`  ✓ ${targetPrefix}USER`);
          logger.info(`  ✓ ${targetPrefix}KEY_PATH`);
          logger.info(`  ✓ ${targetPrefix}BASE_PATH`);

          logger.info("");
          logger.info("Configuration is valid and ready to use!");
        } else {
          logger.error("✗ Missing or invalid environment variables:");
          for (const error of envValidation.errors) {
            logger.error(`  - ${error}`);
          }
          logger.error("");
          logger.error("Please check your .env file or environment variables.");
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

