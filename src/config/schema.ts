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
export const SourceConfigSchema = z.union(
  [
    z.object({
      url: z
        .string()
        .refine((val) => val.startsWith("postgresql://") || val.startsWith("postgres://"), {
          message: "URL must start with postgresql:// or postgres://",
        }),
    }),
    z.object({
      host: z.string().min(1),
      port: z.number().int().positive().max(65535).default(5432),
      database: z.string().min(1),
      user: z.string().min(1),
      password: z.string(),
    }),
  ],
  {
    // Sans message explicite, une union invalide ne produit qu'un « Invalid
    // input » qui n'aide pas à corriger le fichier.
    error:
      "source must be either { url: postgresql://... } " +
      "or { host, database, user, password } (port optional, defaults to 5432)",
  }
);

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

  /**
   * Vérification de la clé d'hôte SSH (anti man-in-the-middle).
   * Sans l'un des deux, Shuttle accepte n'importe quelle clé d'hôte : un
   * attaquant en position d'interception recevrait le dump de production.
   */
  known_hosts: z.string().min(1).optional(),
  host_fingerprint: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  /** true = refuse de se connecter si aucune vérification d'hôte n'est configurée */
  strict_host_key: z.boolean().default(false),
});

/**
 * Notification par email (rapport envoyé après chaque sauvegarde)
 * Provider supporté : SendGrid (API v3)
 */
export const EmailNotificationSchema = z.object({
  provider: z.literal("sendgrid").default("sendgrid"),
  api_key: z.string().min(1),
  from: z.string().email(),
  from_name: z.string().optional(),
  to: z.array(z.string().email()).min(1),
  /** always = succès + échec, success = succès seulement, failure = échec seulement */
  on: z.enum(["always", "success", "failure"]).default("always"),
  subject_prefix: z.string().optional(),
  /** Timeout de l'appel HTTP vers l'API SendGrid, en millisecondes */
  timeout: z.number().int().positive().default(15000),
});

export const NotificationsConfigSchema = z.object({
  email: EmailNotificationSchema.optional(),
});

export const ShuttleConfigSchema = z.object({
  version: z.number().int().positive(),
  shuttle: z.object({
    name: z.string().min(1),
    timezone: z.string().optional().default("UTC"),
    source: SourceConfigSchema,
    target: TargetConfigSchema,
    notifications: NotificationsConfigSchema.optional(),
    jobs: z.array(JobSchema).min(1),
  }),
});

export type Job = z.infer<typeof JobSchema>;
export type SourceConfig = z.infer<typeof SourceConfigSchema>;
export type TargetConfig = z.infer<typeof TargetConfigSchema>;
export type EmailNotificationConfig = z.infer<typeof EmailNotificationSchema>;
export type NotificationsConfig = z.infer<typeof NotificationsConfigSchema>;
export type ShuttleConfig = z.infer<typeof ShuttleConfigSchema>;
