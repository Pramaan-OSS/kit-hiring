import { moduleCall } from "./modules";
export type Outgoing = { to: string; subject: string; text: string; bulk?: boolean };
export type Sent = { status: "sent" | "not-sent" | "unknown" };
export type Mailer = { send: (message: Outgoing, key: string) => Promise<Sent> };
export const emailDoor: Mailer = {
  async send(message, key) {
    const r = await moduleCall("POST", "/v1/email", Buffer.from(JSON.stringify(message)), key);
    let code = "";
    try {
      const value = JSON.parse(r.body.toString());
      code = typeof value.error === "string" ? value.error : (value.error?.code ?? "");
    } catch {
      /* Missing response. */
    }
    return {
      status:
        r.status === 200 || r.status === 202
          ? "sent"
          : r.unreached ||
              (r.status >= 400 && ![502, 504].includes(r.status) && code !== "IDEMPOTENCY_PENDING")
            ? "not-sent"
            : "unknown",
    };
  },
};
