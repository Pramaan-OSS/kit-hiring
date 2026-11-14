import { existsSync } from "node:fs";
import path from "node:path";
import { AccountError } from "../../../../lib/accounts";
import {
  addNotice,
  applicationAccess,
  apply,
  CV_LIMIT,
  csvCell,
  fail,
  jobAccess,
  notify,
  owner,
  parseCSV,
  staff,
  text,
  transaction,
  uuid,
} from "../../../../lib/hiring";
import { handle, readBody, reply } from "../../../../lib/roles/http";
import { accountRuntime, database } from "../../../../lib/runtime";
import { storage } from "../../../../lib/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function route(request: Request, context: Context) {
  return handle(async () => {
    const [kind, id, action] = (await context.params).path;
    const db = database();
    const method = request.method;
    if (kind === "board" && method === "GET")
      return reply(
        (
          await db.query(
            "SELECT id,title,description,location FROM hiring_jobs WHERE open ORDER BY created_at DESC",
          )
        ).rows,
      );
    const user = await accountRuntime().requireUser(request);
    if (method === "GET") {
      if (kind === "jobs") {
        await staff(request);
        return reply(
          (
            await db.query(
              "SELECT j.* FROM hiring_jobs j WHERE $1='owner' OR EXISTS(SELECT 1 FROM hiring_team t WHERE t.job_id=j.id AND t.user_id=$2) ORDER BY j.created_at DESC",
              [user.role, user.id],
            )
          ).rows,
        );
      }
      if (kind === "stages") {
        await staff(request);
        return reply((await db.query("SELECT * FROM hiring_stages ORDER BY position,id")).rows);
      }
      if (kind === "team") {
        await owner(request);
        return reply(
          (await db.query("SELECT id,email FROM app_users WHERE role='team' ORDER BY email")).rows,
        );
      }
      if (kind === "applications" && id) {
        const a = await applicationAccess(user, id);
        if (action === "cv") {
          const s = await storage("GET", a.cv_key);
          if (!s.ok) fail(503, s.message);
          return new Response(new Uint8Array(s.body), {
            headers: {
              "content-type": "application/pdf",
              "content-disposition": `attachment; filename="${a.cv_name}"`,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
              "content-security-policy": "sandbox",
            },
          });
        }
        const notes =
          user.role === "member"
            ? []
            : (
                await db.query(
                  "SELECT n.id,n.body,u.email FROM hiring_notes n JOIN app_users u ON u.id=n.author_id WHERE application_id=$1 ORDER BY n.created_at",
                  [id],
                )
              ).rows;
        const ratings =
          user.role === "member"
            ? []
            : (
                await db.query(
                  "SELECT r.rating,u.email FROM hiring_ratings r JOIN app_users u ON u.id=r.user_id WHERE application_id=$1",
                  [id],
                )
              ).rows;
        return reply({ id: a.id, title: a.title, stage: a.stage, notes, ratings });
      }
      if (kind === "applications") {
        if (user.role === "member")
          return reply(
            (
              await db.query(
                "SELECT a.id,j.title,s.name AS stage FROM hiring_applications a JOIN hiring_jobs j ON j.id=a.job_id JOIN hiring_stages s ON s.id=a.stage_id WHERE a.candidate_id=$1 ORDER BY a.created_at DESC",
                [user.id],
              )
            ).rows,
          );
        await staff(request);
        const job = new URL(request.url).searchParams.get("job") ?? "";
        await jobAccess(user, job);
        const rows = (
          await db.query(
            "SELECT a.id,c.name,u.email,s.name AS stage,a.stage_id FROM hiring_applications a JOIN hiring_candidates c ON c.user_id=a.candidate_id JOIN app_users u ON u.id=c.user_id JOIN hiring_stages s ON s.id=a.stage_id WHERE a.job_id=$1 ORDER BY a.created_at",
            [job],
          )
        ).rows;
        if (new URL(request.url).searchParams.has("csv"))
          return new Response(
            [
              "Name,Email,Stage",
              ...rows.map((r) => [r.name, r.email, r.stage].map(csvCell).join(",")),
            ].join("\r\n"),
            {
              headers: {
                "content-type": "text/csv",
                "content-disposition": 'attachment; filename="applicants.csv"',
                "cache-control": "no-store",
              },
            },
          );
        return reply(rows);
      }
    }
    if (method !== "POST") fail(405, "This action is not available.");
    if (kind === "apply") {
      if (request.headers.get("origin") !== (process.env.APP_ORIGIN ?? new URL(request.url).origin))
        fail(403, "Refresh this page and try again.");
      const reader = request.body?.getReader();
      if (!reader) fail(400, "Choose a CV.");
      const parts: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > CV_LIMIT + 16384) {
          await reader.cancel();
          fail(413, "Choose a CV up to 5 MB.");
        }
        parts.push(next.value);
      }
      const form = await new Request(request.url, {
        method: "POST",
        headers: { "content-type": request.headers.get("content-type") ?? "" },
        body: Buffer.concat(parts),
      }).formData();
      const f = form.get("cv");
      if (!(f instanceof File)) fail(400, "Choose a PDF CV.");
      return reply(
        await apply(
          user,
          text(form.get("job")),
          text(form.get("name")),
          Buffer.from(await f.arrayBuffer()),
          f.name,
          f.type,
        ),
        201,
      );
    }
    const body = await readBody(request);
    if (kind === "jobs") {
      await owner(request);
      if (action === "close" || action === "open") {
        await db.query("UPDATE hiring_jobs SET open=$2 WHERE id=$1", [uuid(id), action === "open"]);
        return reply({ ok: true });
      }
      const title = text(body.title),
        description = text(body.description, 12000),
        location = text(body.location);
      return reply(
        (
          await db.query(
            "INSERT INTO hiring_jobs(title,description,location) VALUES($1,$2,$3) RETURNING *",
            [title, description, location],
          )
        ).rows[0],
        201,
      );
    }
    if (kind === "import") {
      await owner(request);
      const rows = parseCSV(text(body.csv, 12000));
      if (rows.shift()?.join(",") !== "title,description,location,open")
        fail(400, "Use columns title,description,location,open.");
      await transaction(async (c) => {
        for (const row of rows) {
          if (row.length !== 4 || !["true", "false"].includes(row[3] ?? ""))
            fail(400, "Each job needs four columns and open true or false.");
          await c.query(
            "INSERT INTO hiring_jobs(title,description,location,open) VALUES($1,$2,$3,$4)",
            [text(row[0]), text(row[1], 12000), text(row[2]), row[3] === "true"],
          );
        }
      });
      return reply({ count: rows.length });
    }
    if (kind === "team") {
      await owner(request);
      const email = text(body.email).toLowerCase();
      await transaction(async (c) => {
        const person = await c.query(
          "SELECT id,role,email_verified_at FROM app_users WHERE email=$1 FOR UPDATE",
          [email],
        );
        if (!person.rows[0] || !["member", "team"].includes(person.rows[0].role))
          fail(409, "Ask this person to create a candidate account first.");
        // Anyone can sign up with any address; only one its owner confirmed proves who holds it.
        if (!person.rows[0].email_verified_at)
          fail(
            409,
            emailOff()
              ? "Email is off, so this person can't confirm their address. Turn on email to add team members."
              : "Ask this person to confirm their email address first.",
          );
        const existing = await c.query(
          "SELECT 1 FROM hiring_applications WHERE candidate_id=$1 LIMIT 1",
          [person.rows[0].id],
        );
        if (existing.rows[0]) fail(409, "Candidates with applications cannot become team members.");
        await c.query("UPDATE app_users SET role='team' WHERE id=$1", [person.rows[0].id]);
      });
      return reply({ ok: true });
    }
    if (kind === "assign") {
      await owner(request);
      await transaction(async (c) => {
        await c.query("SELECT id FROM hiring_jobs WHERE id=$1 FOR UPDATE", [uuid(body.job)]);
        const member = await c.query(
          "SELECT id FROM app_users WHERE id=$1 AND role='team' FOR SHARE",
          [uuid(body.user)],
        );
        if (!member.rows[0]) fail(400, "Choose a team member.");
        await c.query(
          "INSERT INTO hiring_team(job_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [body.job, body.user],
        );
      });
      return reply({ ok: true });
    }
    if (kind === "stages") {
      await owner(request);
      if (id) {
        const stageId = uuid(id);
        await transaction(async (c) => {
          await c.query("SELECT pg_advisory_xact_lock(3460)");
          const s = await c.query("SELECT id FROM hiring_stages WHERE id=$1 FOR UPDATE", [stageId]);
          if (!s.rows[0]) fail(404, "That stage was not found.");
          if (action === "remove") {
            const used = await c.query(
              "SELECT 1 FROM hiring_applications WHERE stage_id=$1 LIMIT 1",
              [id],
            );
            if (used.rows[0]) fail(409, "An application still uses this stage.");
            const count = await c.query("SELECT count(*) FROM hiring_stages");
            if (Number(count.rows[0].count) <= 1) fail(409, "Keep at least one stage.");
            await c.query("DELETE FROM hiring_stages WHERE id=$1", [id]);
          } else
            await c.query("UPDATE hiring_stages SET name=$2,position=$3 WHERE id=$1", [
              id,
              text(body.name, 80),
              position(body.position),
            ]);
        });
      } else
        await db.query("INSERT INTO hiring_stages(name,position) VALUES($1,$2)", [
          text(body.name, 80),
          position(body.position),
        ]);
      return reply({ ok: true });
    }
    if (kind === "applications" && id) {
      await staff(request);
      const notice = await transaction(async (c) => {
        await applicationAccess(user, id, c, true);
        if (action === "stage") {
          const s = await c.query("SELECT * FROM hiring_stages WHERE id=$1 FOR SHARE", [
            uuid(body.stage),
          ]);
          if (!s.rows[0]) fail(400, "Choose a stage.");
          const changed = await c.query(
            "UPDATE hiring_applications SET stage_id=$2 WHERE id=$1 AND stage_id<>$2 RETURNING id",
            [id, body.stage],
          );
          if (changed.rows[0])
            return addNotice(
              c,
              id,
              "Application status updated",
              `Your application is now at ${s.rows[0].name}.`,
            );
        } else if (action === "note")
          await c.query(
            "INSERT INTO hiring_notes(application_id,author_id,body) VALUES($1,$2,$3)",
            [id, user.id, text(body.body, 4000)],
          );
        else if (action === "rating") {
          const rating = Number(body.rating);
          if (!Number.isInteger(rating) || rating < 1 || rating > 5)
            fail(400, "Choose a rating from 1 to 5.");
          await c.query(
            "INSERT INTO hiring_ratings(application_id,user_id,rating) VALUES($1,$2,$3) ON CONFLICT(application_id,user_id) DO UPDATE SET rating=EXCLUDED.rating",
            [id, user.id, rating],
          );
        } else fail(404, "That action was not found.");
        return null;
      });
      const email = notice ? await notify(notice) : undefined;
      return reply({ ok: true, email });
    }
    throw new AccountError(404, "That page was not found.");
  });
}
// ponytail: no module door mounted means email is off; a door that answers MODULE_OFF for email still reads as on.
const emailOff = () =>
  !existsSync(path.join(process.env.PRAMAAN_MODULES_DIR ?? "/pramaan-modules", "token"));
function position(v: unknown) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 999
    ? n
    : fail(400, "Use an order between 0 and 999.");
}

export { route as GET, route as POST };
