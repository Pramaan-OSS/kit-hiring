import type { ReactNode } from "react";
export function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="header">
        <a href="/" className="brand">
          Hiring<span> / a place for your next chapter</span>
        </a>
        <nav>
          <a href="/">Open roles</a>
          <a href="/workspace">Workspace</a>
          <a href="/owner">Owner</a>
        </nav>
      </header>
      {children}
      <footer>Good teams start with a conversation.</footer>
    </>
  );
}
