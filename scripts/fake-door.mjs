import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
export async function startFakeDoor(dir) {
  mkdirSync(dir, { recursive: true });
  const token = randomBytes(16).toString("hex");
  writeFileSync(path.join(dir, "token"), token);
  const socket = path.join(dir, "modules.sock");
  rmSync(socket, { force: true });
  const files = new Map(),
    mail = [];
  const door = { files, mail, filesOn: true, emailOn: true };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401);
      res.end();
      return;
    }
    if (req.url === "/v1/email") {
      if (!door.emailOn) {
        res.writeHead(404);
        res.end('{"error":"MODULE_OFF"}');
        return;
      }
      if (!mail.some((m) => m.key === req.headers["idempotency-key"]))
        mail.push({ ...JSON.parse(body), key: req.headers["idempotency-key"] });
      res.writeHead(202);
      res.end("{}");
      return;
    }
    if (req.url.startsWith("/v1/files/")) {
      if (!door.filesOn) {
        res.writeHead(404);
        res.end('{"error":"MODULE_OFF"}');
        return;
      }
      const key = decodeURIComponent(req.url.slice(10));
      if (req.method === "PUT") {
        files.set(key, body);
        res.writeHead(201);
        res.end("{}");
        return;
      }
      if (req.method === "DELETE") {
        files.delete(key);
        res.end("{}");
        return;
      }
      if (files.has(key)) {
        res.end(files.get(key));
        return;
      }
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise((r) => server.listen(socket, r));
  return {
    ...door,
    get filesOn() {
      return door.filesOn;
    },
    set filesOn(v) {
      door.filesOn = v;
    },
    get emailOn() {
      return door.emailOn;
    },
    set emailOn(v) {
      door.emailOn = v;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
