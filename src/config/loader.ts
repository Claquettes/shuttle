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

  if (!existsSync(resolvedPath)) {
    throw new Error(`Configuration file not found: ${resolvedPath}`);
  }

  const envPath = join(configDir, ".env");
  if (existsSync(envPath)) {
    logger.debug(`Loading .env from ${envPath}`);
    config({ path: envPath });
  } else {
    logger.debug(`No .env file found at ${envPath}, using process.env only`);
  }

  let rawConfig: unknown;
  try {
    let content = readFileSync(resolvedPath, "utf-8");
    content = expandEnvVars(content);
    rawConfig = parseConfigFile(content, resolvedPath);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to read config file: ${error.message}`);
    }
    throw error;
  }

  const parseResult = ShuttleConfigSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    // zod 4 : les problèmes de validation sont exposés via `issues`.
    const errors = parseResult.error.issues
      .map((issue) => {
        const path = issue.path.map(String).join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  const validatedConfig = parseResult.data;

  const sourceDbConfig = parseSourceConfig(validatedConfig.shuttle.source);
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
    try {
      return JSON.parse(content);
    } catch {
      throw new Error("Failed to parse .apo file. Please use .yml or .yaml for YAML format.");
    }
  }
  throw new Error(
    `Unsupported config file format: ${filePath}. Supported: .yml, .yaml, .json, .apo`
  );
}

/**
 * Parse la configuration source (URL ou détails séparés)
 */
function parseSourceConfig(source: {
  url?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
}): DatabaseConfig {
  if (source.url) {
    return parseDatabaseUrl(source.url);
  }

  if (!source.host || !source.database || !source.user || source.password === undefined) {
    throw new Error(
      "Source configuration must have either 'url' or all of: host, database, user, password"
    );
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
function parseTargetConfig(
  target: {
    host: string;
    port?: number;
    user: string;
    key_path: string;
    key_passphrase?: string;
    base_path: string;
    known_hosts?: string;
    host_fingerprint?: string | string[];
    strict_host_key?: boolean;
  },
  configDir: string
): SSHConfig {
  const keyPath = resolveFromConfigDir(target.key_path, configDir);

  const port = target.port || 22;
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid SSH port: ${port}`);
  }

  const hostFingerprints = target.host_fingerprint
    ? (Array.isArray(target.host_fingerprint)
        ? target.host_fingerprint
        : [target.host_fingerprint]
      ).map((f) => f.trim())
    : undefined;

  return {
    host: target.host,
    port,
    user: target.user,
    keyPath,
    keyPassphrase: target.key_passphrase,
    basePath: target.base_path,
    knownHostsPath: target.known_hosts
      ? resolveFromConfigDir(target.known_hosts, configDir)
      : undefined,
    hostFingerprints,
    strictHostKey: target.strict_host_key ?? false,
  };
}

/**
 * Les chemins relatifs de la config sont resolus par rapport au repertoire
 * du fichier de configuration, pas au cwd du process.
 */
function resolveFromConfigDir(path: string, configDir: string): string {
  return path.startsWith("/") ? path : resolve(configDir, path);
}

/**
 * Expansion des variables d'environnement dans le contenu YAML
 * Supporte ${VAR} et ${VAR:-default}
 */
function expandEnvVars(content: string): string {
  return content.replace(/\$\{([^}]+)\}/g, (match, expr) => {
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
  const ssh = resolvedConfig.targetSshConfig;

  if (!existsSync(ssh.keyPath)) {
    errors.push(`SSH key not found: ${ssh.keyPath}`);
  }

  if (ssh.knownHostsPath && !existsSync(ssh.knownHostsPath)) {
    errors.push(`known_hosts file not found: ${ssh.knownHostsPath}`);
  }

  const hasHostVerification = Boolean(ssh.knownHostsPath || ssh.hostFingerprints?.length);
  if (!hasHostVerification && ssh.strictHostKey) {
    errors.push(
      "strict_host_key is enabled but neither 'known_hosts' nor 'host_fingerprint' is configured"
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
