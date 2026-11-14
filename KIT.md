# Hiring kit

## Where things live

- app/page.tsx: public open jobs, candidate sign-up and sign-in.
- app/apply/page.tsx: candidate name and PDF CV form.
- app/workspace/page.tsx: candidate statuses; assigned team pipeline, reviews, notes and ratings; owner job, team, stage and CSV controls.
- app/owner/page.tsx: owner credentials, entered through the owner pass.
- app/client.tsx: browser requests and sign-in form.
- app/layout.tsx: unchanged starter layout and bundled fonts.
- app/shell.tsx, app/site.ts, app/theme.css: navigation, name and shared theme.
- app/api/account/[action]/route.ts: unchanged account action handler.
- app/api/health/route.ts: unchanged health endpoint.
- app/api/hiring/[...path]/route.ts: public board; server-scoped jobs, applications, CVs, notes, ratings, stages, team and CSV endpoints.
- lib/accounts.ts: unchanged reviewed accounts and signed owner pass.
- lib/runtime.ts: shared connection pool and account configuration; public sign-up makes candidates.
- lib/hiring.ts: row authorisation, transactions, CV checks, application creation, notifications and CSV functions.
- lib/modules.ts: single HTTP client for the platform module socket.
- lib/email.ts, lib/storage.ts: email and private CV adapters.
- lib/roles/http.ts: unchanged roles block request and error helpers.
- lib/hiring.spec.ts: CV, CSV, application race and row isolation tests.
- src/db/migrations/0001–0004: unchanged starter migrations.
- src/db/migrations/0100-hiring.sql: jobs, candidates, team assignments, stages, applications, notes, ratings and notifications.
- scripts/migrate.mjs: additive migrations; scripts/walk.mjs: headless journeys and permission checks.
- journeys/*.json: shipping checklists. blocks.lock.json: block sources and adaptations.

## Add a field

For example, add a job department using a new migration 0101-job-department.sql. Add a bounded field to the job creation query and import columns in the hiring route, then the workspace form and public board. Test validation and the saved value. Never change a previously applied migration.

## Add a page

Add app/<page>/page.tsx and its pramaan.feature.json, then run pnpm generate. The browser is not a permission boundary: every data route must require the signed-in user and scope queries using jobAccess or applicationAccess. Add the page to this guide and its entry point to the manifest.

## Add a role

Roles live in app_users.role. Public sign-up always produces member (candidate). Only the owner may grant team, and only an explicitly assigned team member sees a job. Keep owner reserved for the signed owner pass. Call requireRole on writes and retain per-job row checks. Test both a permitted user and a signed-in stranger against the server.

## Journeys that ship working

- manage-jobs: create and close a role.
- manage-stages: edit the seeded stage table; a referenced stage cannot be removed.
- import-jobs: import bounded job CSV rows in one transaction.
- owner-settings: open the owner area with a one-time pass.
- candidate-account: create an account and sign in.
- storage-off: see the module requirement in the candidate workspace.

CV application/review and email journeys need their respective modules. Adding a team member needs email
(`add-team-member`, needs-capability): the owner can add only a person whose address is confirmed, and with email
off the app says so plainly. The headless walk uses fake modules to exercise the full flow and verify candidate isolation, assigned-team access, CV boundaries, exports, notification delivery and disabled modules.
