import SftpClient from "ssh2-sftp-client";
import { readFileSync, existsSync } from "fs";
import { basename, join } from "path";
import type { SSHConfig } from "../utils/env.js";
import { logger } from "../utils/logger.js";

export interface TransferResult {
  remotePath: string;
  success: boolean;
}

/**
 * Transfère un fichier vers un serveur distant via SFTP
 */
export async function transferFile(
  localPath: string,
  remoteDir: string,
  sshConfig: SSHConfig
): Promise<TransferResult> {
  if (!existsSync(localPath)) {
    throw new Error(`Local file not found: ${localPath}`);
  }

  const filename = basename(localPath);
  const remotePath = join(remoteDir, filename).replace(/\\/g, "/"); // Normaliser les slashes

  logger.debug(`[SSH] Connecting to ${sshConfig.host}:${sshConfig.port} as ${sshConfig.user}`);

  const client = new SftpClient();

  try {
    // Charger la clé privée
    if (!existsSync(sshConfig.keyPath)) {
      throw new Error(`SSH key not found: ${sshConfig.keyPath}`);
    }

    const privateKey = readFileSync(sshConfig.keyPath, "utf-8");

    // Connexion
    await client.connect({
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.user,
      privateKey,
      passphrase: sshConfig.keyPassphrase,
      readyTimeout: 30000,
    });

    logger.debug(`[SSH] Connected successfully`);

    // Créer le répertoire distant s'il n'existe pas
    try {
      await client.mkdir(remoteDir, true); // true = récursif
      logger.debug(`[SSH] Ensured remote directory exists: ${remoteDir}`);
    } catch (err) {
      // Le répertoire existe peut-être déjà, continuer
      logger.debug(`[SSH] Directory creation (may already exist): ${err}`);
    }

    // Transférer le fichier
    logger.info(`[SSH] Uploading ${filename} to ${remotePath}...`);
    await client.put(localPath, remotePath);

    // Vérifier que le fichier a bien été transféré
    const stats = await client.stat(remotePath);
    logger.info(`[SSH] Upload completed: ${remotePath} (${formatBytes(stats.size)})`);

    return {
      remotePath,
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[SSH] Transfer failed: ${message}`);
    throw new Error(`SSH transfer failed: ${message}`);
  } finally {
    try {
      await client.end();
    } catch (err) {
      // Ignorer les erreurs de fermeture
      logger.debug(`[SSH] Error closing connection: ${err}`);
    }
  }
}

/**
 * Liste les fichiers dans un répertoire distant
 */
export async function listRemoteFiles(remoteDir: string, sshConfig: SSHConfig): Promise<string[]> {
  const client = new SftpClient();

  try {
    const privateKey = readFileSync(sshConfig.keyPath, "utf-8");

    await client.connect({
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.user,
      privateKey,
      passphrase: sshConfig.keyPassphrase,
      readyTimeout: 30000,
    });

    try {
      const files = await client.list(remoteDir);
      return files.map((f: { name: string }) => f.name).filter((name: string) => !name.startsWith("."));
    } catch (err) {
      // Le répertoire n'existe peut-être pas encore
      if (err instanceof Error && err.message.includes("No such file")) {
        return [];
      }
      throw err;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[SSH] Failed to list remote files: ${message}`);
    throw new Error(`SSH list failed: ${message}`);
  } finally {
    try {
      await client.end();
    } catch (err) {
      logger.debug(`[SSH] Error closing connection: ${err}`);
    }
  }
}

/**
 * Supprime un fichier distant
 */
export async function deleteRemoteFile(remotePath: string, sshConfig: SSHConfig): Promise<void> {
  const client = new SftpClient();

  try {
    const privateKey = readFileSync(sshConfig.keyPath, "utf-8");

    await client.connect({
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.user,
      privateKey,
      passphrase: sshConfig.keyPassphrase,
      readyTimeout: 30000,
    });

    await client.delete(remotePath);
    logger.debug(`[SSH] Deleted remote file: ${remotePath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[SSH] Failed to delete remote file ${remotePath}: ${message}`);
    // Ne pas throw, on continue même si la suppression échoue
  } finally {
    try {
      await client.end();
    } catch (err) {
      logger.debug(`[SSH] Error closing connection: ${err}`);
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

