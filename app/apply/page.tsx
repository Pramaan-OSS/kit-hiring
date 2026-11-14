"use client";
import { type FormEvent, useState } from "react";
import { Auth, useSession } from "../client";
export default function Apply() {
  const user = useSession();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    f.set("job", new URLSearchParams(window.location.search).get("job") ?? "");
    try {
      const r = await fetch("/api/hiring/apply", { method: "POST", body: f });
      const v = await r.json();
      if (!r.ok) throw Error(v.error);
      setMessage(
        "Application received. Track your status in your workspace." +
          (v.email === "not-sent"
            ? " Email is unavailable, so no receipt email was sent."
            : v.email === "unconfirmed"
              ? " Confirm your email address to get email updates."
              : v.email === "unknown"
                ? " Email delivery could not be confirmed."
                : ""),
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="hiring">
      <div className="eyebrow">Your next chapter</div>
      <h1>Introduce yourself.</h1>
      <p>
        Upload a PDF CV, up to 5 MB. Your CV is private to you and the hiring team assigned to this
        role.
      </p>
      {!user ? (
        <Auth />
      ) : user.role !== "member" ? (
        <p>Sign in with a candidate account to apply.</p>
      ) : (
        <form className="card stack" onSubmit={submit}>
          <label>
            Full name
            <input name="name" required maxLength={200} />
          </label>
          <label>
            CV
            <input name="cv" type="file" accept="application/pdf,.pdf" required />
          </label>
          <button type="submit" disabled={busy}>
            Submit application
          </button>
        </form>
      )}
      {message && (
        <div className="notice" role="status">
          {message} <a href="/workspace">Your workspace</a>
        </div>
      )}
    </main>
  );
}
