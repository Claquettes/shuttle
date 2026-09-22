import type { ShuttleConfig, Job, SourceConfig, TargetConfig } from "./schema.js";

export type { ShuttleConfig, Job, SourceConfig, TargetConfig };

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

export interface ResolvedConfig {
  config: ShuttleConfig;
  sourceDbConfig: DatabaseConfig;
  targetSshConfig: SSHConfig;
}
