import SftpClient from "ssh2-sftp-client";
import type { FileInfo } from "ssh2-sftp-client";
import { readFileSync, existsSync, statSync } from "fs";
import { basename, join } from "path";
import type { SSHConfig } from "../utils/env.js";
import { logger } from "../utils/logger.js";
import { formatBytes } from "../utils/format.js";
import { buildHostVerifier } from "./hostKey.js";

export interface TransferResult {
  remotePath: string;
  size: number;
  success: boolean;
}

const READY_TIMEOUT = 30000;

/**
 * Session SFTP réutilisable : une seule connexion pour tout un cycle
 * (transfert + listing + suppressions de rétention).
 */
export class SftpSession {
  private client: SftpClient | null = null;

  constructor(private readonly sshConfig: SSHConfig) {}

  async connect(): Promise<void> {
    if (this.client) return;

    const { sshConfig } = this;

    if (!existsSync(sshConfig.keyPath)) {
      throw new Error(`SSH key not found: ${sshConfig.keyPath}`);
    }

    // buildHostVerifier lève si strict_host_key est actif sans vérification
    // configurée, ou si le known_hosts ne contient pas l'hôte.
    const hostKey = buildHostVerifier(sshConfig);

    const privateKey = readFileSync(sshConfig.keyPath, "utf-8");
    const client = new SftpClient();

    logger.debug(
      `[SSH] Connecting to ${sshConfig.host}:${sshConfig.port} as ${sshConfig.user} ` +
        `(host key verification: ${hostKey.enabled ? "enabled" : "DISABLED"})`
    );

    await client.connect({
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.user,
      privateKey,
      passphrase: sshConfig.keyPassphrase,
      readyTimeout: READY_TIMEOUT,
      hostVerifier: hostKey.verifier,
    });

    this.client = client;
    logger.debug(`[SSH] Connected successfully`);
  }

  private require(): SftpClient {
    if (!this.client) {
      throw new Error("SFTP session is not connected");
    }
    return this.client;
  }

  /**
   * Envoie un fichier de façon atomique et vérifiée.
   *
   * 1. écriture sous un nom temporaire `.part` : un transfert interrompu ne
   *    laisse jamais un fichier tronqué portant le nom d'une sauvegarde valide ;
   * 2. comparaison de la taille distante avec la taille locale ;
   * 3. renommage vers le nom définitif seulement si les tailles concordent.
   */
  async upload(localPath: string, remoteDir: string): Promise<TransferResult> {
    const client = this.require();

    if (!existsSync(localPath)) {
      throw new Error(`Local file not found: ${localPath}`);
    }

    const localSize = statSync(localPath).size;
    if (localSize === 0) {
      throw new Error(`Refusing to upload an empty dump: ${localPath}`);
    }

    const filename = basename(localPath);
    const remotePath = remotePathJoin(remoteDir, filename);
    const tempPath = `${remotePath}.part`;

    await client.mkdir(remoteDir, true);
    logger.debug(`[SSH] Ensured remote directory exists: ${remoteDir}`);

    logger.info(`[SSH] Uploading ${filename} (${formatBytes(localSize)}) to ${remotePath}...`);

    try {
      await client.put(localPath, tempPath);
    } catch (error) {
      await this.cleanupTemp(tempPath);
      throw error;
    }

    let remoteSize: number;
    try {
      remoteSize = (await client.stat(tempPath)).size;
    } catch (error) {
      await this.cleanupTemp(tempPath);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Uploaded file could not be verified: ${message}`);
    }

    if (remoteSize !== localSize) {
      await this.cleanupTemp(tempPath);
      throw new Error(
        `Transfer verification failed for ${filename}: ` +
          `local ${localSize} bytes, remote ${remoteSize} bytes. Backup discarded.`
      );
    }

    // Le rename SFTP échoue si la destination existe déjà : on la retire
    // d'abord (cas d'un re-run sur la même seconde).
    await client.delete(remotePath, true).catch(() => undefined);
    await client.rename(tempPath, remotePath);

    logger.info(`[SSH] Upload verified: ${remotePath} (${formatBytes(remoteSize)})`);

    return { remotePath, size: remoteSize, success: true };
  }

  private async cleanupTemp(tempPath: string): Promise<void> {
    try {
      await this.require().delete(tempPath, true);
      logger.debug(`[SSH] Removed incomplete upload: ${tempPath}`);
    } catch (err) {
      logger.warn(`[SSH] Could not remove incomplete upload ${tempPath}: ${err}`);
    }
  }

  /**
   * Liste les entrées d'un répertoire distant. Retourne [] si absent.
   */
  async list(remoteDir: string): Promise<FileInfo[]> {
    try {
      return await this.require().list(remoteDir);
    } catch (err) {
      if (err instanceof Error && /no such file|not exist/i.test(err.message)) {
        return [];
      }
      throw err;
    }
  }

  async delete(remotePath: string): Promise<void> {
    await this.require().delete(remotePath);
    logger.debug(`[SSH] Deleted remote file: ${remotePath}`);
  }

  async close(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.end();
    } catch (err) {
      logger.debug(`[SSH] Error closing connection: ${err}`);
    } finally {
      this.client = null;
    }
  }
}

/**
 * Ouvre une session SFTP, exécute `fn`, puis ferme la connexion dans tous les cas.
 */
export async function withSftp<T>(
  sshConfig: SSHConfig,
  fn: (session: SftpSession) => Promise<T>
): Promise<T> {
  const session = new SftpSession(sshConfig);
  try {
    await session.connect();
    return await fn(session);
  } finally {
    await session.close();
  }
}

/**
 * Transfère un fichier vers un serveur distant via SFTP (connexion dédiée).
 */
export async function transferFile(
  localPath: string,
  remoteDir: string,
  sshConfig: SSHConfig
): Promise<TransferResult> {
  try {
    return await withSftp(sshConfig, (session) => session.upload(localPath, remoteDir));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[SSH] Transfer failed: ${message}`);
    throw new Error(`SSH transfer failed: ${message}`);
  }
}

export function remotePathJoin(...segments: string[]): string {
  return join(...segments).replace(/\\/g, "/");
}
