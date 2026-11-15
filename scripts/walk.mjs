import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The kit carries the starter's package.json, which has no browser tools: point WALK_BROWSER_MODULE at an installed
// @playwright/test (its index.js) to run this walk.
const browserModule = process.env.WALK_BROWSER_MODULE;
const { chromium, expect } = await import(
  browserModule ? pathToFileURL(browserModule).href : "@playwright/test"
);

import { startFakeDoor } from "./fake-door.mjs";

const origin = "http://127.0.0.1:3460",
  secret = randomBytes(32).toString("hex"),
  project = "hiring-walk";
if (!process.env.DATABASE_URL) throw Error("Use a disposable migrated DATABASE_URL.");
mkdirSync(".evidence", { recursive: true });
const doorDir = path.resolve(".evidence/door");
const door = await startFakeDoor(doorDir);
let browserPeak = 0;
let appPeak = 0,
  assertions = 0;
const checks = [];
const suffix = randomBytes(4).toString("hex");
function pass() {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      role: "owner",
      project,
      iat: now,
      exp: now + 60,
      nonce: randomBytes(18).toString("base64url"),
    }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`pramaan-owner-pass.v1.${payload}`).digest("base64url")}`;
}
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", "3460", "-H", "127.0.0.1"],
  {
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      SESSION_SECRET: secret,
      PRAMAAN_PROJECT_ID: project,
      APP_ORIGIN: origin,
      APP_COOKIE_SECURE: "false",
      PRAMAAN_MODULES_DIR: doorDir,
      APP_AUTH_ATTEMPTS: "100",
      APP_AUTH_CLIENT_ATTEMPTS: "100",
    },
  },
);
const sampler = setInterval(() => {
  try {
    const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((r) => r.trim().split(/\s+/).map(Number));
    const tree = new Set([server.pid]);
    for (let change = true; change; ) {
      change = false;
      for (const [pid, ppid] of rows)
        if (tree.has(ppid) && !tree.has(pid)) {
          tree.add(pid);
          change = true;
        }
    }
    const all = new Set([process.pid]);
    for (let more = true; more; ) {
      more = false;
      for (const [pid, ppid] of rows)
        if (all.has(ppid) && !all.has(pid)) {
          all.add(pid);
          more = true;
        }
    }
    browserPeak = Math.max(
      browserPeak,
      Math.ceil(
        rows
          .filter(([pid]) => all.has(pid) && !tree.has(pid))
          .reduce((sum, [, , rss]) => sum + rss, 0) / 1024,
      ),
    );
    appPeak = Math.max(
      appPeak,
      Math.ceil(rows.filter(([pid]) => tree.has(pid)).reduce((s, [, , rss]) => s + rss, 0) / 1024),
    );
  } catch {
    /* Process may have ended. */
  }
}, 100);
let browser;
const contexts = [];
async function page() {
  const c = await browser.newContext();
  contexts.push(c);
  return c.newPage();
}
async function post(p, url, data) {
  return p.request.post(`${origin}/api/hiring/${url}`, { data, headers: { origin } });
}
async function status(p, url, want, data) {
  const r =
    data === undefined
      ? await p.request.get(`${origin}/api/hiring/${url}`)
      : await post(p, url, data);
  expect(r.status(), url).toBe(want);
  assertions++;
  return r;
}
async function signUp(email) {
  const p = await page();
  await p.goto(origin);
  await p.getByLabel("Email", { exact: true }).fill(email);
  await p.getByLabel("Password", { exact: true }).fill("Hiring-test-pass-2026");
  await p.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(p.getByRole("heading", { name: "Your next steps." })).toBeVisible();
  // The app mails only confirmed addresses and adds only confirmed people to the team.
  let link;
  await expect
    .poll(() => {
      const m = door.mail.findLast(
        (x) => x.to === email && x.subject === "Confirm your email address",
      );
      link = m?.text.match(/https?:\/\/\S+/u)?.[0];
      return Boolean(link);
    })
    .toBe(true);
  await p.goto(link);
  await p.close();
  return p;
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) break;
    } catch {
      /* Starting. */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true });
  let owner = await page();
  const token = pass();
  await owner.goto(`${origin}/api/account/owner-pass?token=${token}`);
  await expect(owner.getByRole("heading", { name: "Owner area" })).toBeVisible();
  expect(
    (
      await owner.request.get(`${origin}/api/account/owner-pass?token=${token}`, {
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(401);
  assertions++;
  await owner.getByLabel("Owner email", { exact: true }).fill(`owner-${suffix}@example.test`);
  await owner.getByLabel("Password", { exact: true }).fill("Owner-hiring-pass-2026");
  await owner.getByRole("button", { name: "Save sign-in", exact: true }).click();
  await expect(
    owner.getByText("Saved. You can now sign in with this email and password.", { exact: true }),
  ).toBeVisible();
  await owner.getByRole("button", { name: "Sign out", exact: true }).click();
  await owner.getByLabel("Email", { exact: true }).fill(`owner-${suffix}@example.test`);
  await owner.getByLabel("Password", { exact: true }).fill("Owner-hiring-pass-2026");
  await owner.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(owner.getByRole("heading", { name: "Make room for great people." })).toBeVisible();
  await owner.close();
  let member = await signUp(`member-${suffix}@example.test`);
  let candidate = await signUp(`candidate-${suffix}@example.test`);
  let other = await signUp(`other-${suffix}@example.test`);
  const unassigned = await signUp(`unassigned-${suffix}@example.test`);
  // Run every declared shipping checklist, as the contract runner does.
  const manifest = JSON.parse(readFileSync("pramaan.kit.json", "utf8"));
  for (const j of manifest.journeys.filter((j) => j.status === "ships-working")) {
    const items = JSON.parse(readFileSync(j.checklist, "utf8")).items;
    const role = items[0].steps[0].enterAs;
    const p = role === "owner" ? await owner.context().newPage() : await page();
    for (const item of items)
      for (const step of item.steps) {
        if (step.enterAs) {
          // As kit CI does: the owner is signed in; anyone else starts signed out at the home page.
          if (step.enterAs !== "owner") await p.goto(origin);
        } else if (step.goto) await p.goto(origin + step.goto);
        else if (step.fill)
          await p
            .getByLabel(step.fill, { exact: true })
            .fill(step.value.replace(/^journey-([a-z]+)@/u, `journey-$1-${suffix}@`));
        else if (step.click) await p.getByRole("button", { name: step.click, exact: true }).click();
        else if (step.expectText)
          await expect(p.getByText(step.expectText, { exact: false }).first()).toBeVisible();
        else if (step.expectAbsent)
          await expect(p.getByText(step.expectAbsent, { exact: false })).toHaveCount(0);
        assertions++;
      }
    await p.close();
    checks.push(j.id);
  }
  owner = await owner.context().newPage();
  await owner.goto(origin + "/workspace");
  await owner.getByLabel("Job title", { exact: true }).fill("Product engineer");
  await owner
    .getByLabel("Description", { exact: true })
    .fill("Build thoughtful tools with a small team.");
  await owner.getByLabel("Location", { exact: true }).fill("London / Remote");
  await owner.getByRole("button", { name: "Create job", exact: true }).click();
  await expect(owner.getByText("Job created.", { exact: true })).toBeVisible();
  const jobs = await (await status(owner, "jobs", 200)).json();
  const job = jobs.find((j) => j.title === "Product engineer").id;
  await owner.getByLabel("Team email", { exact: true }).fill(`member-${suffix}@example.test`);
  await owner.getByRole("button", { name: "Add team member", exact: true }).click();
  await expect(owner.getByText("Team member added.", { exact: true })).toBeVisible();
  await status(owner, "team", 200, { email: `unassigned-${suffix}@example.test` });
  await owner.getByLabel("Assign job", { exact: true }).selectOption(job);
  await owner
    .getByLabel("Team member", { exact: true })
    .selectOption({ label: `member-${suffix}@example.test` });
  await owner.getByRole("button", { name: "Assign member", exact: true }).click();
  await expect(owner.getByText("Team member assigned.", { exact: true })).toBeVisible();
  await owner.close();
  candidate = await candidate.context().newPage();
  await candidate.goto(`${origin}/apply?job=${job}`);
  await candidate.getByLabel("Full name", { exact: true }).fill("Alex Candidate");
  await candidate.getByLabel("CV", { exact: true }).setInputFiles({
    name: "alex.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nHiring test CV\n%%EOF"),
  });
  await candidate.getByRole("button", { name: "Submit application", exact: true }).click();
  await expect(candidate.getByRole("status")).toContainText("Application received.");
  const own = await (await status(candidate, "applications", 200)).json();
  expect(own).toHaveLength(1);
  const application = own[0].id;
  await candidate.close();
  member = await member.context().newPage();
  await member.goto(`${origin}/workspace`);
  await member.getByRole("button", { name: "Sign out", exact: true }).click();
  await member.getByLabel("Email", { exact: true }).fill(`member-${suffix}@example.test`);
  await member.getByLabel("Password", { exact: true }).fill("Hiring-test-pass-2026");
  await member.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(member.getByRole("heading", { name: "Make room for great people." })).toBeVisible();
  await member.goto(origin + "/workspace");
  await member.getByLabel("Job", { exact: true }).selectOption(job);
  await member.getByRole("button", { name: "Review Alex Candidate", exact: true }).click();
  await expect(member.getByRole("heading", { name: "Application review" })).toBeVisible();
  await member.getByLabel("Your rating", { exact: true }).selectOption("4");
  await member.getByRole("button", { name: "Save rating", exact: true }).click();
  await expect(
    member.getByText(`member-${suffix}@example.test: 4 / 5`, { exact: true }),
  ).toBeVisible();
  await member
    .getByLabel("Private team note", { exact: true })
    .fill("Strong portfolio. Discuss systems experience.");
  await member.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(
    member.getByText("Strong portfolio. Discuss systems experience.", { exact: false }),
  ).toBeVisible();
  await member.getByLabel("Pipeline stage", { exact: true }).selectOption({ label: "Interview" });
  await expect(member.getByRole("status")).toContainText("Stage updated.");
  await member.close();
  candidate = await candidate.context().newPage();
  await candidate.goto(origin + "/workspace");
  await expect(candidate.getByText("Interview", { exact: true })).toBeVisible();
  await expect(candidate.getByText("Strong portfolio.", { exact: false })).toHaveCount(0);
  expect(
    door.mail.some(
      (m) => m.to === `candidate-${suffix}@example.test` && m.subject === "Application received",
    ),
  ).toBe(true);
  expect(
    door.mail.some(
      (m) => m.to === `candidate-${suffix}@example.test` && m.text.includes("Interview"),
    ),
  ).toBe(true);
  assertions += 2;
  for (const p of [other, unassigned]) {
    await status(p, `applications/${application}`, 404);
    await status(p, `applications/${application}/cv`, 404);
    await status(p, `applications/${application}/rating`, p === other ? 403 : 404, { rating: 5 });
    await status(p, `applications/${application}/note`, p === other ? 403 : 404, {
      body: "intrusion",
    });
    await status(p, `applications/${application}/stage`, p === other ? 403 : 404, {
      stage: randomBytes(16).toString("hex"),
    });
  }
  expect(await (await status(other, "applications", 200)).json()).toEqual([]);
  expect(await (await status(unassigned, "jobs", 200)).json()).toEqual([]);
  await status(unassigned, `applications?job=${job}&csv=1`, 404);
  await status(candidate, `applications/${application}/rating`, 403, { rating: 5 });
  await status(member, "jobs", 403, { title: "Forbidden", description: "No", location: "No" });
  await status(candidate, "team", 403, { email: "no@example.test" });
  const stages = await (await status(owner, "stages", 200)).json();
  const interview = stages.find((s) => s.name === "Interview").id;
  await status(owner, `stages/${interview}/remove`, 409, {});
  await status(member, `applications/${application}/rating`, 400, { rating: 6 });
  const csv = await (await status(member, `applications?job=${job}&csv=1`, 200)).text();
  expect(csv).toContain("Alex Candidate");
  expect(csv).toContain("Interview");
  assertions++;
  const cv = await status(candidate, `applications/${application}/cv`, 200);
  expect((await cv.body()).subarray(0, 5).toString()).toBe("%PDF-");
  assertions++;
  // Bad origin, role forgery, invalid file and disabled modules.
  expect(
    (
      await member.request.post(`${origin}/api/hiring/applications/${application}/rating`, {
        data: { rating: 1 },
        headers: { origin: "http://elsewhere.invalid" },
      })
    ).status(),
  ).toBe(403);
  assertions++;
  const before = door.files.size;
  const invalid = await other.request.post(`${origin}/api/hiring/apply`, {
    headers: { origin },
    multipart: {
      name: "Other",
      job,
      cv: { name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a PDF") },
    },
  });
  expect(invalid.status()).toBe(400);
  expect(door.files.size).toBe(before);
  assertions += 2;
  door.filesOn = false;
  await candidate.close();
  other = await other.context().newPage();
  await other.goto(`${origin}/apply?job=${job}`);
  await other.getByLabel("Full name", { exact: true }).fill("Other Candidate");
  await other.getByLabel("CV", { exact: true }).setInputFiles({
    name: "other.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nCV"),
  });
  await other.getByRole("button", { name: "Submit application", exact: true }).click();
  await expect(other.getByRole("status")).toContainText("CV storage isn't switched on");
  door.filesOn = true;
  await other.close();
  const large = await other.request.post(`${origin}/api/hiring/apply`, {
    headers: { origin },
    multipart: {
      name: "Other",
      job,
      cv: {
        name: "large.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      },
    },
  });
  expect(large.status()).toBe(413);
  assertions++;
  door.emailOn = false;
  const offer = stages.find((s) => s.name === "Offer").id;
  const offEmail = await (
    await status(member, `applications/${application}/stage`, 200, { stage: offer })
  ).json();
  expect(offEmail.email).toBe("not-sent");
  assertions++;
  door.emailOn = true;
  await status(member, `applications/${application}/stage`, 200, { stage: interview });
  member = await member.context().newPage();
  await member.goto(`${origin}/workspace`);
  await member.getByLabel("Job", { exact: true }).selectOption(job);
  await member.getByRole("button", { name: "Review Alex Candidate", exact: true }).click();
  await expect(member.getByRole("heading", { name: "Application review" })).toBeVisible();
  await member.screenshot({ path: ".evidence/pipeline-desktop.png", fullPage: true });
  await member.close();
  owner = await owner.context().newPage();
  await owner.goto(`${origin}/workspace`);
  await expect(owner.getByRole("heading", { name: "Your hiring team" })).toBeVisible();
  await owner.screenshot({ path: ".evidence/owner-desktop.png", fullPage: true });
  await owner.close();
  candidate = await candidate.context().newPage();
  await candidate.goto(`${origin}/workspace`);
  await expect(candidate.getByText("Interview", { exact: true })).toBeVisible();
  await candidate.setViewportSize({ width: 390, height: 844 });
  await candidate.screenshot({ path: ".evidence/candidate-mobile.png", fullPage: true });
  expect(
    await candidate.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  assertions++;
  checks.push(
    "complete-hiring-flow",
    "candidate-isolation",
    "unassigned-team-isolation",
    "cv-validation",
    "disabled-storage",
    "csv-export",
    "stage-in-use",
    "same-origin",
    "owner-password-signin",
    "team-password-signin",
    "disabled-email",
    "oversized-cv",
  );
  console.log(
    JSON.stringify(
      {
        checks,
        assertions,
        appPeakMiB: appPeak,
        browserPeakMiB: browserPeak,
        mail: door.mail.length,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    ".evidence/walk.json",
    JSON.stringify(
      {
        ok: true,
        checks,
        assertions,
        appPeakMiB: appPeak,
        browserPeakMiB: browserPeak,
        mail: door.mail.length,
      },
      null,
      2,
    ),
  );
} finally {
  for (const c of contexts) await c.close();
  await browser?.close();
  clearInterval(sampler);
  server.kill("SIGTERM");
  if (server.exitCode === null) await new Promise((r) => server.once("exit", r));
  await door.close();
}
