import fs from "fs";
import path from "path";
import assert from "assert";
import { createHash } from "crypto";
import { startSftpServer } from "./sftpServer.mjs";
import { SftpSession, withSftp } from "../dist/services/sshTransfer.js";
import { applyRetention, extractTimestamp } from "../dist/services/retention.js";
import { fingerprintOf, buildHostVerifier } from "../dist/services/hostKey.js";

const T = process.env.TDIR;
const HOSTKEY = fs.readFileSync(path.join(T, "hostkey"));
const CLIENTKEY = path.join(T, "clientkey");
const REAL_FP = fs.readFileSync(path.join(T, "hostkey.pub"), "utf8");

let pass = 0, fail = 0;
const check = (name, fn) => fn().then(
  () => { console.log(`  ok   ${name}`); pass++; },
  (e) => { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
);

const baseCfg = (port, extra = {}) => ({
  host: "127.0.0.1", port, user: "backup",
  keyPath: CLIENTKEY, basePath: "/backups", strictHostKey: false, ...extra,
});

const mkRoot = (n) => { const d = path.join(T, `srv-${n}`); fs.rmSync(d, {recursive:true,force:true}); fs.mkdirSync(d,{recursive:true}); return d; };
const mkLocal = (name, bytes) => {
  const d = path.join(T, "local"); fs.mkdirSync(d, { recursive: true });
  const p = path.join(d, name); fs.writeFileSync(p, Buffer.alloc(bytes, 0x41)); return p;
};

console.log("\n=== 1. Vérification de la clé d'hôte ===");

await check("empreinte calculée == `ssh-keygen -lf`", async () => {
  const keyBuf = Buffer.from(REAL_FP.split(" ")[1], "base64");
  const expected = fs.readFileSync(path.join(T, "expected_fp"), "utf8").trim();
  assert.strictEqual(fingerprintOf(keyBuf), expected);
  assert.strictEqual(fingerprintOf(keyBuf),
    `SHA256:${createHash("sha256").update(keyBuf).digest("base64").replace(/=+$/, "")}`);
});

await check("bonne empreinte -> connexion acceptée", async () => {
  const root = mkRoot("fp-ok");
  const s = await startSftpServer({ rootDir: root, hostKey: HOSTKEY });
  const keyBuf = Buffer.from(REAL_FP.split(" ")[1], "base64");
  try {
    await withSftp(baseCfg(s.port, { hostFingerprints: [fingerprintOf(keyBuf)] }), async (x) => x.list("/backups"));
  } finally { await s.close(); }
});

await check("MAUVAISE empreinte -> connexion REJETÉE", async () => {
  const root = mkRoot("fp-bad");
  const s = await startSftpServer({ rootDir: root, hostKey: HOSTKEY });
  try {
    await withSftp(baseCfg(s.port, { hostFingerprints: ["SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"] }),
      async (x) => x.list("/backups"));
    throw new Error("la connexion aurait dû être rejetée");
  } catch (e) {
    assert.ok(!/aurait dû/.test(e.message), "connexion acceptée malgré une empreinte invalide");
  } finally { await s.close(); }
});

await check("known_hosts (ssh-keyscan) -> accepté", async () => {
  const root = mkRoot("kh");
  const s = await startSftpServer({ rootDir: root, hostKey: HOSTKEY });
  const kh = path.join(T, "known_hosts");
  const keyLine = REAL_FP.trim().split(" ").slice(0, 2).join(" ");
  fs.writeFileSync(kh, `[127.0.0.1]:${s.port} ${keyLine}\n`);
  try {
    await withSftp(baseCfg(s.port, { knownHostsPath: kh }), async (x) => x.list("/backups"));
  } finally { await s.close(); }
});

await check("known_hosts sans l'hôte -> erreur explicite", async () => {
  const kh = path.join(T, "known_hosts_empty");
  fs.writeFileSync(kh, "# vide\n");
  assert.throws(() => buildHostVerifier(baseCfg(2222, { knownHostsPath: kh })), /No host key found/);
});

await check("strict_host_key sans config -> refus de démarrer", async () => {
  assert.throws(() => buildHostVerifier(baseCfg(2222, { strictHostKey: true })), /strict_host_key/);
});

console.log("\n=== 2. Intégrité et atomicité du transfert ===");

await check("upload nominal : vérifié et renommé", async () => {
  const root = mkRoot("up-ok");
  const s = await startSftpServer({ rootDir: root, hostKey: HOSTKEY });
  const local = mkLocal("job-a_2026-09-09T03-00-00.dump.gz", 300000);
  try {
    const r = await withSftp(baseCfg(s.port), (x) => x.upload(local, "/backups/job-a/2026-09-09"));
    assert.strictEqual(r.size, 300000);
    const dest = path.join(root, "backups/job-a/2026-09-09/job-a_2026-09-09T03-00-00.dump.gz");
    assert.ok(fs.existsSync(dest), "fichier final absent");
    assert.strictEqual(fs.statSync(dest).size, 300000);
    assert.ok(!fs.existsSync(`${dest}.part`), "le .part temporaire subsiste");
  } finally { await s.close(); }
});

await check("upload TRONQUÉ -> rejeté, aucun fichier final laissé", async () => {
  const root = mkRoot("up-trunc");
  const s = await startSftpServer({ rootDir: root, hostKey: HOSTKEY, truncateAfter: 100000 });
  const local = mkLocal("job-b_2026-09-09T03-00-00.dump.gz", 400000);
  try {
    await withSftp(baseCfg(s.port), (x) => x.upload(local, "/backups/job-b/2026-09-09"));
    throw new Error("SENTINEL: le transfert tronqué a été accepté");
  } catch (e) {
    assert.ok(!e.message.startsWith("SENTINEL"), e.message);
    assert.match(e.message, /verification failed/i);
    const dir = path.join(root, "backups/job-b/2026-09-09");
    const left = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    assert.deepStrictEqual(left, [], `résidus après échec: ${left.join(", ")}`);
  } finally { await s.close(); }
});

await check("dump vide -> refus d'envoyer", async () => {
  const root = mkRoot("up-empty");
  const s = await startSftpServer({ rootDir: root, hostKey: HOSTKEY });
  const local = mkLocal("job-c_2026-09-09T03-00-00.dump.gz", 0);
  try {
    await withSftp(baseCfg(s.port), (x) => x.upload(local, "/backups/job-c/2026-09-09"));
    throw new Error("SENTINEL: dump vide accepté");
  } catch (e) {
    assert.ok(!e.message.startsWith("SENTINEL"), e.message);
    assert.match(e.message, /empty dump/i);
  } finally { await s.close(); }
});

console.log("\n=== 3. Rétention ===");

await check("rétention distante descend dans les dossiers de date", async () => {
  const root = mkRoot("ret");
  const s = await startSftpServer({ rootDir: root, hostKey: HOSTKEY });
  const jobDir = path.join(root, "backups/nightly");
  for (const d of ["2026-09-01","2026-09-02","2026-09-03","2026-09-04","2026-09-05"]) {
    fs.mkdirSync(path.join(jobDir, d), { recursive: true });
    fs.writeFileSync(path.join(jobDir, d, `nightly_${d}T03-00-00.dump.gz`), "x");
  }
  const job = { name: "nightly", type: "full", cron: "0 3 * * *", format: "custom", compress: true, keepLast: 2 };
  try {
    const r = await withSftp(baseCfg(s.port), (x) => applyRetention(job, x, "/backups/nightly"));
    assert.strictEqual(r.remoteDeleted, 3, `attendu 3 suppressions, obtenu ${r.remoteDeleted}`);
    const remaining = fs.readdirSync(jobDir).flatMap((d) => fs.readdirSync(path.join(jobDir, d)));
    assert.strictEqual(remaining.length, 2);
    assert.ok(remaining.every((f) => /2026-09-0(4|5)/.test(f)), `gardés: ${remaining.join(", ")}`);
  } finally { await s.close(); }
});

await check("la sauvegarde protégée n'est jamais supprimée", async () => {
  const root = mkRoot("ret-prot");
  const s = await startSftpServer({ rootDir: root, hostKey: HOSTKEY });
  const jobDir = path.join(root, "backups/nightly");
  for (const d of ["2026-09-01","2026-09-02","2026-09-03"]) {
    fs.mkdirSync(path.join(jobDir, d), { recursive: true });
    fs.writeFileSync(path.join(jobDir, d, `nightly_${d}T03-00-00.dump.gz`), "x");
  }
  const job = { name: "nightly", type: "full", cron: "0 3 * * *", format: "custom", compress: true, keepLast: 1 };
  // La plus ANCIENNE est protégée : sans le garde, keepLast:1 la supprimerait.
  const protectedPath = "/backups/nightly/2026-09-01/nightly_2026-09-01T03-00-00.dump.gz";
  try {
    const r = await withSftp(baseCfg(s.port), (x) => applyRetention(job, x, "/backups/nightly", { protectRemotePath: protectedPath }));
    assert.ok(fs.existsSync(path.join(root, protectedPath.slice(1))), "la sauvegarde protégée a été supprimée !");
    // La rétention doit bien avoir tourné : elle a purgé l'autre surnuméraire.
    assert.strictEqual(r.remoteDeleted, 1, `attendu 1 suppression (hors protégée), obtenu ${r.remoteDeleted}`);
  } finally { await s.close(); }
});

await check("horodatage illisible -> fichier laissé intact", async () => {
  const root = mkRoot("ret-bad");
  const s = await startSftpServer({ rootDir: root, hostKey: HOSTKEY });
  const jobDir = path.join(root, "backups/nightly/2026-09-01");
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, "nightly_GARBAGE.dump.gz"), "x");
  for (const t of ["01","02","03"]) fs.writeFileSync(path.join(jobDir, `nightly_2026-09-01T${t}-00-00.dump.gz`), "x");
  const job = { name: "nightly", type: "full", cron: "0 3 * * *", format: "custom", compress: true, keepLast: 1 };
  try {
    const r = await withSftp(baseCfg(s.port), (x) => applyRetention(job, x, "/backups/nightly"));
    assert.ok(fs.existsSync(path.join(jobDir, "nightly_GARBAGE.dump.gz")), "fichier non daté supprimé !");
    // Les 3 fichiers datés sont bien traités : 2 purgés, 1 gardé.
    assert.strictEqual(r.remoteDeleted, 2, `attendu 2 suppressions, obtenu ${r.remoteDeleted}`);
  } finally { await s.close(); }
});

