import { z } from "zod";

/**
 * Schéma Zod pour la validation du fichier de configuration (YAML/JSON)
 */

export const JobSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["full", "tables"]),
  cron: z.string().min(1),
  format: z.enum(["plain", "custom"]).default("custom"),
  compress: z.boolean().default(true),
  keepLast: z.number().int().positive(),
  tables: z.array(z.string()).optional(),
  timeout: z.number().int().positive().optional(),
});

/**
 * Configuration de la source (base de données PostgreSQL)
 * Supporte soit une URL, soit des détails séparés
 */
export const SourceConfigSchema = z.union([
  z.object({
    url: z.string().refine(
      (val) => val.startsWith("postgresql://") || val.startsWith("postgres://"),
      { message: "URL must start with postgresql:// or postgres://" }
    ),
  }),
  z.object({
    host: z.string().min(1),
    port: z.number().int().positive().max(65535),
    database: z.string().min(1),
    user: z.string().min(1),
    password: z.string(),
  }),
]);

/**
 * Configuration de la cible (serveur de backup SSH/SFTP)
 */
export const TargetConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().max(65535).default(22),
  user: z.string().min(1),
  key_path: z.string().min(1),
  key_passphrase: z.string().optional(),
  base_path: z.string().min(1),
});

export const ShuttleConfigSchema = z.object({
  version: z.number().int().positive(),
  shuttle: z.object({
    name: z.string().min(1),
    timezone: z.string().optional().default("UTC"),
    source: SourceConfigSchema,
    target: TargetConfigSchema,
    jobs: z.array(JobSchema).min(1),
  }),
});

export type Job = z.infer<typeof JobSchema>;
export type SourceConfig = z.infer<typeof SourceConfigSchema>;
export type TargetConfig = z.infer<typeof TargetConfigSchema>;
export type ShuttleConfig = z.infer<typeof ShuttleConfigSchema>;

