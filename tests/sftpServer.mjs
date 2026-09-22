// Serveur SFTP réel, en mémoire de process, adossé à un répertoire temporaire.
// Sert à valider le chemin de transfert de bout en bout (clé d'hôte, upload
// atomique, vérification de taille, rétention).
import ssh2 from "ssh2";
import fs from "fs";
import path from "path";

const { Server, utils } = ssh2;
const { STATUS_CODE, OPEN_MODE } = utils.sftp;

export async function startSftpServer({ rootDir, hostKey, truncateAfter = null }) {
  fs.mkdirSync(rootDir, { recursive: true });

  const resolveIn = (p) => {
    const clean = path.posix.normalize(p.startsWith("/") ? p : `/${p}`);
    return path.join(rootDir, clean);
  };

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on("authentication", (ctx) => ctx.accept());
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("sftp", (acceptSftp) => {
          const sftp = acceptSftp();
          const handles = new Map();
          let nextHandle = 0;

          const newHandle = (payload) => {
            const id = nextHandle++;
            const buf = Buffer.alloc(4);
            buf.writeUInt32BE(id, 0);
            handles.set(id, payload);
            return buf;
          };
          const getHandle = (h) => handles.get(h.readUInt32BE(0));

          sftp.on("OPEN", (reqid, filename, flags) => {
            const full = resolveIn(filename);
            try {
              if (flags & OPEN_MODE.WRITE) {
                const fd = fs.openSync(full, "w");
                return sftp.handle(reqid, newHandle({ fd, full, written: 0, write: true }));
              }
              const fd = fs.openSync(full, "r");
              return sftp.handle(reqid, newHandle({ fd, full, pos: 0 }));
            } catch {
              return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }
          });

          sftp.on("WRITE", (reqid, handle, offset, data) => {
            const h = getHandle(handle);
            if (!h) return sftp.status(reqid, STATUS_CODE.FAILURE);
            // Simulation d'un transfert tronqué : on ignore les écritures
            // au-delà d'un seuil, sans le signaler au client.
            if (truncateAfter !== null && offset >= truncateAfter) {
              return sftp.status(reqid, STATUS_CODE.OK);
            }
            fs.writeSync(h.fd, data, 0, data.length, offset);
            return sftp.status(reqid, STATUS_CODE.OK);
          });

          sftp.on("READ", (reqid, handle, offset, length) => {
            const h = getHandle(handle);
            if (!h) return sftp.status(reqid, STATUS_CODE.FAILURE);
            const buf = Buffer.alloc(length);
            const read = fs.readSync(h.fd, buf, 0, length, offset);
            if (read === 0) return sftp.status(reqid, STATUS_CODE.EOF);
            return sftp.data(reqid, buf.slice(0, read));
          });

          sftp.on("CLOSE", (reqid, handle) => {
            const h = getHandle(handle);
            if (h?.fd !== undefined) { try { fs.closeSync(h.fd); } catch { /* ignore */ } }
            handles.delete(handle.readUInt32BE(0));
            return sftp.status(reqid, STATUS_CODE.OK);
          });

          const statFor = (reqid, p) => {
            try {
              const st = fs.statSync(resolveIn(p));
              return sftp.attrs(reqid, {
                mode: st.mode, uid: st.uid, gid: st.gid, size: st.size,
                atime: st.atimeMs / 1000, mtime: st.mtimeMs / 1000,
              });
            } catch {
              return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }
          };
          sftp.on("STAT", statFor);
          sftp.on("LSTAT", statFor);

          sftp.on("REALPATH", (reqid, p) => {
            const clean = path.posix.normalize(p.startsWith("/") ? p : `/${p}`);
            return sftp.name(reqid, [{ filename: clean, longname: clean, attrs: {} }]);
          });

          sftp.on("OPENDIR", (reqid, p) => {
            const full = resolveIn(p);
            if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
              return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }
            return sftp.handle(reqid, newHandle({ dir: full, sent: false }));
          });

          sftp.on("READDIR", (reqid, handle) => {
            const h = getHandle(handle);
            if (!h || h.sent) return sftp.status(reqid, STATUS_CODE.EOF);
            h.sent = true;
            const names = fs.readdirSync(h.dir).map((name) => {
              const st = fs.statSync(path.join(h.dir, name));
              const isDir = st.isDirectory();
              return {
                filename: name,
                longname: `${isDir ? "d" : "-"}rw-r--r-- 1 u g ${st.size} x ${name}`,
                attrs: { mode: st.mode, size: st.size, uid: 0, gid: 0,
                         atime: st.atimeMs / 1000, mtime: st.mtimeMs / 1000 },
              };
            });
            return sftp.name(reqid, names);
          });

          sftp.on("MKDIR", (reqid, p) => {
            try { fs.mkdirSync(resolveIn(p), { recursive: true }); return sftp.status(reqid, STATUS_CODE.OK); }
            catch { return sftp.status(reqid, STATUS_CODE.FAILURE); }
          });

          sftp.on("REMOVE", (reqid, p) => {
            try { fs.unlinkSync(resolveIn(p)); return sftp.status(reqid, STATUS_CODE.OK); }
            catch { return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE); }
          });

          sftp.on("RENAME", (reqid, from, to) => {
            try { fs.renameSync(resolveIn(from), resolveIn(to)); return sftp.status(reqid, STATUS_CODE.OK); }
            catch { return sftp.status(reqid, STATUS_CODE.FAILURE); }
          });

          sftp.on("SETSTAT", (reqid) => sftp.status(reqid, STATUS_CODE.OK));
          sftp.on("FSETSTAT", (reqid) => sftp.status(reqid, STATUS_CODE.OK));
          sftp.on("RMDIR", (reqid, p) => {
            try { fs.rmdirSync(resolveIn(p)); return sftp.status(reqid, STATUS_CODE.OK); }
            catch { return sftp.status(reqid, STATUS_CODE.FAILURE); }
          });
        });
      });
    });
    client.on("error", () => { /* déconnexions attendues pendant les tests */ });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}
