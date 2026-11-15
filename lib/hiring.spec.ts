import { vi } from "vitest";

const door = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  mail: [] as { subject: string }[],
  filesOn: true,
}));
vi.mock("./modules", () => ({
  moduleCall: async (method: string, route: string, body: Buffer) => {
    if (route === "/v1/email") {
      door.mail.push(JSON.parse(body.toString()));
      return { status: 202, body: Buffer.from("{}") };
    }
    if (!door.filesOn) return { status: 404, body: Buffer.from('{"error":"MODULE_OFF"}') };
    if (method === "PUT") door.files.set(route, body);
    if (method === "DELETE") door.files.delete(route);
    return { status: 200, body: door.files.get(route) ?? Buffer.from("{}") };
  },
}));

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "../app/api/hiring/[...path]/route";
import { AccountError, type User } from "./accounts";
import { applicationAccess, apply, csvCell, jobAccess, parseCSV, validateCV } from "./hiring";
import { accountRuntime, database } from "./runtime";

describe("CSV and CV boundaries", () => {
  it("rejects empty, oversized and disguised CVs", () => {
    expect(() => validateCV(Buffer.alloc(0), "a.pdf", "application/pdf")).toThrow();
    expect(() =>
      validateCV(Buffer.alloc(5 * 1024 * 1024 + 1), "a.pdf", "application/pdf"),
    ).toThrow();
    expect(() => validateCV(Buffer.from("<script>"), "a.pdf", "application/pdf")).toThrow();
    expect(() => validateCV(Buffer.from("%PDF-test"), "a.html", "application/pdf")).toThrow();
  });
  it("parses escaped CSV and refuses broken quotes", () => {
    expect(parseCSV('title,description,location,open\nRole,"A, B",Remote,true')).toEqual([
      ["title", "description", "location", "open"],
      ["Role", "A, B", "Remote", "true"],
    ]);
    expect(() => parseCSV('"bad')).toThrow();
    expect(csvCell("=1+1")).toBe('"\'=1+1"');
  });
});
const enabled = Boolean(process.env.DATABASE_URL);
// The runtime may set APP_ORIGIN (kit CI's run of these tests does); requests must come from it.
const ORIGIN = process.env.APP_ORIGIN ?? "http://test.local";
describe.runIf(enabled)("database isolation and application races", () => {
  const member: User = { id: randomUUID(), email: "candidate@test.invalid", role: "member" };
  const other: User = { id: randomUUID(), email: "other@test.invalid", role: "member" };
  const team: User = { id: randomUUID(), email: "team@test.invalid", role: "team" };
  const stranger: User = { id: randomUUID(), email: "stranger@test.invalid", role: "team" };
  const promoteUser: User = { id: randomUUID(), email: "promote@test.invalid", role: "member" };
  const ownerUser: User = { id: randomUUID(), email: "owner@test.invalid", role: "owner" };
  const unconfirmed: User = { id: randomUUID(), email: "unconfirmed@test.invalid", role: "member" };
  let job: string;
  let app: string;

  async function route(u: User, method: string, path: string, body?: unknown) {
    const request = new Request(`${ORIGIN}/api/hiring/${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "x-test-user": u.id,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (method === "GET" ? GET : POST)(request, {
      params: Promise.resolve({ path: (path.split("?")[0] ?? "").split("/") }),
    });
  }
  beforeAll(async () => {
    process.env.SESSION_SECRET = "test-only-hiring-secret-at-least-32-characters";
    const users = [member, other, team, stranger, promoteUser, ownerUser, unconfirmed];
    vi.spyOn(accountRuntime(), "requireUser").mockImplementation(
      async (request) => users.find((u) => u.id === request.headers.get("x-test-user")) ?? member,
    );
    vi.spyOn(accountRuntime(), "requireRole").mockImplementation(async (request, roles) => {
      const u = users.find((u) => u.id === request.headers.get("x-test-user")) ?? member;
      if (!roles.includes(u.role)) throw new AccountError(403, "Forbidden");
      return u;
    });
    for (const u of [member, other, team, stranger, promoteUser, unconfirmed])
      await database().query(
        "INSERT INTO app_users(id,email,password_hash,role,email_verified_at) VALUES($1,$2,$3,$4,CASE WHEN $5 THEN now() END)",
        [u.id, `${u.id}@test.invalid`, "unused", u.role, u !== unconfirmed],
      );
    job = (
      await database().query(
        "INSERT INTO hiring_jobs(title,description,location) VALUES('Test role','Work with us','Remote') RETURNING id",
      )
    ).rows[0].id;
    await database().query("INSERT INTO hiring_team(job_id,user_id) VALUES($1,$2)", [job, team.id]);
  });
  afterAll(async () => {
    await database().end();
  });
  it("applies once under concurrent requests and cleans up the loser CV", async () => {
    const results = await Promise.allSettled([
      apply(member, job, "Alex", Buffer.from("%PDF-1.7\nCV"), "cv.pdf", "application/pdf"),
      apply(member, job, "Alex", Buffer.from("%PDF-1.7\nCV"), "cv.pdf", "application/pdf"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    app = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ id: string }>)
      .value.id;
    expect(door.files.size).toBe(1);
    expect(door.mail.filter((m) => m.subject === "Application received")).toHaveLength(1);
  });
  it("permits assigned team and own candidate, blocks strangers", async () => {
    expect((await applicationAccess(member, app)).id).toBe(app);
    expect((await applicationAccess(team, app)).id).toBe(app);
    await expect(applicationAccess(other, app)).rejects.toMatchObject({ status: 404 });
    await expect(applicationAccess(stranger, app)).rejects.toMatchObject({ status: 404 });
    await expect(jobAccess(stranger, job)).rejects.toMatchObject({ status: 404 });
  });
  it("serves review details and keeps notes and ratings private", async () => {
    expect((await route(team, "GET", `applications/${app}`)).status).toBe(200);
    expect(
      (await route(team, "POST", `applications/${app}/note`, { body: "Private review" })).status,
    ).toBe(200);
    expect((await route(team, "POST", `applications/${app}/rating`, { rating: 4 })).status).toBe(
      200,
    );
    const review = await (await route(team, "GET", `applications/${app}`)).json();
    expect(review.notes[0].body).toBe("Private review");
    expect(review.ratings[0].rating).toBe(4);
    const candidate = await (await route(member, "GET", `applications/${app}`)).json();
    expect(candidate.notes).toEqual([]);
    expect(candidate.ratings).toEqual([]);
    expect((await route(other, "GET", `applications/${app}`)).status).toBe(404);
  });
  it("blocks stranger writes and invalid ratings without changing stored reviews", async () => {
    expect(
      (await route(stranger, "POST", `applications/${app}/note`, { body: "Intrusion" })).status,
    ).toBe(404);
    expect((await route(member, "POST", `applications/${app}/rating`, { rating: 5 })).status).toBe(
      403,
    );
    expect((await route(team, "POST", `applications/${app}/rating`, { rating: 6 })).status).toBe(
      400,
    );
    expect(
      (await database().query("SELECT rating FROM hiring_ratings WHERE application_id=$1", [app]))
        .rows[0].rating,
    ).toBe(4);
    expect(
      (await database().query("SELECT count(*) FROM hiring_notes WHERE application_id=$1", [app]))
        .rows[0].count,
    ).toBe("1");
  });
  it("moves a stage once and hides unrelated exports", async () => {
    const stage = (await database().query("SELECT id FROM hiring_stages WHERE name='Interview'"))
      .rows[0].id;
    expect((await route(team, "POST", `applications/${app}/stage`, { stage })).status).toBe(200);
    expect((await route(team, "POST", `applications/${app}/stage`, { stage })).status).toBe(200);
    expect((await applicationAccess(member, app)).stage).toBe("Interview");
    expect(door.mail.filter((m) => m.subject === "Application status updated")).toHaveLength(1);
    expect((await route(stranger, "GET", `applications?job=${job}&csv=1`)).status).toBe(404);
    const csv = await route(team, "GET", `applications?job=${job}&csv=1`);
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain("Alex");
  });
  it("serialises team promotion against applying", async () => {
    const results = await Promise.allSettled([
      apply(
        promoteUser,
        job,
        "Changing role",
        Buffer.from("%PDF-1.7"),
        "cv.pdf",
        "application/pdf",
      ),
      route(ownerUser, "POST", "team", { email: `${promoteUser.id}@test.invalid` }),
    ]);
    const role = (
      await database().query("SELECT role FROM app_users WHERE id=$1", [promoteUser.id])
    ).rows[0].role;
    const count = Number(
      (
        await database().query("SELECT count(*) FROM hiring_applications WHERE candidate_id=$1", [
          promoteUser.id,
        ])
      ).rows[0].count,
    );
    expect(role === "team" ? count === 0 : count === 1).toBe(true);
    if (results[0].status === "fulfilled")
      expect((results[1] as PromiseFulfilledResult<Response>).value.status).toBe(409);
    else expect((results[1] as PromiseFulfilledResult<Response>).value.status).toBe(200);
  });
  it("protects used stages and rolls back a partly invalid import", async () => {
    const stage = (
      await database().query("SELECT stage_id FROM hiring_applications WHERE id=$1", [app])
    ).rows[0].stage_id;
    expect((await route(ownerUser, "POST", `stages/${stage}/remove`, {})).status).toBe(409);
    const before = (await database().query("SELECT count(*) FROM hiring_jobs")).rows[0].count;
    expect(
      (
        await route(ownerUser, "POST", "import", {
          csv: "title,description,location,open\nValid,Description,Remote,true\nInvalid,Description,Remote,maybe",
        })
      ).status,
    ).toBe(400);
    expect((await database().query("SELECT count(*) FROM hiring_jobs")).rows[0].count).toBe(before);
  });
  it("promotes and emails only confirmed addresses", async () => {
    const address = `${unconfirmed.id}@test.invalid`;
    // Tests mount no module door, so email reads as off.
    const refused = await route(ownerUser, "POST", "team", { email: address });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe(
      "Email is off, so this person can't confirm their address. Turn on email to add team members.",
    );
    expect(
      (await database().query("SELECT role FROM app_users WHERE id=$1", [unconfirmed.id])).rows[0]
        .role,
    ).toBe("member");
    const applied = await apply(
      unconfirmed,
      job,
      "Unconfirmed",
      Buffer.from("%PDF-1.7"),
      "cv.pdf",
      "application/pdf",
    );
    expect(applied.email).toBe("unconfirmed");
    expect(door.mail.some((m) => (m as { to?: string }).to === address)).toBe(false);
  });
  it("refuses closed jobs and removes unreferenced files", async () => {
    await database().query("UPDATE hiring_jobs SET open=false WHERE id=$1", [job]);
    await expect(
      apply(other, job, "Other", Buffer.from("%PDF-1.7"), "cv.pdf", "application/pdf"),
    ).rejects.toMatchObject({ status: 404 });
    expect(door.files.size).toBeGreaterThanOrEqual(1);
  });
  it("reports disabled storage and creates no application", async () => {
    door.filesOn = false;
    await expect(
      apply(other, job, "Other", Buffer.from("%PDF-1.7"), "cv.pdf", "application/pdf"),
    ).rejects.toMatchObject({ status: 503 });
    expect(
      (
        await database().query("SELECT count(*) FROM hiring_applications WHERE candidate_id=$1", [
          other.id,
        ])
      ).rows[0].count,
    ).toBe("0");
  });
});
