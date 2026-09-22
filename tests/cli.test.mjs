// Tests de la CLI via de vraies invocations du binaire construit.
import fs from "fs";
import os from "os";
import path from "path";
import assert from "assert";
import { execFileSync } from "child_process";

const CLI = path.resolve("dist/index.js");
const W = fs.mkdtempSync(path.join(os.tmpdir(), "shuttle-cli-"));

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; } };

// Retourne { code, out } ; la CLI écrit ses logs sur stdout via pino.
const cli = (args, opts = {}) => {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd: W, encoding: "utf8", stdio: "pipe", ...opts });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

const writeConfig = (name, body) => { const p = path.join(W, name); fs.writeFileSync(p, body); return p; };
const validConfig = (extra = "") => `version: 1
shuttle:
  name: cli-test
  timezone: UTC
  source:
    url: postgresql://u:p@db.internal:5432/appdb
  target:
    host: backup.example.com
    user: backup
    key_path: ./ssh_key
    base_path: /backups/app
${extra}  jobs:
    - name: nightly
      type: full
      cron: "0 3 * * *"
      keepLast: 7
`;

fs.writeFileSync(path.join(W, "ssh_key"), "fake");

console.log("\n=== Base ===");

check("--version reflète package.json", () => {
  const expected = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  assert.strictEqual(cli(["--version"]).out.trim(), expected);
});

check("sans argument : affiche l'aide", () => {
  const r = cli([]);
  assert.match(r.out, /Usage: shuttle/);
});

check("init crée shuttle.yml", () => {
  const r = cli(["init"]);
  assert.strictEqual(r.code, 0);
  assert.ok(fs.existsSync(path.join(W, "shuttle.yml")));
});

check("init n'écrase pas un fichier existant", () => {
  fs.writeFileSync(path.join(W, "shuttle.yml"), "# à conserver\n");
  cli(["init"]);
  assert.strictEqual(fs.readFileSync(path.join(W, "shuttle.yml"), "utf8"), "# à conserver\n");
});

console.log("\n=== Résolution de -c/--config (régression) ===");

writeConfig("shuttle.yml", validConfig().replace("name: cli-test", "name: DEFAUT"));
writeConfig("autre.yml", validConfig().replace("name: cli-test", "name: EXPLICITE"));

check("-c APRÈS la sous-commande est pris en compte", () => {
  const r = cli(["validate", "-c", "autre.yml"]);
  assert.match(r.out, /EXPLICITE/, "le fichier passé en -c a été ignoré");
});

check("-c AVANT la sous-commande est pris en compte", () => {
  const r = cli(["-c", "autre.yml", "validate"]);
  assert.match(r.out, /EXPLICITE/, "le fichier passé en -c a été ignoré");
});

check("--config=<path> fonctionne aussi", () => {
  assert.match(cli(["validate", "--config=autre.yml"]).out, /EXPLICITE/);
});

check("sans -c : shuttle.yml par défaut", () => {
  assert.match(cli(["validate"]).out, /DEFAUT/);
});

check("-c est respecté par ls et run", () => {
  assert.match(cli(["ls", "-c", "autre.yml"]).out, /EXPLICITE/);
  // run échoue (base injoignable) mais doit avoir chargé le bon fichier
  assert.match(cli(["run", "-c", "autre.yml"]).out, /EXPLICITE|Loading configuration from: autre\.yml/);
});

console.log("\n=== Validation de configuration ===");

check("config valide -> code 0", () => {
  const r = cli(["validate", "-c", "autre.yml"]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /Configuration is valid/);
});

check("fichier absent -> code 1 et message clair", () => {
  const r = cli(["validate", "-c", "introuvable.yml"]);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /Configuration file not found/);
});

check("clé SSH absente -> code 1", () => {
  writeConfig("nokey.yml", validConfig().replace("key_path: ./ssh_key", "key_path: ./absente"));
  const r = cli(["validate", "-c", "nokey.yml"]);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /SSH key not found/);
});

check("YAML invalide -> code 1", () => {
  writeConfig("bad.yml", "version: 1\n  shuttle: [oups\n");
  assert.strictEqual(cli(["validate", "-c", "bad.yml"]).code, 1);
});

check("champ requis manquant -> erreur zod lisible", () => {
  writeConfig("incomplet.yml", "version: 1\nshuttle:\n  name: x\n");
  const r = cli(["validate", "-c", "incomplet.yml"]);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /Invalid configuration/);
});

