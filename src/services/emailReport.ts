import { hostname } from "os";
import { logger } from "../utils/logger.js";
import { formatBytes, formatDuration } from "../utils/format.js";
import type { EmailNotificationConfig, EmailProvider } from "../config/schema.js";

/**
 * Corps du message, indépendant du provider.
 */
interface EmailMessage {
  subject: string;
  text: string;
  html: string;
}

interface ProviderAdapter {
  /** Nom affiché dans les logs */
  label: string;
  endpoint: string;
  buildBody(config: EmailNotificationConfig, message: EmailMessage): unknown;
}

/**
 * Les deux APIs s'authentifient de la même façon (`Authorization: Bearer`) et
 * ne diffèrent que par l’URL et la forme du corps JSON.
 */
const PROVIDERS: Record<EmailProvider, ProviderAdapter> = {
  sendgrid: {
    label: "SendGrid",
    endpoint: "https://api.sendgrid.com/v3/mail/send",
    buildBody: (config, message) => ({
      personalizations: [{ to: config.to.map((email) => ({ email })) }],
      from: { email: config.from, ...(config.from_name ? { name: config.from_name } : {}) },
      subject: message.subject,
      content: [
        { type: "text/plain", value: message.text },
        { type: "text/html", value: message.html },
      ],
    }),
  },
  resend: {
    label: "Resend",
    endpoint: "https://api.resend.com/emails",
    buildBody: (config, message) => ({
      from: formatSender(config.from, config.from_name),
      to: config.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  },
};

/**
 * Expéditeur au format RFC 5322 attendu par Resend : `Nom <adresse>`, ou
 * l'adresse seule sans nom. Un nom contenant un caractère spécial doit être
 * mis entre guillemets, sinon l'adresse entière est rejetée.
 */
function formatSender(email: string, name?: string): string {
  if (!name) return email;
  const display = /[(),.:;<>@[\\\]"]/.test(name) ? `"${name.replace(/(["\\])/g, "\\$1")}"` : name;
  return `${display} <${email}>`;
}

/**
 * Données d'un rapport de sauvegarde envoyé par email
 */
export interface BackupReport {
  /** Nom de l'instance Shuttle (config.shuttle.name) */
  shuttleName: string;
  jobName: string;
  jobType: "full" | "tables";
  tables?: string[];
  success: boolean;
  startedAt: Date;
  durationMs: number;
  error?: string;

  /** Serveur d'origine : la base PostgreSQL qui a été dumpée */
  source: {
    host: string;
    port: number;
    database: string;
    user: string;
  };

  /** Machine sur laquelle Shuttle s'est exécuté */
  runnerHostname: string;

  /** Serveur de destination (SSH/SFTP) */
  target: {
    host: string;
    port: number;
    user: string;
  };

  /** Ce qui a effectivement été envoyé (absent si le job a échoué avant l'envoi) */
  artifact?: {
    filename: string;
    localPath: string;
    remotePath: string;
    size: number;
    format: "plain" | "custom";
    compressed: boolean;
  };

  retention?: {
    localDeleted: number;
    remoteDeleted: number;
  };
}

export function getRunnerHostname(): string {
  try {
    return hostname();
  } catch {
    return "unknown";
  }
}

/**
 * Décide si un rapport doit être envoyé selon la config `on`
 */
export function shouldNotify(config: EmailNotificationConfig, success: boolean): boolean {
  if (config.on === "always") return true;
  if (config.on === "success") return success;
  return !success;
}

/**
 * Envoie le rapport de sauvegarde par email via l'API du provider configuré.
 *
 * Ne lève jamais d'exception : une notification qui échoue ne doit pas
 * faire échouer une sauvegarde qui, elle, a réussi.
 */
export async function sendBackupReport(
  config: EmailNotificationConfig,
  report: BackupReport
): Promise<boolean> {
  if (!shouldNotify(config, report.success)) {
    logger.debug(`[${report.jobName}] Email report skipped (on: ${config.on})`);
    return false;
  }

  const provider = PROVIDERS[config.provider];
  const message: EmailMessage = {
    subject: buildSubject(config, report),
    text: buildTextBody(report),
    html: buildHtmlBody(report),
  };

  try {
    const response = await fetch(provider.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(provider.buildBody(config, message)),
      signal: AbortSignal.timeout(config.timeout),
    });

    if (!response.ok) {
      // Le corps d'erreur des deux providers ne contient pas la clé d'API,
      // uniquement la description du problème (adresse invalide, quota, etc.)
      const detail = await response.text().catch(() => "");
      logger.warn(
        `[${report.jobName}] Email report not sent (${provider.label} ${response.status}): ${truncate(detail, 500)}`
      );
      return false;
    }

    logger.info(`[${report.jobName}] Email report sent to ${config.to.join(", ")}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[${report.jobName}] Failed to send email report: ${message}`);
    return false;
  }
}

function buildSubject(config: EmailNotificationConfig, report: BackupReport): string {
  const prefix = config.subject_prefix ? `${config.subject_prefix} ` : "";
  const status = report.success ? "OK" : "FAILED";
  return `${prefix}[${status}] ${report.shuttleName} / ${report.jobName} — ${report.source.database}@${report.source.host}`;
}

function buildTextBody(report: BackupReport): string {
  const lines: string[] = [];

  lines.push(report.success ? "Sauvegarde envoyée avec succès" : "Échec de la sauvegarde");
  lines.push("");
  lines.push(`Shuttle    : ${report.shuttleName}`);
  lines.push(`Job        : ${report.jobName} (${report.jobType})`);
  if (report.tables?.length) {
    lines.push(`Tables     : ${report.tables.join(", ")}`);
  }
  lines.push(`Démarré le : ${report.startedAt.toISOString()}`);
  lines.push(`Durée      : ${formatDuration(report.durationMs)}`);
  lines.push("");

  lines.push("— Serveur d'origine —");
  lines.push(`Base       : ${report.source.database}`);
  lines.push(`Hôte       : ${report.source.host}:${report.source.port}`);
  lines.push(`Utilisateur: ${report.source.user}`);
  lines.push(`Exécuté sur: ${report.runnerHostname}`);
  lines.push("");

  lines.push("— Destination —");
  lines.push(`Serveur    : ${report.target.user}@${report.target.host}:${report.target.port}`);
  lines.push("");

  if (report.artifact) {
    lines.push("— Fichier envoyé —");
    lines.push(`Nom        : ${report.artifact.filename}`);
    lines.push(`Taille     : ${formatBytes(report.artifact.size)}`);
    lines.push(
      `Format     : ${report.artifact.format}${report.artifact.compressed ? " (gzip)" : ""}`
    );
    lines.push(`Chemin dist: ${report.artifact.remotePath}`);
    lines.push(`Chemin local: ${report.artifact.localPath}`);
    lines.push("");
  } else {
    lines.push("Aucun fichier n'a été transféré.");
    lines.push("");
  }

  if (report.retention) {
    lines.push("— Rétention —");
    lines.push(`Supprimés localement : ${report.retention.localDeleted}`);
    lines.push(`Supprimés à distance : ${report.retention.remoteDeleted}`);
    lines.push("");
  }

  if (report.error) {
    lines.push("— Erreur —");
    lines.push(report.error);
    lines.push("");
  }

  return lines.join("\n");
}

function buildHtmlBody(report: BackupReport): string {
  const color = report.success ? "#1a7f37" : "#c1121f";
  const title = report.success ? "Sauvegarde envoyée avec succès" : "Échec de la sauvegarde";

  const sections: string[] = [];

  sections.push(
    section("Serveur d'origine", [
      ["Base de données", report.source.database],
      ["Hôte", `${report.source.host}:${report.source.port}`],
      ["Utilisateur", report.source.user],
      ["Exécuté depuis", report.runnerHostname],
    ])
  );

  sections.push(
    section("Destination", [
      ["Serveur", `${report.target.user}@${report.target.host}:${report.target.port}`],
    ])
  );

  if (report.artifact) {
    sections.push(
      section("Fichier envoyé", [
        ["Nom", report.artifact.filename],
        ["Taille", formatBytes(report.artifact.size)],
        ["Format", `${report.artifact.format}${report.artifact.compressed ? " (gzip)" : ""}`],
        ["Chemin distant", report.artifact.remotePath],
        ["Chemin local", report.artifact.localPath],
      ])
    );
  }

  if (report.retention) {
    sections.push(
      section("Rétention", [
        ["Supprimés localement", String(report.retention.localDeleted)],
        ["Supprimés à distance", String(report.retention.remoteDeleted)],
      ])
    );
  }

  if (report.error) {
    sections.push(
      `<h3 style="margin:24px 0 8px;font-size:14px;color:#c1121f;">Erreur</h3>` +
        `<pre style="margin:0;padding:12px;background:#fff5f5;border:1px solid #ffd7d7;border-radius:4px;` +
        `white-space:pre-wrap;font-size:12px;color:#5c1a1a;">${escapeHtml(report.error)}</pre>`
    );
  }

  const summary: Array<[string, string]> = [
    ["Shuttle", report.shuttleName],
    ["Job", `${report.jobName} (${report.jobType})`],
  ];
  if (report.tables?.length) {
    summary.push(["Tables", report.tables.join(", ")]);
  }
  summary.push(["Démarré le", report.startedAt.toISOString()]);
  summary.push(["Durée", formatDuration(report.durationMs)]);

  return `<!doctype html>
<html lang="fr">
<body style="margin:0;padding:24px;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2328;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d0d7de;border-radius:6px;padding:24px;">
    <h1 style="margin:0 0 4px;font-size:18px;color:${color};">${escapeHtml(title)}</h1>
    <p style="margin:0 0 16px;font-size:13px;color:#656d76;">Rapport Shuttle</p>
    ${section("Résumé", summary)}
    ${sections.join("\n")}
  </div>
</body>
</html>`;
}

function section(title: string, rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([label, value]) =>
        `<tr>` +
        `<td style="padding:4px 12px 4px 0;font-size:13px;color:#656d76;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0;font-size:13px;color:#1f2328;word-break:break-all;">${escapeHtml(value)}</td>` +
        `</tr>`
    )
    .join("");

  return (
    `<h3 style="margin:24px 0 8px;font-size:14px;">${escapeHtml(title)}</h3>` +
    `<table style="border-collapse:collapse;width:100%;">${body}</table>`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
