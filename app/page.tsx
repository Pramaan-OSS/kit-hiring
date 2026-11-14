"use client";
import { useEffect, useState } from "react";
import { Auth, api, useSession } from "./client";

type Job = { id: string; title: string; description: string; location: string };
export default function Board() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [message, setMessage] = useState("");
  const user = useSession();
  useEffect(() => {
    api<Job[]>("board")
      .then(setJobs)
      .catch((e) => setMessage(e.message));
  }, []);
  return (
    <main className="hiring">
      <div className="eyebrow">Small team. Meaningful work.</div>
      <h1>
        Find your next
        <br />
        good beginning.
      </h1>
      <p className="muted">Explore our open roles. Tell us what you could bring.</p>
      {message && <p role="alert">{message}</p>}
      <div className="grid">
        {jobs.map((j) => (
          <article className="card stack" key={j.id}>
            <span className="eyebrow">{j.location}</span>
            <h2>{j.title}</h2>
            <p>{j.description}</p>
            <a className="button" href={`/apply?job=${j.id}`}>
              Apply for {j.title}
            </a>
          </article>
        ))}
      </div>
      {!jobs.length && !message && (
        <div className="card">No open roles right now. Check back soon.</div>
      )}
      <div className="section">
        {user ? (
          <p>
            Signed in as {user.email}. <a href="/workspace">Open your workspace</a>
          </p>
        ) : (
          <Auth />
        )}
      </div>
    </main>
  );
}
