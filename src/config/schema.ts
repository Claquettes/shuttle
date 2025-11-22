import { z } from "zod";

/**
 * Schéma Zod pour la validation du fichier .apo
 */

export const JobSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["full", "tables"]),
  cron: z.string().min(1), // Validation réelle faite par node-cron
  format: z.enum(["plain", "custom"]).default("custom"),
  compress: z.boolean().default(true),
  keepLast: z.number().int().positive(),
  tables: z.array(z.string()).optional(),
  timeout: z.number().int().positive().optional(),
});

export const ConnectionsSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
});

export const ShuttleConfigSchema = z.object({
  version: z.number().int().positive(),
  shuttle: z.object({
    name: z.string().min(1),
    timezone: z.string().optional().default("UTC"),
    connections: ConnectionsSchema,
    jobs: z.array(JobSchema).min(1),
  }),
});

export type Job = z.infer<typeof JobSchema>;
export type Connections = z.infer<typeof ConnectionsSchema>;
export type ShuttleConfig = z.infer<typeof ShuttleConfigSchema>;

