import { Command } from "commander";
import { loadConfig } from "../../config/loader.js";
import { logger } from "../../utils/logger.js";
import { resolveCommonOptions } from "../options.js";

export function lsCommand(): Command {
  const cmd = new Command("ls");

  cmd
    .description("List all configured jobs")
    .option("-c, --config <path>", "Path to config file (.yml, .yaml, .json, .apo)", "shuttle.yml")
    .action(() => {
      const { configPath } = resolveCommonOptions(cmd);

      try {
        const resolvedConfig = loadConfig(configPath);

        logger.info(`Configuration: ${resolvedConfig.config.shuttle.name}`);
        logger.info(
          `Source: ${resolvedConfig.sourceDbConfig.host}:${resolvedConfig.sourceDbConfig.port}/${resolvedConfig.sourceDbConfig.database}`
        );
        logger.info(
          `Target: ${resolvedConfig.targetSshConfig.user}@${resolvedConfig.targetSshConfig.host}:${resolvedConfig.targetSshConfig.port}`
        );
        logger.info("");

        if (resolvedConfig.config.shuttle.jobs.length === 0) {
          logger.info("No jobs configured.");
          return;
        }

        logger.info("Jobs:");
        logger.info("");

        for (const job of resolvedConfig.config.shuttle.jobs) {
          logger.info(`  ${job.name}`);
          logger.info(`    Type:        ${job.type}`);
          logger.info(`    Cron:        ${job.cron}`);
          logger.info(`    Format:      ${job.format}`);
          logger.info(`    Compress:    ${job.compress}`);
          logger.info(`    Keep last:   ${job.keepLast}`);
          if (job.type === "tables" && job.tables) {
            logger.info(`    Tables:      ${job.tables.join(", ")}`);
          }
          logger.info("");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to list jobs: ${message}`);
        process.exit(1);
      }
    });

  return cmd;
}
