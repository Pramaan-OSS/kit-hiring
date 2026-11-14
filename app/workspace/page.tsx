"use client";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Auth, api, useSession } from "../client";

type Job = { id: string; title: string; location: string; open: boolean };
type Stage = { id: string; name: string; position: number };
type Application = {
  id: string;
  name?: string;
  email?: string;
  title?: string;
  stage: string;
  stage_id?: string;
};
type Detail = {
  title: string;
  stage: string;
  notes: { id: string; body: string; email: string }[];
  ratings: { rating: number; email: string }[];
};
export default function Workspace() {
  const user = useSession();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [team, setTeam] = useState<{ id: string; email: string }[]>([]);
  const [job, setJob] = useState("");
  const [apps, setApps] = useState<Application[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((x) => x + 1);
  const report = useCallback((e: Error) => setMessage(e.message), []);
  useEffect(() => {
    void tick;
    if (!user) return;
    if (user.role === "member") {
      api<Application[]>("applications").then(setApps).catch(report);
    } else {
      api<Job[]>("jobs").then(setJobs).catch(report);
      api<Stage[]>("stages").then(setStages).catch(report);
      if (user.role === "owner")
        api<{ id: string; email: string }[]>("team").then(setTeam).catch(report);
    }
  }, [user, tick, report]);
  useEffect(() => {
    void tick;
    let active = true;
    if (job)
      api<Application[]>(`applications?job=${job}`)
        .then((value) => {
          if (active) setApps(value);
        })
        .catch((e) => {
          if (active) report(e);
        });
    return () => {
      active = false;
    };
  }, [job, tick, report]);
  useEffect(() => {
    void tick;
    let active = true;
    if (selected)
      api<Detail>(`applications/${selected}`)
        .then((value) => {
          if (active) setDetail(value);
        })
        .catch((e) => {
          if (active) report(e);
        });
    return () => {
      active = false;
    };
  }, [selected, tick, report]);
  async function act(path: string, body: unknown, success = "Saved.") {
    try {
      const result = await api<{ email?: string }>(path, body);
      setMessage(
        success +
          (result.email === "not-sent"
            ? " Email is unavailable, so no email was sent."
            : result.email === "unconfirmed"
              ? " The candidate hasn't confirmed their email address, so no email was sent."
              : result.email === "unknown"
                ? " Email delivery could not be confirmed."
                : ""),
      );
      refresh();
    } catch (e) {
      report(e as Error);
    }
  }
  function form(path: string, success?: string) {
    return (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      void act(path, Object.fromEntries(new FormData(e.currentTarget)), success);
    };
  }
  if (!user)
    return (
      <main className="hiring">
        <h1>Your workspace</h1>
        <Auth />
      </main>
    );
  return (
    <main className="hiring">
      <div className="row">
        <span className="eyebrow">
          {user.role === "member" ? "Candidate workspace" : "Hiring workspace"}
        </span>
        <span className="muted">{user.email}</span>
        <button
          type="button"
          onClick={() =>
            void api("/api/account/signout", {}).then(() => window.location.assign("/"))
          }
        >
          Sign out
        </button>
      </div>
      <h1>{user.role === "member" ? "Your next steps." : "Make room for great people."}</h1>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {user.role === "member" ? (
        <div className="grid">
          {apps.map((a) => (
            <article className="card stack" key={a.id}>
              <h2>{a.title}</h2>
              <span className="badge">{a.stage}</span>
              <a href={`/api/hiring/applications/${a.id}/cv`}>Download your CV</a>
            </article>
          ))}
          {!apps.length && (
            <p>
              No applications yet. <a href="/">Explore open roles</a>
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="row">
            <label>
              Job
              <select
                aria-label="Job"
                value={job}
                onChange={(e) => {
                  setJob(e.target.value);
                  setApps([]);
                  setSelected("");
                  setDetail(null);
                }}
              >
                <option value="">Choose a job</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                    {j.open ? "" : " (closed)"}
                  </option>
                ))}
              </select>
            </label>
            {job && <a href={`/api/hiring/applications?job=${job}&csv=1`}>Export applicants</a>}
          </div>
          {job && (
            <div className="pipeline">
              {stages.map((s) => (
                <section className="column" key={s.id}>
                  <h3>
                    {s.name} · {apps.filter((a) => a.stage_id === s.id).length}
                  </h3>
                  {apps
                    .filter((a) => a.stage_id === s.id)
                    .map((a) => (
                      <article className="card stack" key={a.id}>
                        <strong>{a.name}</strong>
                        <p>{a.email}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setDetail(null);
                            setSelected(a.id);
                          }}
                        >
                          Review {a.name}
                        </button>
                      </article>
                    ))}
                </section>
              ))}
            </div>
          )}
          {selected && detail && (
            <section className="card stack">
              <h2>Application review</h2>
              <a href={`/api/hiring/applications/${selected}/cv`}>Download CV</a>
              <label>
                Pipeline stage
                <select
                  aria-label="Pipeline stage"
                  value={stages.find((s) => s.name === detail.stage)?.id ?? ""}
                  onChange={(e) =>
                    void act(
                      `applications/${selected}/stage`,
                      { stage: e.target.value },
                      "Stage updated.",
                    )
                  }
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <form className="row" onSubmit={form(`applications/${selected}/rating`)}>
                <label>
                  Your rating
                  <select aria-label="Your rating" name="rating">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <button type="submit">Save rating</button>
              </form>
              {detail.ratings.map((r) => (
                <p key={r.email}>
                  {r.email}: {r.rating} / 5
                </p>
              ))}
              <form className="stack" onSubmit={form(`applications/${selected}/note`)}>
                <label>
                  Private team note
                  <textarea name="body" required maxLength={4000} />
                </label>
                <button type="submit">Add note</button>
              </form>
              {detail.notes.map((n) => (
                <p key={n.id}>
                  <strong>{n.email}</strong> — {n.body}
                </p>
              ))}
            </section>
          )}
          {user.role === "owner" && (
            <>
              <section className="section">
                <h2>Open a role</h2>
                <form className="card stack" onSubmit={form("jobs", "Job created.")}>
                  <label>
                    Job title
                    <input name="title" required maxLength={200} />
                  </label>
                  <label>
                    Description
                    <textarea name="description" required maxLength={12000} />
                  </label>
                  <label>
                    Location
                    <input name="location" required maxLength={200} />
                  </label>
                  <button type="submit">Create job</button>
                </form>
                <div className="grid">
                  {jobs.map((j) => (
                    <div className="card" key={j.id}>
                      <h3>{j.title}</h3>
                      <p>{j.open ? "Open" : "Closed"}</p>
                      <button
                        type="button"
                        onClick={() => void act(`jobs/${j.id}/${j.open ? "close" : "open"}`, {})}
                      >
                        {j.open ? "Close" : "Reopen"} {j.title}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
              <section className="section">
                <h2>Your hiring team</h2>
                <p>
                  A team member creates an account and confirms their email first. Add their email
                  here, then assign them to a job.
                </p>
                <form className="card stack" onSubmit={form("team", "Team member added.")}>
                  <label>
                    Team email
                    <input name="email" type="email" required />
                  </label>
                  <button type="submit">Add team member</button>
                </form>
                <form className="card stack" onSubmit={form("assign", "Team member assigned.")}>
                  <label>
                    Assign job
                    <select aria-label="Assign job" name="job" required>
                      <option value="">Choose a job</option>
                      {jobs.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Team member
                    <select aria-label="Team member" name="user" required>
                      <option value="">Choose a team member</option>
                      {team.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit">Assign member</button>
                </form>
              </section>
              <section className="section">
                <h2>Pipeline stages</h2>
                <form className="card row" onSubmit={form("stages")}>
                  <label>
                    New stage
                    <input name="name" required maxLength={80} />
                  </label>
                  <label>
                    Order
                    <input
                      name="position"
                      type="number"
                      min={0}
                      max={999}
                      defaultValue={6}
                      required
                    />
                  </label>
                  <button type="submit">Add stage</button>
                </form>
                {stages.map((s) => (
                  <form className="card row" key={s.id} onSubmit={form(`stages/${s.id}`)}>
                    <label>
                      Rename {s.name}
                      <input name="name" defaultValue={s.name} required maxLength={80} />
                    </label>
                    <label>
                      Order for {s.name}
                      <input
                        name="position"
                        type="number"
                        min={0}
                        max={999}
                        defaultValue={s.position}
                      />
                    </label>
                    <button type="submit">Save {s.name}</button>
                    <button type="button" onClick={() => void act(`stages/${s.id}/remove`, {})}>
                      Remove {s.name}
                    </button>
                  </form>
                ))}
              </section>
              <section className="section">
                <h2>Import jobs</h2>
                <p>
                  Use a CSV with columns title,description,location,open. Up to 200 jobs; open is
                  true or false.
                </p>
                <form className="card stack" onSubmit={form("import", "Jobs imported.")}>
                  <label>
                    Jobs CSV
                    <textarea
                      name="csv"
                      required
                      placeholder={
                        "title,description,location,open\nDesigner,Help shape our product,Remote,true"
                      }
                    />
                  </label>
                  <button type="submit">Import jobs</button>
                </form>
              </section>
            </>
          )}
        </>
      )}
      <p className="muted section">
        Email and CV storage need the platform modules switched on. When unavailable, the app
        explains what could not be delivered or stored.
      </p>
    </main>
  );
}
