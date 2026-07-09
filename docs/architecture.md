# Architecture

A private travel-itinerary app: **Next.js 16 (App Router) + React 19 + TypeScript**,
**NextAuth v5**, **Drizzle ORM over Postgres**, deployed as a Docker image on
**Coolify**. It began as a Vite + Supabase SPA and was fully rewritten; this
document describes the current state.

## Authentication

NextAuth v5 (Auth.js), Google OAuth, JWT session strategy. Access is restricted to
an email allowlist.

- [`src/auth.config.ts`](../src/auth.config.ts) — edge-safe config (no DB): JWT
  strategy, `pages`, `authorized` + `session` callbacks (`token.sub → session.user.id`).
- [`src/auth.ts`](../src/auth.ts) — full instance: Drizzle adapter, Google provider
  (`allowDangerousEmailAccountLinking`), the `signIn` allowlist gate
  (`ALLOWED_EMAILS`, fails closed in prod), and a **dev credentials** provider that
  is active only when `AUTH_GOOGLE_ID` is unset (passwordless local sign-in).
- [`src/proxy.ts`](../src/proxy.ts) — Next 16 middleware; the edge auth gate.
  Unauthenticated requests to app routes redirect to `/login`.
- [`src/app/(app)/layout.tsx`](../src/app/(app)/layout.tsx) — second gate: server
  `auth()` check, then renders the client `AppShell`.
- [`src/app/login/page.tsx`](../src/app/login/page.tsx) — server component; Google
  (or dev) sign-in via Server Actions. Sign-out via
  [`src/actions/auth.ts`](../src/actions/auth.ts).

## Data layer

All database access is **server-side** via Server Actions; there is no
browser-direct DB access. What Supabase enforced with Row-Level Security is now
enforced in code.

- **Schema** — [`src/db/schema.ts`](../src/db/schema.ts). The four Auth.js tables
  (`users`, `accounts`, `sessions`, `verification_tokens`) plus the app tables.
  JS property names are intentionally **snake_case** to match the DB columns and
  the UI's field access (`booking.start_date`, `cost_amount`, …).
- **Connection** — [`src/db/index.ts`](../src/db/index.ts). node-postgres when
  `DATABASE_URL` is a `postgres://` URL; embedded **PGlite** otherwise (dev).
  `dbReady()` applies migrations once per process on first touch.
- **Server Actions** — [`src/actions/*.ts`](../src/actions) (`bookings`, `todos`,
  `dayNotes`, `auth`). Each mutation runs through
  [`runAction()`](../src/lib/action-utils.ts) (`requireUser()` + friendly errors).
- **Authorization** — [`src/lib/authz.ts`](../src/lib/authz.ts):
  `requireTripAccess(userId, tripId, roles)` and `accessibleTripIds(userId)`
  re-implement the old RLS rules (read = any member; write = owner|editor; trip
  delete / member management = owner; tripless todos & day-notes = any user).
- **Validation** — zod schemas in [`src/lib/schemas.ts`](../src/lib/schemas.ts).
- **Client hooks** — [`src/hooks/*`](../src/hooks) (`useBookings`, `useTodos`,
  `useDayNotes`) call the Server Actions directly and keep optimistic UI state.

> **Boundary gotcha:** a client component must import a `"use server"` action
> **directly** (or via a `"use client"` module) for the RSC boundary to cut. A
> directive-less shared module in between pulls the DB into the browser bundle.
> The client hooks therefore start with `"use client"`. Relatedly, the screen
> components live in [`src/screens/`](../src/screens), **not** `src/pages/` —
> `pages/` is reserved by Next for the legacy Pages Router, which breaks the
> server-action transform.

## Data model

| Table | Notes |
|---|---|
| `trips` | `id` (uuid), `name`, `start_date`, `end_date` (dates stored as TEXT) |
| `trip_members` | PK `(trip_id, user_id)`, `role` enum `owner\|editor\|viewer`; `user_id` → `users.id` (text) |
| `bookings` | `id` (text), `trip_id`, `type` enum (flight/train/bus/cruise/hotel/activity), `details` jsonb, `cost_amount`/`cost_share` numeric, `source` enum manual/parsed |
| `todos` | `trip_id` nullable (tripless allowed), `completed` |
| `day_notes` | `date`, `trip_id` nullable, `title` |

## Project structure

```
src/
├── app/
│   ├── layout.tsx              # root: fonts, ToastProvider, RegisterSW, metadata/viewport
│   ├── globals.css             # Tailwind v4 tokens + Material utilities
│   ├── manifest.ts             # PWA manifest (/manifest.webmanifest)
│   ├── login/page.tsx          # sign-in (server component)
│   ├── (app)/                  # authenticated route group
│   │   ├── layout.tsx          # auth gate → AppShell
│   │   ├── page.tsx            # Calendar
│   │   ├── todos/page.tsx
│   │   ├── costs/page.tsx
│   │   └── bookings/[type]/page.tsx
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       └── parse-booking/route.ts   # AI parse (nodejs, auth-guarded)
├── actions/                    # "use server" — bookings, todos, dayNotes, auth
├── auth.ts, auth.config.ts, proxy.ts
├── components/                 # AppShell, Sidebar, Header, calendar views, modals, Toast…
├── db/                         # schema.ts, index.ts
├── hooks/                      # useBookings, useTodos, useDayNotes ("use client")
├── lib/                        # action-utils, authz, schemas, parseBooking, currencies, calendar…
├── screens/                    # Calendar, Todos, Costs, BookingsByType (client screens)
└── types/next-auth.d.ts        # session.user.id augmentation
drizzle/                        # generated SQL migrations
scripts/                        # copy-pdf-worker, migrate-from-supabase(-rest)
Dockerfile                      # standalone runtime + drizzle/ for boot migrations
```

## Deployment

Docker (standalone) on Coolify — see the [README](../README.md#deployment-coolify).
Migrations apply automatically on first request (`dbReady`), and `drizzle/` is
copied into the runtime image.
