// Vérifie que la compression d'un gros dump ne charge pas le fichier en mémoire.
//
// Assertion auto-calibrée : le pic de RSS doit rester INFÉRIEUR à la taille du
// dump brut. L'implémentation en flux tient largement (~75 Mo quelle que soit
// la taille) ; une implémentation qui lit le fichier entier en mémoire dépasse
// mécaniquement ce seuil.
import fs from "fs";
import os from "os";
import path from "path";
import assert from "assert";
import { execFileSync } from "child_process";
import { runPgDump } from "../dist/services/pgDump.js";

const BDIR = fs.mkdtempSync(path.join(os.tmpdir(), "shuttle-mem-"));
process.env.SHUTTLE_LOCAL_BACKUP_DIR = BDIR;

const db = {
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 55432),
  database: process.env.PGDATABASE || "testdb",
  user: process.env.PGUSER || "testuser",
  password: process.env.PGPASSWORD || "testpw",
};

const mb = (n) => (n / 1024 / 1024).toFixed(1);

// Taille du dump non compressé, pour calibrer le seuil.
const rawPath = path.join(BDIR, "reference.sql");
execFileSync("pg_dump", ["-F", "p", "-h", db.host, "-p", String(db.port), "-d", db.database,
  "-U", db.user, "--no-owner", "--no-acl", "-f", rawPath], { env: { ...process.env, PGPASSWORD: db.password } });
const rawSize = fs.statSync(rawPath).size;
fs.unlinkSync(rawPath);

const job = { name: "mem-test", type: "full", cron: "0 3 * * *", format: "plain", compress: true, keepLast: 5 };

let peak = 0;
const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
const r = await runPgDump({ dbConfig: db, job });
clearInterval(sampler);

console.log("\n=== Compression à mémoire bornée ===");
console.log(`  dump brut       : ${mb(rawSize)} Mo`);
console.log(`  dump compressé  : ${mb(r.size)} Mo`);
console.log(`  pic RSS         : ${mb(peak)} Mo`);
console.log(`  seuil           : ${mb(rawSize)} Mo (la mémoire ne doit pas suivre la taille du dump)`);

assert.ok(rawSize > 50 * 1024 * 1024, `jeu de test trop petit (${mb(rawSize)} Mo) pour être significatif`);
assert.ok(peak < rawSize, `pic RSS ${mb(peak)} Mo >= taille du dump ${mb(rawSize)} Mo : la compression n'est pas en flux`);
console.log("  ok   la mémoire ne suit pas la taille du dump");

execFileSync("gzip", ["-t", r.filePath]);
console.log("  ok   archive gzip valide (gzip -t)");
assert.strictEqual(fs.statSync(r.filePath).mode & 0o777, 0o600);
console.log("  ok   permissions 0600");
assert.ok(!fs.existsSync(r.filePath.replace(/\.gz$/, "")), "le dump brut n'a pas été nettoyé");
console.log("  ok   dump brut intermédiaire nettoyé");

fs.rmSync(BDIR, { recursive: true, force: true });
console.log("\nTOUS LES TESTS PASSENT\n");
