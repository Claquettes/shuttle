import { readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { config } from "dotenv";
import { ShuttleConfigSchema, type ShuttleConfig } from "./schema.js";
import { findConfigDir } from "../utils/paths.js";
import { logger } from "../utils/logger.js";
import type { ResolvedConfig } from "./types.js";

/**
 * Charge et valide la configuration depuis un fichier .apo
 * Charge également le .env du même répertoire
 */
export function loadConfig(configPath: string): ResolvedConfig {
  const resolvedPath = resolve(configPath);
  const configDir = dirname(resolvedPath);

  // Vérifier que le fichier existe
  if (!existsSync(resolvedPath)) {
    throw new Error(`Configuration file not found: ${resolvedPath}`);
  }

  // Charger le .env du même répertoire (si présent)
  const envPath = join(configDir, ".env");
  if (existsSync(envPath)) {
    logger.debug(`Loading .env from ${envPath}`);
    config({ path: envPath });
  } else {
    logger.debug(`No .env file found at ${envPath}, using process.env only`);
  }

  // Charger et parser le .apo
  let rawConfig: unknown;
  try {
    const content = readFileSync(resolvedPath, "utf-8");
    rawConfig = parseConfigFile(content, resolvedPath);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to read config file: ${error.message}`);
    }
    throw error;
  }

  // Valider avec Zod
  const parseResult = ShuttleConfigSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    const errors = parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  const validatedConfig = parseResult.data;

  return {
    config: validatedConfig,
    sourceDbConfig: {
      connectionId: validatedConfig.shuttle.connections.source,
    },
    targetSshConfig: {
      connectionId: validatedConfig.shuttle.connections.target,
    },
  };
}

/**
 * Parse un fichier de configuration (.apo peut être YAML ou JSON)
 */
function parseConfigFile(content: string, filePath: string): unknown {
  const ext = filePath.toLowerCase();
  if (ext.endsWith(".json")) {
    return JSON.parse(content);
  } else if (ext.endsWith(".apo") || ext.endsWith(".yaml") || ext.endsWith(".yml")) {
    // Pour l'instant, on supporte JSON dans .apo
    // Si besoin de YAML, on peut ajouter js-yaml
    try {
      return JSON.parse(content);
    } catch {
      // Si ce n'est pas du JSON, on essaie de parser comme YAML simple
      // Pour une implémentation complète, utiliser js-yaml
      throw new Error("YAML parsing not yet implemented. Please use JSON format in .apo files.");
    }
  }
  throw new Error(`Unsupported config file format: ${filePath}`);
}

/**
 * Valide que toutes les variables d'environnement requises sont présentes
 */
export function validateEnvVars(resolvedConfig: ResolvedConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const { sourceDbConfig, targetSshConfig } = resolvedConfig;

  // Valider la connexion source (DB)
  const sourcePrefix = `SHUTTLE_${sourceDbConfig.connectionId.toUpperCase().replace(/-/g, "_")}_DB_`;
  const sourceRequired = ["HOST", "PORT", "NAME", "USER", "PASSWORD"];
  for (const key of sourceRequired) {
    if (!process.env[`${sourcePrefix}${key}`]) {
      errors.push(`Missing: ${sourcePrefix}${key}`);
    }
  }

  // Valider la connexion target (SSH)
  const targetPrefix = `SHUTTLE_${targetSshConfig.connectionId.toUpperCase().replace(/-/g, "_")}_SSH_`;
  const targetRequired = ["HOST", "USER", "KEY_PATH", "BASE_PATH"];
  for (const key of targetRequired) {
    if (!process.env[`${targetPrefix}${key}`]) {
      errors.push(`Missing: ${targetPrefix}${key}`);
    }
  }

  // Valider le port SSH s'il est fourni
  const sshPort = process.env[`${targetPrefix}PORT`];
  if (sshPort) {
    const port = parseInt(sshPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      errors.push(`Invalid SSH port: ${targetPrefix}PORT = ${sshPort}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

