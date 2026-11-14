"use client";
import { type FormEvent, useEffect, useState } from "react";
export type User = { id: string; email: string; role: string };
export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    path.startsWith("/api/") ? path : `/api/hiring/${path}`,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) throw Error(data.error ?? "Please try again.");
  return data;
}
export function useSession() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    api<{ user: User }>("/api/account/session")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);
  return user;
}
export function Auth() {
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const action = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ?? "signin";
    try {
      await api(`/api/account/${action}`, { email: f.get("email"), password: f.get("password") });
      window.location.assign("/workspace");
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <section className="card">
      <h2>Welcome back. Or start here.</h2>
      <p className="muted">
        Candidates sign up before applying. Team members sign up, then the owner adds their access.
      </p>
      <form onSubmit={submit} className="stack">
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            minLength={12}
            required
            autoComplete="current-password"
          />
        </label>
        <div className="row">
          <button value="signin" type="submit">
            Sign in
          </button>
          <button value="signup" type="submit">
            Create account
          </button>
        </div>
      </form>
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
