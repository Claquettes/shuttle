import { Command } from "commander";
import { writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { logger, initLogger } from "../../utils/logger.js";

export function initCommand(): Command {
  const cmd = new Command("init");

  cmd.description("Initialize a new Shuttle configuration").action(() => {
    initLogger({ verbose: true });
    const configPath = resolve("shuttle.yml");

    if (existsSync(configPath)) {
      logger.warn(`Configuration file already exists: ${configPath}`);
      logger.info("Skipping creation. Use a different path or remove the existing file.");
      return;
    }

    const ymlContent = `version: 1
shuttle:
  name: my-shuttle
  timezone: Europe/Paris
  
  # Source: Base de données PostgreSQL
  # Option 1: URL complète (recommandé)
  source:
    url: postgresql://user:password@host:5432/database
  # Option 2: Détails séparés (alternative)
  # source:
  #   host: postgres
  #   port: 5432
  #   database: my_app
  #   user: myuser
  #   password: mypassword
  
  # Target: Serveur de backup (SSH/SFTP)
  target:
    host: backup.example.com
    port: 22
    user: backup
    key_path: ./ssh_key
    base_path: /backups/my_app
    # Verification de la cle d'hote (fortement recommande).
    # Generer le fichier avec :
    #   ssh-keyscan -p 22 backup.example.com > known_hosts
    # Sans cela, Shuttle accepte n'importe quelle cle d'hote : un attaquant
    # capable d'intercepter la connexion recevrait le dump de production.
    # known_hosts: ./known_hosts
    # strict_host_key: true
  
  # Notifications : rapport email apres chaque sauvegarde (optionnel)
  # notifications:
  #   email:
  #     provider: sendgrid   # sendgrid | resend
  #     api_key: \${SENDGRID_API_KEY}
  #     from: shuttle@example.com
  #     from_name: Shuttle
  #     to:
  #       - ops@example.com
  #     on: always            # always | success | failure
  #     subject_prefix: "[Shuttle]"

  # Jobs de backup
  jobs:
    - name: full-nightly
      type: full
      cron: "0 3 * * *"
      format: custom
      compress: true
      keepLast: 7
    - name: tables-frequent
      type: tables
      cron: "*/30 * * * *"
      tables:
        - public.users
        - public.orders
      format: plain
      compress: true
      keepLast: 48
`;

    try {
      writeFileSync(configPath, ymlContent, "utf-8");
      logger.info(`Created configuration file: ${configPath}`);

      logger.info("");
      logger.info("Next steps:");
      logger.info("1. Edit shuttle.yml and fill in your database URL and SSH details");
      logger.info("2. Place your SSH private key in ./ssh_key (or update key_path)");
      logger.info("3. Validate your configuration: shuttle validate");
      logger.info("4. Run a backup: shuttle run");
    } catch (error) {
      logger.error(`Failed to create configuration files: ${error}`);
      process.exit(1);
    }
  });

  return cmd;
}
