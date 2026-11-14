import { moduleCall } from "./modules";
export const STORAGE_OFF =
  "CV storage isn't switched on for this app yet. You can't upload or download a CV until it is enabled.";
export type Stored = { ok: true; body: Buffer } | { ok: false; off: boolean; message: string };
export async function storage(
  method: "PUT" | "GET" | "DELETE",
  key: string,
  body?: Buffer,
): Promise<Stored> {
  const r = await moduleCall(method, `/v1/files/${encodeURIComponent(key)}`, body);
  if (r.status >= 200 && r.status < 300) return { ok: true, body: r.body };
  let code = "";
  try {
    code = JSON.parse(r.body.toString()).error;
  } catch {
    /* No module answer. */
  }
  const off = r.unreached || code === "MODULE_OFF";
  return {
    ok: false,
    off: Boolean(off),
    message: off ? STORAGE_OFF : "CV storage could not complete that request. Please try again.",
  };
}