check("URL PostgreSQL invalide -> code 1", () => {
  writeConfig("badurl.yml", validConfig().replace("postgresql://u:p@db.internal:5432/appdb", "mysql://u:p@h/db"));
  assert.strictEqual(cli(["validate", "-c", "badurl.yml"]).code, 1);
});

console.log("\n=== Sécurité de la clé d'hôte ===");

check("sans vérification -> avertissement visible", () => {
  assert.match(cli(["validate", "-c", "autre.yml"]).out, /Host key: NOT VERIFIED/);
});

check("strict_host_key sans pinning -> code 1", () => {
  writeConfig("strict.yml", validConfig("    strict_host_key: true\n"));
  const r = cli(["validate", "-c", "strict.yml"]);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /strict_host_key is enabled/);
});

check("empreinte configurée -> vérification signalée active", () => {
  writeConfig("fp.yml", validConfig('    host_fingerprint: "SHA256:abc"\n    strict_host_key: true\n'));
  const r = cli(["validate", "-c", "fp.yml"]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /Host key: verified via fingerprint/);
});

check("known_hosts absent -> code 1", () => {
  writeConfig("kh.yml", validConfig("    known_hosts: ./known_hosts_absent\n"));
  const r = cli(["validate", "-c", "kh.yml"]);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /known_hosts file not found/);
});

console.log("\n=== Notifications ===");

check("email désactivé par défaut", () => {
  assert.match(cli(["validate", "-c", "autre.yml"]).out, /Email: disabled/);
});

check("config email valide -> affichée sans la clé d'API", () => {
  writeConfig("mail.yml", validConfig(`  notifications:
    email:
      api_key: SG.secret-value
      from: a@b.com
      to:
        - ops@b.com
      on: failure
`));
  const r = cli(["validate", "-c", "mail.yml"]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /Email: sendgrid/);
  assert.match(r.out, /Trigger: failure/);
  assert.ok(!r.out.includes("SG.secret-value"), "la clé d'API est affichée !");
});

check("provider resend accepté et affiché", () => {
  writeConfig("resend.yml", validConfig(`  notifications:
    email:
      provider: resend
      api_key: re_secret-value
      from: a@b.com
      to:
        - ops@b.com
`));
  const r = cli(["validate", "-c", "resend.yml"]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /Email: resend/);
  assert.ok(!r.out.includes("re_secret-value"), "la clé d'API est affichée !");
});

check("provider inconnu -> code 1", () => {
  writeConfig("badprovider.yml", validConfig(`  notifications:
    email:
      provider: mailgun
      api_key: k
      from: a@b.com
      to:
        - ops@b.com
`));
  assert.strictEqual(cli(["validate", "-c", "badprovider.yml"]).code, 1);
});

check("email invalide -> code 1", () => {
  writeConfig("badmail.yml", validConfig(`  notifications:
    email:
      api_key: k
      from: pas-une-adresse
      to:
        - ops@b.com
`));
  assert.strictEqual(cli(["validate", "-c", "badmail.yml"]).code, 1);
});

console.log("\n=== Variables d'environnement ===");

check("${VAR} est substitué", () => {
  writeConfig("env.yml", validConfig().replace("name: cli-test", "name: ${SHUTTLE_NAME}"));
  const r = cli(["validate", "-c", "env.yml"], { env: { ...process.env, SHUTTLE_NAME: "DEPUIS_ENV" } });
  assert.match(r.out, /DEPUIS_ENV/);
});

check("${VAR:-defaut} utilise la valeur par défaut", () => {
  writeConfig("envd.yml", validConfig().replace("name: cli-test", "name: ${ABSENTE:-VALEUR_DEFAUT}"));
  assert.match(cli(["validate", "-c", "envd.yml"]).out, /VALEUR_DEFAUT/);
});

console.log("\n=== ls ===");

check("ls liste les jobs configurés", () => {
  const r = cli(["ls", "-c", "autre.yml"]);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /nightly/);
  assert.match(r.out, /0 3 \* \* \*/);
});

fs.rmSync(W, { recursive: true, force: true });
console.log(`\n${fail === 0 ? "TOUS LES TESTS PASSENT" : "ÉCHECS"} : ${pass} ok, ${fail} ko\n`);
process.exit(fail === 0 ? 0 : 1);
