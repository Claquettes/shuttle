import { createHash, createHmac, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import { logger } from "../utils/logger.js";
import type { SSHConfig } from "../config/types.js";

/**
 * Vérification de la clé d'hôte SSH.
 *
 * Sans vérification, un attaquant capable de détourner la connexion (DNS, BGP,
 * réseau local) se fait passer pour le serveur de backup et reçoit une copie
 * intégrale de la base de production. On refuse donc toute clé qui ne
 * correspond pas à ce qui est déclaré dans la configuration.
 */

export interface HostKeyVerification {
  /** Callback `hostVerifier` passé à ssh2, ou undefined si aucune vérification */
  verifier?: (key: Buffer) => boolean;
  /** true si une vérification est réellement active */
  enabled: boolean;
}

/**
 * Empreinte OpenSSH d'une clé d'hôte : `SHA256:<base64 sans padding>`
 */
export function fingerprintOf(key: Buffer): string {
  const digest = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  return `SHA256:${digest}`;
}

export function buildHostVerifier(sshConfig: SSHConfig): HostKeyVerification {
  const accepted = new Set<string>();

  for (const raw of sshConfig.hostFingerprints ?? []) {
    accepted.add(normalizeFingerprint(raw));
  }

  if (sshConfig.knownHostsPath) {
    for (const key of loadKnownHostKeys(sshConfig.knownHostsPath, sshConfig.host, sshConfig.port)) {
      accepted.add(fingerprintOf(key));
    }
    if (accepted.size === 0) {
      throw new Error(
        `No host key found for ${sshConfig.host}:${sshConfig.port} in ${sshConfig.knownHostsPath}. ` +
          `Add it with: ssh-keyscan -p ${sshConfig.port} ${sshConfig.host} >> ${sshConfig.knownHostsPath}`
      );
    }
  }

  if (accepted.size === 0) {
    if (sshConfig.strictHostKey) {
      throw new Error(
        "strict_host_key is enabled but no 'known_hosts' or 'host_fingerprint' is configured for the target"
      );
    }
    logger.warn(
      `[SSH] Host key verification is DISABLED for ${sshConfig.host}:${sshConfig.port}. ` +
        `Anyone able to intercept this connection would receive your database dump. ` +
        `Set 'known_hosts' or 'host_fingerprint' on the target to enable it.`
    );
    return { enabled: false };
  }

  return {
    enabled: true,
    verifier: (key: Buffer) => {
      const presented = fingerprintOf(key);
      const match = [...accepted].some((expected) => constantTimeEquals(expected, presented));
      if (!match) {
        logger.error(
          `[SSH] Host key mismatch for ${sshConfig.host}:${sshConfig.port}. ` +
            `Presented ${presented}, expected one of: ${[...accepted].join(", ")}. Aborting.`
        );
      }
      return match;
    },
  };
}

/**
 * Accepte `SHA256:xxx`, `sha256:xxx` ou l'empreinte brute en base64.
 */
function normalizeFingerprint(raw: string): string {
  const value = raw.trim();
  const withoutPrefix = value.replace(/^sha256:/i, "");
  return `SHA256:${withoutPrefix.replace(/=+$/, "")}`;
}

/**
 * Extrait les clés publiques d'un fichier known_hosts pour un hôte donné.
 * Gère les entrées en clair (`host,host2 type base64`) et les entrées
 * hachées (`|1|salt|hash type base64`).
 */
function loadKnownHostKeys(path: string, host: string, port: number): Buffer[] {
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read known_hosts file ${path}: ${message}`);
  }

  const candidates = port === 22 ? [host] : [`[${host}]:${port}`, host];
  const keys: Buffer[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Ignore les marqueurs @cert-authority / @revoked : non supportés ici.
    if (trimmed.startsWith("@")) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;

    const [hostField, , keyBase64] = parts;
    if (!matchesHost(hostField, candidates)) continue;

    try {
      keys.push(Buffer.from(keyBase64, "base64"));
    } catch {
      // Ligne malformée : on l'ignore plutôt que de faire échouer la lecture.
    }
  }

  return keys;
}

function matchesHost(hostField: string, candidates: string[]): boolean {
  if (hostField.startsWith("|1|")) {
    // Entrée hachée : |1|<salt base64>|<hash base64>, HMAC-SHA1 du nom d'hôte.
    const [, , saltB64, hashB64] = hostField.split("|");
    if (!saltB64 || !hashB64) return false;
    try {
      const salt = Buffer.from(saltB64, "base64");
      return candidates.some((candidate) => {
        const computed = createHmac("sha1", salt).update(candidate).digest("base64");
        return constantTimeEquals(computed, hashB64);
      });
    } catch {
      return false;
    }
  }

  // Entrée en clair : plusieurs hôtes séparés par des virgules.
  const listed = hostField.split(",");
  return listed.some((entry) => candidates.includes(entry));
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
