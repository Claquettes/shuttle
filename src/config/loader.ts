import { readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { config } from "dotenv";
import { load as yamlLoad } from "js-yaml";
import { ShuttleConfigSchema } from "./schema.js";
import { logger } from "../utils/logger.js";
import { parseDatabaseUrl } from "../utils/database.js";
import type { ResolvedConfig } from "./types.js";
import type { DatabaseConfig, SSHConfig } from "../utils/env.js";

/**
 * Charge et valide la configuration depuis un fichier .yml ou .yaml
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

  // Charger et parser le fichier de configuration
  let rawConfig: unknown;
  try {
    let content = readFileSync(resolvedPath, "utf-8");
    // Expansion des variables d'environnement dans le YAML
    content = expandEnvVars(content);
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

  // Parser la configuration source (URL ou détails séparés)
  const sourceDbConfig = parseSourceConfig(validatedConfig.shuttle.source);

  // Parser la configuration target (SSH)
  const targetSshConfig = parseTargetConfig(validatedConfig.shuttle.target, configDir);

  return {
    config: validatedConfig,
    sourceDbConfig,
    targetSshConfig,
  };
}

/**
 * Parse un fichier de configuration (YAML ou JSON)
 */
function parseConfigFile(content: string, filePath: string): unknown {
  const ext = filePath.toLowerCase();
  if (ext.endsWith(".json")) {
    return JSON.parse(content);
  } else if (ext.endsWith(".yaml") || ext.endsWith(".yml")) {
    try {
      return yamlLoad(content);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to parse YAML: ${error.message}`);
      }
      throw new Error("Failed to parse YAML file");
    }
  } else if (ext.endsWith(".apo")) {
    // Support rétrocompatibilité pour .apo (JSON)
    try {
      return JSON.parse(content);
    } catch {
      throw new Error("Failed to parse .apo file. Please use .yml or .yaml for YAML format.");
    }
  }
  throw new Error(`Unsupported config file format: ${filePath}. Supported: .yml, .yaml, .json, .apo`);
}

/**
 * Parse la configuration source (URL ou détails séparés)
 */
function parseSourceConfig(source: { url?: string; host?: string; port?: number; database?: string; user?: string; password?: string }): DatabaseConfig {
  if (source.url) {
    return parseDatabaseUrl(source.url);
  }

  // Détails séparés
  if (!source.host || !source.database || !source.user || source.password === undefined) {
    throw new Error("Source configuration must have either 'url' or all of: host, database, user, password");
  }

  const port = source.port || 5432;
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }

  return {
    host: source.host,
    port,
    database: source.database,
    user: source.user,
    password: source.password,
  };
}

/**
 * Parse la configuration target (SSH)
 */
function parseTargetConfig(target: { host: string; port?: number; user: string; key_path: string; key_passphrase?: string; base_path: string }, configDir: string): SSHConfig {
  // Résoudre le chemin de la clé (relatif au répertoire de config ou absolu)
  const keyPath = target.key_path.startsWith("/")
    ? target.key_path
    : resolve(configDir, target.key_path);

  const port = target.port || 22;
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid SSH port: ${port}`);
  }

  return {
    host: target.host,
    port,
    user: target.user,
    keyPath,
    keyPassphrase: target.key_passphrase,
    basePath: target.base_path,
  };
}

/**
 * Expansion des variables d'environnement dans le contenu YAML
 * Supporte ${VAR} et ${VAR:-default}
 */
function expandEnvVars(content: string): string {
  return content.replace(/\$\{([^}]+)\}/g, (match, expr) => {
    // Support ${VAR:-default}
    const parts = expr.split(":-");
    const varName = parts[0].trim();
    const defaultValue = parts[1] ? parts[1].trim() : undefined;

    const value = process.env[varName];
    if (value !== undefined) {
      return value;
    }

    if (defaultValue !== undefined) {
      return defaultValue;
    }

    // Si pas de valeur et pas de default, on laisse tel quel (sera validé plus tard)
    return match;
  });
}

/**
 * Valide que la configuration est complète
 */
export function validateConfig(resolvedConfig: ResolvedConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Vérifier que la clé SSH existe
  if (!existsSync(resolvedConfig.targetSshConfig.keyPath)) {
    errors.push(`SSH key not found: ${resolvedConfig.targetSshConfig.keyPath}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

