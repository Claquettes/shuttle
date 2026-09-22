// Chaîne complète : PostgreSQL réel -> pg_dump -> SFTP réel -> vérification
// -> rétention -> rapport email.
import fs from "fs";
import path from "path";
import assert from "assert";
import { startSftpServer } from "./sftpServer.mjs";

const T = process.env.TDIR;

// La base de test peut être fournie par l'extérieur (services CI) ou démarrée
// par tests/run.sh via Docker.
const PG = {
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 55432),
  database: process.env.PGDATABASE || "testdb",
  user: process.env.PGUSER || "testuser",
  password: process.env.PGPASSWORD || "testpw",
};
const BDIR = path.join(T, "e2e-local");
fs.rmSync(BDIR, { recursive: true, force: true });
process.env.SHUTTLE_LOCAL_BACKUP_DIR = BDIR;

const root = path.join(T, "e2e-remote");
fs.rmSync(root, { recursive: true, force: true });
const srv = await startSftpServer({ rootDir: root, hostKey: fs.readFileSync(path.join(T, "hostkey")) });

const sent = [];
globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 202, text: async () => "" }; };

const { executeJob } = await import("../dist/core/jobs.js");
const { fingerprintOf } = await import("../dist/services/hostKey.js");

const hostKeyBuf = Buffer.from(fs.readFileSync(path.join(T, "hostkey.pub"), "utf8").split(" ")[1], "base64");

const resolved = {
  config: { version: 1, shuttle: { name: "prod-shuttle", timezone: "UTC",
    notifications: { email: { provider: "sendgrid", api_key: "SG.k", from: "s@x.com",
      to: ["ops@x.com"], on: "always", timeout: 5000 } } } },
  sourceDbConfig: PG,
  targetSshConfig: { host: "127.0.0.1", port: srv.port, user: "backup",
    keyPath: path.join(T, "clientkey"), basePath: "/backups/prod",
    hostFingerprints: [fingerprintOf(hostKeyBuf)], strictHostKey: true },
};

const job = { name: "nightly", type: "tables", tables: ["public.users"], cron: "0 3 * * *",
              format: "custom", compress: true, keepLast: 2 };

console.log("\n=== Chaîne complète ===");
const r1 = await executeJob(job, resolved);
assert.strictEqual(r1.success, true, `job échoué: ${r1.error}`);

const dateDir = new Date().toISOString().split("T")[0];
const remoteDir = path.join(root, "backups/prod/nightly", dateDir);
const remoteFiles = fs.readdirSync(remoteDir);
assert.strictEqual(remoteFiles.length, 1);
console.log(`  ok   dump transféré et vérifié : ${remoteFiles[0]}`);

// La taille distante doit correspondre exactement au fichier local
assert.strictEqual(fs.statSync(path.join(remoteDir, remoteFiles[0])).size, fs.statSync(r1.dumpPath).size);
console.log(`  ok   taille distante == taille locale (${r1.size} octets)`);
assert.ok(!remoteFiles.some((f) => f.endsWith(".part")), "un .part subsiste");
console.log("  ok   aucun fichier .part résiduel");

// Le dump doit être un gzip valide, restaurable
const { execFileSync } = await import("child_process");
execFileSync("gzip", ["-t", r1.dumpPath]);
const listing = execFileSync("bash", ["-c", `gunzip -c '${r1.dumpPath}' | pg_restore -l | grep -c 'TABLE DATA public users'`]).toString().trim();
assert.strictEqual(listing, "1");
console.log("  ok   dump restaurable (pg_restore -l voit public.users)");

console.log(`  ok   permissions locales 0${(fs.statSync(r1.dumpPath).mode & 0o777).toString(8)}`);
console.log(`  ok   répertoire local 0${(fs.statSync(BDIR).mode & 0o777).toString(8)}`);

// Rapport email
assert.strictEqual(sent.length, 1);
const body = sent[0].content[0].value;
assert.match(sent[0].subject, new RegExp(`\\[OK\\] prod-shuttle / nightly — ${PG.database}@${PG.host}`));
assert.match(body, new RegExp(`Base       : ${PG.database}`));
assert.match(body, new RegExp(`Hôte       : ${PG.host}:${PG.port}`));
assert.match(body, new RegExp(remoteFiles[0].replace(/\./g, "\\.")));
console.log("  ok   rapport email : serveur d'origine + fichier envoyé");

// Rétention sur plusieurs exécutions
console.log("\n=== Rétention sur exécutions successives (keepLast: 2) ===");
for (let i = 0; i < 3; i++) {
  await new Promise((r) => setTimeout(r, 1100)); // horodatage à la seconde
  const res = await executeJob(job, resolved);
  assert.strictEqual(res.success, true, `run ${i + 2} échoué: ${res.error}`);
}
const finalRemote = fs.readdirSync(path.join(root, "backups/prod/nightly"))
  .flatMap((d) => fs.readdirSync(path.join(root, "backups/prod/nightly", d)));
const finalLocal = fs.readdirSync(BDIR).filter((f) => f.startsWith("nightly_"));
assert.strictEqual(finalRemote.length, 2, `distant: ${finalRemote.join(", ")}`);
assert.strictEqual(finalLocal.length, 2, `local: ${finalLocal.join(", ")}`);
console.log(`  ok   4 exécutions -> 2 sauvegardes distantes conservées`);
console.log(`  ok   4 exécutions -> 2 sauvegardes locales conservées`);
assert.ok(finalRemote.every((f) => finalLocal.includes(f)), "local et distant désynchronisés");
console.log("  ok   les sauvegardes conservées sont les mêmes des deux côtés");
assert.strictEqual(sent.length, 4);
console.log(`  ok   4 rapports email envoyés (un par sauvegarde)`);

await srv.close();
console.log("\nE2E : TOUT PASSE\n");
