/**
 * Helpers pour récupérer les variables d'environnement avec préfixes
 */

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface SSHConfig {
  host: string;
  port: number;
  user: string;
  keyPath: string;
  keyPassphrase?: string;
  basePath: string;
  /** Chemin d'un fichier known_hosts (format OpenSSH) */
  knownHostsPath?: string;
  /** Empreintes acceptées, au format OpenSSH `SHA256:base64` */
  hostFingerprints?: string[];
  /** Refuse la connexion si aucune vérification d'hôte n'est configurée */
  strictHostKey: boolean;
}

/**
 * Récupère la configuration DB depuis les variables d'environnement
 * Convention: SHUTTLE_{CONNECTION_ID}_DB_{KEY}
 */
export function getDatabaseConfig(connectionId: string): DatabaseConfig {
  const prefix = `SHUTTLE_${connectionId.toUpperCase().replace(/-/g, "_")}_DB_`;

  const host = getRequiredEnv(`${prefix}HOST`);
  const port = parseInt(getRequiredEnv(`${prefix}PORT`), 10);
  const database = getRequiredEnv(`${prefix}NAME`);
  const user = getRequiredEnv(`${prefix}USER`);
  const password = getRequiredEnv(`${prefix}PASSWORD`);

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port for ${connectionId}: ${port}`);
  }

  return { host, port, database, user, password };
}

/**
 * Récupère la configuration SSH depuis les variables d'environnement
 * Convention: SHUTTLE_{CONNECTION_ID}_SSH_{KEY}
 */
export function getSSHConfig(connectionId: string): SSHConfig {
  const prefix = `SHUTTLE_${connectionId.toUpperCase().replace(/-/g, "_")}_SSH_`;

  const host = getRequiredEnv(`${prefix}HOST`);
  const port = parseInt(getRequiredEnv(`${prefix}PORT`, "22"), 10);
  const user = getRequiredEnv(`${prefix}USER`);
  const keyPath = getRequiredEnv(`${prefix}KEY_PATH`);
  const keyPassphrase = process.env[`${prefix}KEY_PASSPHRASE`];
  const basePath = getRequiredEnv(`${prefix}BASE_PATH`);

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid SSH port for ${connectionId}: ${port}`);
  }

  return {
    host,
    port,
    user,
    keyPath,
    keyPassphrase,
    basePath,
    knownHostsPath: process.env[`${prefix}KNOWN_HOSTS`],
    strictHostKey: process.env[`${prefix}STRICT_HOST_KEY`] === "true",
  };
}

/**
 * Récupère une variable d'environnement requise
 */
function getRequiredEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Vérifie si toutes les variables requises pour une connexion DB sont présentes
 */
export function validateDatabaseEnv(connectionId: string): {
  valid: boolean;
  missing: string[];
} {
  const prefix = `SHUTTLE_${connectionId.toUpperCase().replace(/-/g, "_")}_DB_`;
  const required = ["HOST", "PORT", "NAME", "USER", "PASSWORD"];
  const missing: string[] = [];

  for (const key of required) {
    if (!process.env[`${prefix}${key}`]) {
      missing.push(`${prefix}${key}`);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Vérifie si toutes les variables requises pour une connexion SSH sont présentes
 */
export function validateSSHEnv(connectionId: string): {
  valid: boolean;
  missing: string[];
} {
  const prefix = `SHUTTLE_${connectionId.toUpperCase().replace(/-/g, "_")}_SSH_`;
  const required = ["HOST", "USER", "KEY_PATH", "BASE_PATH"];
  const missing: string[] = [];

  for (const key of required) {
    if (!process.env[`${prefix}${key}`]) {
      missing.push(`${prefix}${key}`);
    }
  }

  const port = process.env[`${prefix}PORT`];
  if (port && (isNaN(parseInt(port, 10)) || parseInt(port, 10) < 1 || parseInt(port, 10) > 65535)) {
    missing.push(`${prefix}PORT (invalid value)`);
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
