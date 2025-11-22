import { Command } from "commander";
import { writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { logger, initLogger } from "../../utils/logger.js";

export function initCommand(): Command {
  const cmd = new Command("init");

  cmd.description("Initialize a new Shuttle configuration").action(() => {
    initLogger({ verbose: true });
    const configPath = resolve("shuttle.apo");
    const envPath = resolve(".env.example");

    if (existsSync(configPath)) {
      logger.warn(`Configuration file already exists: ${configPath}`);
      logger.info("Skipping creation. Use a different path or remove the existing file.");
      return;
    }

    // Créer shuttle.apo
    const apoContent = `{
  "version": 1,
  "shuttle": {
    "name": "my-shuttle",
    "timezone": "Europe/Paris",
    "connections": {
      "source": "prod_main",
      "target": "prod_backup"
    },
    "jobs": [
      {
        "name": "full-nightly",
        "type": "full",
        "cron": "0 3 * * *",
        "format": "custom",
        "compress": true,
        "keepLast": 7
      },
      {
        "name": "tables-frequent",
        "type": "tables",
        "cron": "*/30 * * * *",
        "tables": [
          "public.users",
          "public.orders"
        ],
        "format": "plain",
        "compress": true,
        "keepLast": 48
      }
    ]
  }
}
`;

    // Créer .env.example
    const envExampleContent = `# Shuttle Configuration - Environment Variables
# Copy this file to .env and fill in your actual values
# NEVER commit .env to version control!

# ============================================
# Source Database Connection (prod_main)
# ============================================
# For Docker: use the service name as host (e.g., "postgres")
# For local: use "localhost" or the actual hostname
SHUTTLE_PROD_MAIN_DB_HOST=postgres
SHUTTLE_PROD_MAIN_DB_PORT=5432
SHUTTLE_PROD_MAIN_DB_NAME=my_app
SHUTTLE_PROD_MAIN_DB_USER=shuttle
SHUTTLE_PROD_MAIN_DB_PASSWORD=your_db_password_here

# ============================================
# Target SSH Connection (prod_backup)
# ============================================
SHUTTLE_PROD_BACKUP_SSH_HOST=backup.example.com
SHUTTLE_PROD_BACKUP_SSH_PORT=22
SHUTTLE_PROD_BACKUP_SSH_USER=backup
SHUTTLE_PROD_BACKUP_SSH_KEY_PATH=/path/to/your/ssh/private/key
SHUTTLE_PROD_BACKUP_SSH_KEY_PASSPHRASE=
SHUTTLE_PROD_BACKUP_BASE_PATH=/backups/my_app

# ============================================
# Optional: Local Backup Directory
# ============================================
# SHUTTLE_LOCAL_BACKUP_DIR=./backups
`;

    try {
      writeFileSync(configPath, apoContent, "utf-8");
      logger.info(`Created configuration file: ${configPath}`);

      writeFileSync(envPath, envExampleContent, "utf-8");
      logger.info(`Created example .env file: ${envPath}`);

      logger.info("");
      logger.info("Next steps:");
      logger.info("1. Copy .env.example to .env: cp .env.example .env");
      logger.info("2. Edit .env and fill in your actual credentials");
      logger.info("3. Validate your configuration: shuttle validate");
      logger.info("4. Run a backup: shuttle run");
    } catch (error) {
      logger.error(`Failed to create configuration files: ${error}`);
      process.exit(1);
    }
  });

  return cmd;
}

