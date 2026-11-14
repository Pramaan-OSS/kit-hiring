import { readFileSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";
/** The one server-only platform client. No vendor address or credential reaches the browser. */
export async function moduleCall(
  method: string,
  route: string,
  body?: Buffer,
  key?: string,
): Promise<{ status: number; body: Buffer; unreached?: boolean }> {
  const dir = process.env.PRAMAAN_MODULES_DIR ?? "/pramaan-modules";
  let token: string;
  try {
    token = readFileSync(path.join(dir, "token"), "utf8").trim();
  } catch {
    return { status: 0, body: Buffer.alloc(0), unreached: true };
  }
  return new Promise((resolve) => {
    const headers: Record<string, string | number> = { authorization: `Bearer ${token}` };
    if (body) {
      headers["content-type"] =
        route === "/v1/email" ? "application/json" : "application/octet-stream";
      headers["content-length"] = body.length;
    }
    if (key) headers["idempotency-key"] = key;
    const sent = request(
      { socketPath: path.join(dir, "modules.sock"), method, path: route, headers, timeout: 30000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (b: Buffer) => chunks.push(b));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on("error", () => resolve({ status: 0, body: Buffer.alloc(0) }));
      },
    );
    sent.on("timeout", () => sent.destroy(new Error("timeout")));
    sent.on("error", (e: { code?: string }) =>
      resolve({
        status: 0,
        body: Buffer.alloc(0),
        unreached: e.code === "ENOENT" || e.code === "ECONNREFUSED",
      }),
    );
    sent.end(body);
  });
}
