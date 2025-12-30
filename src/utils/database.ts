import type { DatabaseConfig } from "./env.js";

/**
 * Parse une URL PostgreSQL en configuration de base de données
 * Format: postgresql://user:password@host:port/database
 */
export function parseDatabaseUrl(url: string): DatabaseConfig {
  try {
    const normalizedUrl = url.startsWith("postgres://")
      ? url.replace("postgres://", "postgresql://")
      : url;

    const parsed = new URL(normalizedUrl);

    const host = parsed.hostname;
    const port = parseInt(parsed.port || "5432", 10);
    const database = parsed.pathname.slice(1);
    const user = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);

    if (!host || !database || !user) {
      throw new Error("URL must contain host, database, and user");
    }

    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port: ${port}`);
    }

    return {
      host,
      port,
      database,
      user,
      password: password || "",
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse database URL: ${error.message}`);
    }
    throw new Error("Failed to parse database URL");
  }
}

