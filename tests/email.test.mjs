// Rapport email : contenu, filtres, robustesse. Aucun appel réseau réel.
import assert from "assert";
import { sendBackupReport, shouldNotify } from "../dist/services/emailReport.js";

let pass = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; } };

const cfg = { provider: "sendgrid", api_key: "SG.super-secret-key", from: "shuttle@x.com",
  from_name: "Shuttle", to: ["ops@x.com", "cto@x.com"], on: "always", subject_prefix: "[Prod]", timeout: 15000 };

const report = {
  shuttleName: "prod-shuttle", jobName: "full-nightly", jobType: "full", success: true,
  startedAt: new Date("2026-09-09T03:00:00Z"), durationMs: 94500,
  source: { host: "db.internal", port: 5432, database: "prod_app", user: "backup_ro" },
  runnerHostname: "app-server-01",
  target: { host: "backup.example.com", port: 22, user: "backup" },
  artifact: { filename: "full-nightly_2026-09-09T03-00-00.dump.gz",
    localPath: "/backups/full-nightly_2026-09-09T03-00-00.dump.gz",
    remotePath: "/backups/prod/full-nightly/2026-09-09/full-nightly_2026-09-09T03-00-00.dump.gz",
    size: 483827712, format: "custom", compressed: true },
  retention: { localDeleted: 2, remoteDeleted: 1 },
};

let captured;
const okFetch = async (url, init) => { captured = { url, init }; return { ok: true, status: 202, text: async () => "" }; };

console.log("\n=== Rapport email ===");

await check("payload SendGrid conforme", async () => {
  globalThis.fetch = okFetch;
  assert.strictEqual(await sendBackupReport(cfg, report), true);
  assert.strictEqual(captured.url, "https://api.sendgrid.com/v3/mail/send");
  assert.strictEqual(captured.init.headers.Authorization, "Bearer SG.super-secret-key");
  const b = JSON.parse(captured.init.body);
  assert.deepStrictEqual(b.personalizations[0].to, [{ email: "ops@x.com" }, { email: "cto@x.com" }]);
  assert.deepStrictEqual(b.from, { email: "shuttle@x.com", name: "Shuttle" });
  assert.deepStrictEqual(b.content.map((c) => c.type), ["text/plain", "text/html"]);
});

await check("contient le serveur d'origine et le fichier envoyé", async () => {
  const b = JSON.parse(captured.init.body);
  const txt = b.content[0].value;
  assert.match(b.subject, /\[Prod\] \[OK\] prod-shuttle \/ full-nightly — prod_app@db\.internal/);
  assert.match(txt, /Base       : prod_app/);
  assert.match(txt, /Hôte       : db\.internal:5432/);
  assert.match(txt, /Utilisateur: backup_ro/);
  assert.match(txt, /Exécuté sur: app-server-01/);
  assert.match(txt, /Serveur    : backup@backup\.example\.com:22/);
  assert.match(txt, /Nom        : full-nightly_2026-09-09T03-00-00\.dump\.gz/);
  assert.match(txt, /Taille     : 461\.41 MB/);
  assert.match(txt, /Durée      : 1 min 35 s/);
});

await check("la clé d'API n'apparaît jamais dans le message", async () => {
  assert.ok(!captured.init.body.includes("super-secret-key"));
});

await check("échec : sujet FAILED + raison, sans fichier", async () => {
  globalThis.fetch = okFetch;
  await sendBackupReport(cfg, { ...report, success: false, artifact: undefined,
    retention: undefined, error: "SSH transfer failed: connect ETIMEDOUT" });
  const b = JSON.parse(captured.init.body);
  assert.match(b.subject, /\[FAILED\]/);
  assert.match(b.content[0].value, /Aucun fichier n'a été transféré/);
  assert.match(b.content[0].value, /connect ETIMEDOUT/);
});

await check("HTML échappé (pas d'injection via le message d'erreur)", async () => {
  globalThis.fetch = okFetch;
  await sendBackupReport(cfg, { ...report, success: false, error: "<script>alert('x')</script>" });
  const html = JSON.parse(captured.init.body).content[1].value;
  assert.ok(html.includes("&lt;script&gt;") && !html.includes("<script>"));
});

await check("payload Resend conforme", async () => {
  globalThis.fetch = okFetch;
  const resendCfg = { ...cfg, provider: "resend", api_key: "re_super-secret-key" };
  assert.strictEqual(await sendBackupReport(resendCfg, report), true);
  assert.strictEqual(captured.url, "https://api.resend.com/emails");
  assert.strictEqual(captured.init.headers.Authorization, "Bearer re_super-secret-key");
  const b = JSON.parse(captured.init.body);
  assert.strictEqual(b.from, "Shuttle <shuttle@x.com>");
  assert.deepStrictEqual(b.to, ["ops@x.com", "cto@x.com"]);
  assert.match(b.subject, /\[Prod\] \[OK\] prod-shuttle \/ full-nightly/);
  assert.match(b.text, /Base       : prod_app/);
  assert.ok(b.html.startsWith("<!doctype html>"));
});

await check("Resend : expéditeur sans from_name, et nom spécial entre guillemets", async () => {
  globalThis.fetch = okFetch;
  await sendBackupReport({ ...cfg, provider: "resend", from_name: undefined }, report);
  assert.strictEqual(JSON.parse(captured.init.body).from, "shuttle@x.com");

  await sendBackupReport({ ...cfg, provider: "resend", from_name: "Shuttle, Prod" }, report);
  assert.strictEqual(JSON.parse(captured.init.body).from, '"Shuttle, Prod" <shuttle@x.com>');
});

await check("Resend : la clé d'API n'apparaît jamais dans le message", async () => {
  globalThis.fetch = okFetch;
  await sendBackupReport({ ...cfg, provider: "resend", api_key: "re_top-secret" }, report);
  assert.ok(!captured.init.body.includes("re_top-secret"));
});

await check("Resend : une erreur HTTP ne fait pas échouer la sauvegarde", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 422, text: async () => "domain not verified" });
  assert.strictEqual(await sendBackupReport({ ...cfg, provider: "resend" }, report), false);
});

await check("filtres `on`", async () => {
  assert.strictEqual(shouldNotify({ ...cfg, on: "success" }, false), false);
  assert.strictEqual(shouldNotify({ ...cfg, on: "success" }, true), true);
  assert.strictEqual(shouldNotify({ ...cfg, on: "failure" }, false), true);
  assert.strictEqual(shouldNotify({ ...cfg, on: "failure" }, true), false);
  assert.strictEqual(shouldNotify({ ...cfg, on: "always" }, true), true);
});

await check("une panne réseau ne fait pas échouer la sauvegarde", async () => {
  globalThis.fetch = async () => { throw new Error("network down"); };
  assert.strictEqual(await sendBackupReport(cfg, report), false);
});

await check("une erreur HTTP SendGrid ne fait pas échouer la sauvegarde", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => "unauthorized" });
  assert.strictEqual(await sendBackupReport(cfg, report), false);
});

console.log(`\n${fail === 0 ? "TOUS LES TESTS PASSENT" : "ÉCHECS"} : ${pass} ok, ${fail} ko\n`);
process.exit(fail === 0 ? 0 : 1);
