# Architecture

A private travel-itinerary app: **Next.js 16 (App Router) + React 19 + TypeScript**,
**NextAuth v5**, **Drizzle ORM over Postgres**, deployed on **Vercel** with a
**Neon** (serverless Postgres) database and **Cloudflare** DNS
(`itinerary.pondlab.app`). It began as a Vite + Supabase SPA and was fully
rewritten; this document describes the current state.

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

## Trip selection (multi-select, client state)

One or more trips can be selected in the sidebar (checkbox rows; "All Trips"
clears). Selection is **pure client state** in
[`src/lib/trip-context.tsx`](../src/lib/trip-context.tsx)
(`selectedTrips`/`toggleTrip`, plus single-trip compat shims
`selectedTrip`/`tripMeta` that read as "All Trips" when 0 or 2+ are selected):

- Every `(app)` page fetches the **union** of the user's trips — the same
  payload the All Trips view always shipped, authorized by the `trip_members`
  JOIN — and the screens filter it by the selection. A toggle is one instant
  client render: no navigation, no refetch.
- Selection must NOT move into search params: Next 16's router serves stale
  RSC payloads on search-param-only navigations (vercel/next.js#88535,
  #92187), which shipped as a data-corrupting bug here twice. `?trip=` deep
  links only *seed* the initial selection (read during SSR); it then persists
  in localStorage and the URL is cleaned.
- Trip summaries carry their `members` (layout fetches
  `getTripsWithMembers`), so member pickers filter client-side too.
- A "Journey" timeline view for multi-trip spans (trip rails, collapsed gap
  runs, gap-day "extend trip" actions) exists but is dormant behind
  `JOURNEY_ENABLED` in [`src/screens/Calendar.jsx`](../src/screens/Calendar.jsx)
  — Month view with its day panel is the preferred default. Its shipped
  side-effects remain live: union queries and the accommodation "No stay"
  warning bounded by the whole selection span.

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
drizzle/                        # generated SQL migrations (shipped in the build for boot migrations)
scripts/                        # copy-pdf-worker
```

## Deployment

Vercel (Next.js build) with a Neon Postgres database; Cloudflare DNS points
`itinerary.pondlab.app` at the Vercel deployment — see the
[README](../README.md#deployment-vercel--neon). Migrations apply automatically on
first request (`dbReady`); `drizzle/` ships in the build so a cold serverless
instance self-migrates.
