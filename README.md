# Hiring

A small-company job board and private hiring pipeline. Candidates apply with a PDF CV and see their own status. The owner adds signed-up team members and assigns jobs. Only the assigned team can review, rate and move applicants.

Use Node 24.18.0 and pnpm 11.15.1. Install with `pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile`. Set DATABASE_URL, SESSION_SECRET (at least 32 characters), APP_ORIGIN and PRAMAAN_PROJECT_ID in the server environment. Run `pnpm db:migrate`, `pnpm build`, then `pnpm start --port 3460`. Use APP_COOKIE_SECURE=false only for local HTTP. Open the owner through the platform's owner pass; public sign-up never grants ownership.

The platform mounts the private files and email modules. Without files, CV applications are unavailable; without email, application and stage-change messages are recorded as not sent. No external vendor credentials are needed by the app. For a local complete demonstration, run `pnpm walk` against a disposable migrated database; it starts its own fake modules and headless browser on the reserved ports.

Job import columns: title,description,location,open. The import is atomic, at most 200 jobs and 12 KB. Applicant CSV exports are scoped to the selected job. CVs must be PDF, non-empty and at most 5 MiB. Notes and ratings are private to the hiring team.

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm blocks:check`, and `node scripts/check-contract.mjs`. Database tests require a disposable DATABASE_URL; without one they are explicitly skipped. KIT.md describes extension points. GAPS.md describes module prerequisites.

## Built on

The MIT [data starter](https://github.com/Pramaan-Dev/product-loop) and [Pramaan blocks](https://github.com/Pramaan-OSS/blocks), pinned in the manifest and blocks.lock.json. Original notices are retained in NOTICE.md. This kit is MIT.