await check("un .part n'est jamais compté ni supprimé", async () => {
  const root = mkRoot("ret-part");
  const s = await startSftpServer({ rootDir: root, hostKey: HOSTKEY });
  const jobDir = path.join(root, "backups/nightly/2026-09-01");
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, "nightly_2026-09-01T09-00-00.dump.gz.part"), "x");
  for (const t of ["01","02"]) fs.writeFileSync(path.join(jobDir, `nightly_2026-09-01T${t}-00-00.dump.gz`), "x");
  const job = { name: "nightly", type: "full", cron: "0 3 * * *", format: "custom", compress: true, keepLast: 1 };
  try {
    const r = await withSftp(baseCfg(s.port), (x) => applyRetention(job, x, "/backups/nightly"));
    assert.strictEqual(r.remoteDeleted, 1);
    assert.ok(fs.existsSync(path.join(jobDir, "nightly_2026-09-01T09-00-00.dump.gz.part")));
  } finally { await s.close(); }
});

await check("horodatage parsé en UTC", async () => {
  const d = extractTimestamp("job_2026-09-09T03-30-15.dump.gz");
  assert.strictEqual(d.toISOString(), "2026-09-09T03:30:15.000Z");
  assert.strictEqual(extractTimestamp("job_pas-de-date.gz"), null);
});

console.log(`\n${fail === 0 ? "TOUS LES TESTS PASSENT" : "ÉCHECS"} : ${pass} ok, ${fail} ko\n`);
process.exit(fail === 0 ? 0 : 1);
