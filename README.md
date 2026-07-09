# Itinerary

A private travel-itinerary app — bookings on a calendar (month/week/day), grouped
by trip, with cost breakdowns, to-dos, and AI parsing of booking documents.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**, `output: "standalone"`
- **Tailwind CSS v4** (design tokens + Material-style utilities in `globals.css`)
- **NextAuth v5** (Auth.js) — Google OAuth, gated by an email allowlist, JWT sessions
- **Drizzle ORM** over **Postgres** (node-postgres in prod; embedded PGlite in dev)
- **PWA** (installable, offline-tolerant service worker)
- Deployed as a **Docker** image on **Coolify**

## Features

- Calendar with month / week / day views, color-coded by booking type
- Bookings: flights, trains, buses, cruises, hotels, activities (type-specific fields)
- Per-trip filtering; trip date-range highlighting
- Costs page — totals + by-currency and by-type breakdowns (HKD-normalized)
- To-dos (per-trip or tripless)
- **AI parse** — upload a booking screenshot/PDF, an LLM extracts structured
  bookings that pre-fill the form for review (see [docs/ai-parsing.md](docs/ai-parsing.md))

## Local development

```bash
npm install
cp .env.example .env.local   # fill in AUTH_SECRET at minimum
npm run dev                  # http://localhost:3000
```

- With **no `DATABASE_URL`**, the app uses an embedded **PGlite** database under
  `.data/pglite` and auto-applies migrations — zero setup.
- With **no `AUTH_GOOGLE_ID`**, the login page shows a **dev sign-in** (any
  allowlisted email, no Google needed).
- `npm run build` / `npm run start` — production build; `npm run typecheck`,
  `npm run lint`.

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `AUTH_SECRET` | yes | Signs the JWT session cookie (`openssl rand -base64 32`) |
| `ALLOWED_EMAILS` | prod | Comma-separated sign-in allowlist (fails closed in prod if unset) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | prod | Google OAuth client |
| `AUTH_URL` | prod | Public `https://<domain>` (correct OAuth callbacks behind a proxy) |
| `DATABASE_URL` | prod | Postgres connection string; unset → PGlite dev DB |
| `POE_API_KEY` | for AI parse | Key for the `/api/parse-booking` route (Poe API) |
| `NEXT_PUBLIC_APP_VERSION` | no | Version shown in the sidebar (build-time inlined) |

All except `NEXT_PUBLIC_*` are runtime-only.

## Database & migrations

Schema lives in [`src/db/schema.ts`](src/db/schema.ts); generated SQL migrations in
`drizzle/`.

- `npm run db:generate` — generate a migration after changing the schema
- `npm run db:migrate` — apply migrations (drizzle-kit)
- At runtime, `dbReady()` ([`src/db/index.ts`](src/db/index.ts)) applies pending
  migrations once per process on first DB touch — so a fresh container
  self-migrates on boot; no separate migrate step is needed.

## Deployment (Coolify)

1. Add a **Postgres** database resource; copy its **internal** connection string.
2. Add an **Application** from this repo, **Dockerfile** build pack, port **3000**.
3. Set env vars (table above), with `DATABASE_URL` = the internal Postgres URL and
   `AUTH_URL` = your public domain.
4. Register the Google redirect URI: `https://<domain>/api/auth/callback/google`.
5. Deploy. The image is Next.js **standalone**; migrations run automatically on
   first request.

## Migrating data off Supabase

If you're moving an existing Supabase deployment over, see
[docs/supabase-to-coolify-migrate.md](docs/supabase-to-coolify-migrate.md) — a
reusable recipe using the `service_role` HTTPS APIs (`npm run migrate:supabase:rest`).

## Docs

- [Architecture](docs/architecture.md) — auth, data layer, project structure
- [AI parsing](docs/ai-parsing.md) — the `/api/parse-booking` flow
- [PWA & iOS safe areas](docs/pwa.md)
- [Supabase → Coolify data migration](docs/supabase-to-coolify-migrate.md)
