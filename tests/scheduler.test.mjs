// Teste les gardes du scheduler avec le vrai executeJob (pas de mock :
// les namespaces ESM sont figés, et cela teste le chemin réel).
import fs from "fs";
import path from "path";
import assert from "assert";
import net from "net";
import { Scheduler, scheduleJobs } from "../dist/core/scheduler.js";

const T = process.env.TDIR;
process.env.SHUTTLE_LOCAL_BACKUP_DIR = path.join(T, "sched-local");
fs.rmSync(path.join(T, "sched-local"), { recursive: true, force: true });

let pass = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; } };

// Job rapide : la base est injoignable, executeJob échoue en ~50 ms.
const fastCfg = {
  config: { shuttle: { name: "s", timezone: "UTC", jobs: [] } },
  sourceDbConfig: { host: "127.0.0.1", port: 1, database: "d", user: "u", password: "p" },
  targetSshConfig: { host: "127.0.0.1", port: 1, user: "u", keyPath: "/nope", basePath: "/b", strictHostKey: false },
};
// Job lent, sans dépendance externe : un "tarpit" TCP accepte la connexion de
// pg_dump puis ne répond jamais. pg_dump reste bloqué, donc le job aussi.
const tarpit = net.createServer(() => { /* accepte et ne répond jamais */ });
await new Promise((r) => tarpit.listen(0, "127.0.0.1", r));
const slowCfg = {
  ...fastCfg,
  sourceDbConfig: { host: "127.0.0.1", port: tarpit.address().port,
                    database: "d", user: "u", password: "p" },
};
const mkJob = (name) => ({ name, type: "full", cron: "* * * * *", format: "plain", compress: true, keepLast: 2 });

console.log("\n=== Garde anti-chevauchement ===");

await check("un job déjà en cours n'est pas relancé en parallèle", async () => {
  const s = new Scheduler();
  const done = [];
  const job = mkJob("slow");
  s.trigger(job, fastCfg, (r) => done.push(r));
  s.trigger(job, fastCfg, (r) => done.push(r));  // ignoré
  s.trigger(job, fastCfg, (r) => done.push(r));  // ignoré
  assert.strictEqual(s.runningCount, 1, `attendu 1 exécution, obtenu ${s.runningCount}`);
  await s.shutdown(10000);
  assert.strictEqual(done.length, 1, `attendu 1 completion, obtenu ${done.length}`);
});

await check("deux jobs DIFFÉRENTS tournent bien en parallèle", async () => {
  const s = new Scheduler();
  s.trigger(mkJob("a"), fastCfg);
  s.trigger(mkJob("b"), fastCfg);
  assert.strictEqual(s.runningCount, 2, `attendu 2, obtenu ${s.runningCount}`);
  await s.shutdown(10000);
});

console.log("\n=== Planification réelle (node-cron) ===");

await check("un cron planifié déclenche réellement le job", async () => {
  const cfg = { ...fastCfg, config: { shuttle: { name: "s", timezone: "UTC",
    // Toutes les secondes : node-cron accepte un champ « secondes ».
    jobs: [{ ...mkJob("tick"), cron: "* * * * * *" }] } } };
  const fired = [];
  const sched = scheduleJobs(cfg, (r) => fired.push(r));
  assert.strictEqual(sched.size, 1, "le job n'a pas été planifié");
  await new Promise((r) => setTimeout(r, 2500));
  assert.ok(fired.length >= 1, `le cron n'a jamais déclenché (${fired.length} exécutions)`);
  await sched.shutdown(10000);

  // Après l'arrêt, plus aucune exécution ne doit survenir.
  const after = fired.length;
  await new Promise((r) => setTimeout(r, 2000));
  assert.strictEqual(fired.length, after, "le cron a continué après shutdown");
});

await check("une expression cron invalide est rejetée sans planifier", async () => {
  const cfg = { ...fastCfg, config: { shuttle: { name: "s", timezone: "UTC",
    jobs: [{ ...mkJob("bad"), cron: "pas-un-cron" }] } } };
  const sched = scheduleJobs(cfg);
  assert.strictEqual(sched.size, 0, "une expression invalide a été planifiée");
  await sched.shutdown(1000);
});

await check("le fuseau horaire configuré est accepté", async () => {
  const cfg = { ...fastCfg, config: { shuttle: { name: "s", timezone: "Europe/Paris",
    jobs: [{ ...mkJob("tz"), cron: "0 3 * * *" }] } } };
  const sched = scheduleJobs(cfg);
  assert.strictEqual(sched.size, 1);
  await sched.shutdown(1000);
});

console.log("\n=== Arrêt gracieux ===");

await check("shutdown attend la fin de la sauvegarde en cours", async () => {
  const s = new Scheduler();
  let finished = false;
  s.trigger(mkJob("inflight"), fastCfg, () => { finished = true; });
  const clean = await s.shutdown(10000);
  assert.strictEqual(clean, true, "shutdown a signalé un abandon");
  assert.strictEqual(finished, true, "shutdown n'a pas attendu la fin du job");
  assert.strictEqual(s.runningCount, 0);
});

await check("shutdown signale l'abandon si le délai est dépassé", async () => {
  const s = new Scheduler();
  // timeout court pour que le pg_dump bloqué soit tué juste après le test
  s.trigger({ ...mkJob("verylong"), timeout: 3000 }, slowCfg);
  const clean = await s.shutdown(150);
  assert.strictEqual(clean, false, "shutdown aurait dû signaler le dépassement");
});

await check("aucun nouveau job n'est lancé pendant l'arrêt", async () => {
  const s = new Scheduler();
  const p = s.shutdown(5000);
  s.trigger(mkJob("late"), fastCfg);
  assert.strictEqual(s.runningCount, 0, "un job a démarré pendant l'arrêt");
  await p;
});

tarpit.close();
console.log(`\n${fail === 0 ? "TOUS LES TESTS PASSENT" : "ÉCHECS"} : ${pass} ok, ${fail} ko\n`);
process.exit(fail === 0 ? 0 : 1);
