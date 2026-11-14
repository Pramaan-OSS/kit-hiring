import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { AccountError, type User } from "./accounts";
import { emailDoor } from "./email";
import { accountRuntime, database } from "./runtime";
import { storage } from "./storage";

export function fail(status: number, message: string): never {
  throw new AccountError(status, message);
}
export const text = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim().length > 0 && v.trim().length <= max
    ? v.trim()
    : fail(400, "Check the required fields and their length.");
export const uuid = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v
    : fail(404, "That record was not found.");
export async function owner(request: Request) {
  return accountRuntime().requireRole(request, ["owner"]);
}
export async function staff(request: Request) {
  return accountRuntime().requireRole(request, ["owner", "team"]);
}
export async function transaction<T>(work: (c: PoolClient) => Promise<T>) {
  const c = await database().connect();
  try {
    await c.query("BEGIN");
    const value = await work(c);
    await c.query("COMMIT");
    return value;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function jobAccess(user: User, id: string, c: Pick<PoolClient, "query"> = database()) {
  const r = await c.query(
    "SELECT j.* FROM hiring_jobs j WHERE j.id=$1 AND ($2='owner' OR ($2='team' AND EXISTS(SELECT 1 FROM hiring_team t WHERE t.job_id=j.id AND t.user_id=$3)))",
    [uuid(id), user.role, user.id],
  );
  return r.rows[0] ?? fail(404, "That job was not found.");
}
export async function applicationAccess(
  user: User,
  id: string,
  c: Pick<PoolClient, "query"> = database(),
  lock = false,
) {
  const r = await c.query(
    `SELECT a.*,u.email,j.title,s.name AS stage FROM hiring_applications a JOIN app_users u ON u.id=a.candidate_id JOIN hiring_jobs j ON j.id=a.job_id JOIN hiring_stages s ON s.id=a.stage_id WHERE a.id=$1 AND ($2='owner' OR ($2='team' AND EXISTS(SELECT 1 FROM hiring_team t WHERE t.job_id=a.job_id AND t.user_id=$3)) OR ($2='member' AND a.candidate_id=$3)) ${lock ? "FOR UPDATE OF a" : ""}`,
    [uuid(id), user.role, user.id],
  );
  return r.rows[0] ?? fail(404, "That application was not found.");
}
export async function notify(id: string) {
  const r = await database().query(
    "UPDATE hiring_notifications SET status='sending' WHERE id=$1 AND status='pending' RETURNING *",
    [id],
  );
  const n = r.rows[0];
  if (!n) return;
  const a = await database().query(
    "SELECT u.email,u.email_verified_at FROM hiring_applications a JOIN app_users u ON u.id=a.candidate_id WHERE a.id=$1",
    [n.application_id],
  );
  // Sign-up doesn't prove the address: mail only one the candidate confirmed, never a stranger's inbox.
  if (!a.rows[0]?.email_verified_at) {
    await database().query("UPDATE hiring_notifications SET status='not-sent' WHERE id=$1", [id]);
    return "unconfirmed";
  }
  const sent = await emailDoor.send(
    {
      to: a.rows[0].email,
      subject: n.subject,
      text: n.body,
      bulk: n.subject === "Application received",
    },
    id,
  );
  await database().query("UPDATE hiring_notifications SET status=$2 WHERE id=$1", [
    id,
    sent.status,
  ]);
  return sent.status;
}
export async function addNotice(c: PoolClient, application: string, subject: string, body: string) {
  const r = await c.query(
    "INSERT INTO hiring_notifications(application_id,subject,body) VALUES($1,$2,$3) RETURNING id",
    [application, subject, body],
  );
  return r.rows[0].id as string;
}
export const CV_LIMIT = 5 * 1024 * 1024;
export function validateCV(bytes: Buffer, name: string, type: string) {
  if (!bytes.length || bytes.length > CV_LIMIT) fail(413, "Choose a non-empty CV up to 5 MB.");
  if (
    type !== "application/pdf" ||
    !name.toLowerCase().endsWith(".pdf") ||
    bytes.subarray(0, 5).toString() !== "%PDF-"
  )
    fail(400, "Choose a PDF CV.");
}
export async function apply(
  user: User,
  jobId: string,
  name: string,
  bytes: Buffer,
  filename: string,
  type: string,
) {
  if (user.role !== "member") fail(403, "Only candidates can apply.");
  validateCV(bytes, filename, type);
  text(name);
  uuid(jobId);
  const key = `cv-${randomUUID()}`;
  const put = await storage("PUT", key, bytes);
  if (!put.ok) {
    if (!put.off) await storage("DELETE", key);
    fail(503, put.message);
  }
  let result: { id: string; notice: string };
  try {
    result = await transaction(async (c) => {
      const candidate = await c.query("SELECT role FROM app_users WHERE id=$1 FOR UPDATE", [
        user.id,
      ]);
      if (candidate.rows[0]?.role !== "member") fail(403, "Only candidates can apply.");
      const j = await c.query("SELECT * FROM hiring_jobs WHERE id=$1 FOR SHARE", [jobId]);
      if (!j.rows[0]?.open) fail(404, "This job is not accepting applications.");
      await c.query(
        "INSERT INTO hiring_candidates(user_id,name) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET name=EXCLUDED.name",
        [user.id, name],
      );
      const stage = await c.query(
        "SELECT id FROM hiring_stages ORDER BY position,id LIMIT 1 FOR SHARE",
      );
      if (!stage.rows[0]) fail(409, "The owner must add a pipeline stage first.");
      const a = await c.query(
        "INSERT INTO hiring_applications(job_id,candidate_id,stage_id,cv_key,cv_name) VALUES($1,$2,$3,$4,$5) ON CONFLICT(job_id,candidate_id) DO NOTHING RETURNING id",
        [
          jobId,
          user.id,
          stage.rows[0].id,
          key,
          filename.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120),
        ],
      );
      if (!a.rows[0]) fail(409, "You have already applied to this job.");
      return {
        id: a.rows[0].id,
        notice: await addNotice(
          c,
          a.rows[0].id,
          "Application received",
          `We received your application for ${j.rows[0].title}.`,
        ),
      };
    });
  } catch (e) {
    await storage("DELETE", key);
    throw e;
  }
  const email = await notify(result.notice);
  return { id: result.id, email };
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
export function parseCSV(input: string): string[][] {
  if (input.length > 100000) fail(413, "Import at most 100 KB at a time.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell !== "") fail(400, "Check the CSV quotes.");
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (quoted) fail(400, "Check the CSV quotes.");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  if (rows.length > 201) fail(400, "Import at most 200 jobs.");
  return rows;
}
