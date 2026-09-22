import { Command } from "commander";
import { loadConfig, validateConfig } from "../../config/loader.js";
import { logger } from "../../utils/logger.js";
import { resolveCommonOptions } from "../options.js";

export function validateCommand(): Command {
  const cmd = new Command("validate");

  cmd
    .description("Validate Shuttle configuration and environment variables")
    .option("-c, --config <path>", "Path to config file (.yml, .yaml, .json, .apo)", "shuttle.yml")
    .action(() => {
      const { configPath } = resolveCommonOptions(cmd);

      try {
        logger.info(`Loading configuration from: ${configPath}`);
        const resolvedConfig = loadConfig(configPath);

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

        const ssh = resolvedConfig.targetSshConfig;
        if (ssh.knownHostsPath) {
          logger.info(`Host key: verified via known_hosts (${ssh.knownHostsPath})`);
        } else if (ssh.hostFingerprints?.length) {
          logger.info(
            `Host key: verified via fingerprint (${ssh.hostFingerprints.length} accepted)`
          );
        } else {
          logger.warn(
            "Host key: NOT VERIFIED — Shuttle will accept any host key. " +
              "Set 'known_hosts' or 'host_fingerprint' on the target to prevent interception."
          );
        }

        const emailConfig = resolvedConfig.config.shuttle.notifications?.email;
        logger.info("");
        logger.info("=== Notifications ===");
        if (emailConfig) {
          logger.info(`Email: ${emailConfig.provider}`);
          logger.info(`From: ${emailConfig.from}`);
          logger.info(`To: ${emailConfig.to.join(", ")}`);
          logger.info(`Trigger: ${emailConfig.on}`);
        } else {
          logger.info("Email: disabled");
        }

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
