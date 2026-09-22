// Vérifie que les exemples de configuration présents dans la documentation
// sont réellement valides. Sans cela, la doc dérive silencieusement du code.
import fs from "fs";
import os from "os";
import path from "path";
import assert from "assert";
import { execFileSync } from "child_process";

const CLI = path.resolve("dist/index.js");
let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; } };

// Extrait les blocs ```yaml d'un markdown, en ignorant ceux qui ne sont pas des
// configurations Shuttle (docker-compose, Kubernetes, fragments partiels).
function shuttleConfigBlocks(file) {
  const md = fs.readFileSync(file, "utf8");
  const blocks = [...md.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]);
  return blocks
    .map((body, i) => ({ body, index: i + 1 }))
    .filter(({ body }) => /^version:\s*1\s*$/m.test(body) && /^shuttle:/m.test(body));
}

const W = fs.mkdtempSync(path.join(os.tmpdir(), "shuttle-docs-"));
fs.writeFileSync(path.join(W, "ssh_key"), "fake");
fs.writeFileSync(path.join(W, "known_hosts"), "[backup.example.com]:22 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample");
fs.mkdirSync(path.join(W, "config"), { recursive: true });
fs.copyFileSync(path.join(W, "ssh_key"), path.join(W, "config", "ssh_key"));
fs.copyFileSync(path.join(W, "known_hosts"), path.join(W, "config", "known_hosts"));

// Valeurs pour les ${VAR} référencés par les exemples.
const env = {
  ...process.env,
  DATABASE_URL: "postgresql://u:p@db.internal:5432/appdb",
  POSTGRES_PASSWORD: "pw",
  BACKUP_HOST: "backup.example.com",
  BACKUP_USER: "backup",
  BACKUP_KEY_PATH: "./ssh_key",
  BACKUP_PORT: "22",
  SENDGRID_API_KEY: "SG.example",
};

for (const file of ["documentation-agent.md", "README.md"]) {
  const blocks = shuttleConfigBlocks(file);
  console.log(`\n=== ${file} : ${blocks.length} configuration(s) ===`);
  assert.ok(blocks.length > 0, `aucun exemple de configuration trouvé dans ${file}`);

  for (const { body, index } of blocks) {
    check(`${file} — exemple #${index} est valide`, () => {
      // Les chemins /config/... des exemples Docker sont réécrits vers le
      // répertoire temporaire ; le reste du contenu est inchangé.
      const cfg = body.replace(/\/config\//g, `${W}/config/`);
      const p = path.join(W, `doc-${file.replace(/\W/g, "_")}-${index}.yml`);
      fs.writeFileSync(p, cfg);
      try {
        execFileSync("node", [CLI, "validate", "-c", p], {
          cwd: W, env, encoding: "utf8", stdio: "pipe",
        });
      } catch (e) {
        const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
        throw new Error(out.split("\n").filter((l) => /ERROR/.test(l)).slice(0, 4).join("\n       ") || out.slice(0, 300));
      }
    });
  }
}

fs.rmSync(W, { recursive: true, force: true });
console.log(`\n${fail === 0 ? "TOUS LES TESTS PASSENT" : "ÉCHECS"} : ${pass} ok, ${fail} ko\n`);
process.exit(fail === 0 ? 0 : 1);
