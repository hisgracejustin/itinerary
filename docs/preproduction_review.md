# Pre-production Review — itinerary

**Date:** 2026-08-03 · **Target:** public deployment at `itinerary.pondlab.app` (Vercel `sin1` + Neon Postgres)
**Method:** five independent parallel review passes — security audit, feature inventory, bug hunt (with executed repros), dead-code & code-quality sweep, reliability & deploy-readiness — each over the full repo, findings cross-checked and deduplicated here. Build verification: `npm run build` exit 0, `tsc --noEmit` clean, `eslint` 0 errors / 3 warnings, `drizzle-kit check` clean.

---

> **Update — 2026-08-03, post-fix:** all nine **P0 blockers** and the **entire P1 list are fixed, verified and pushed** (✅ below), together with a follow-up timezone review whose findings were folded into the P1 batch (§7). Commits `97fee13`, `f2d065b`, `3cb949a`. Re-verified after the changes: `npm run lint` 0 errors / 3 pre-existing warnings, `tsc --noEmit` clean, `npm run build` exit 0, migrator skip-path exit 0, and the P0-1 guard confirmed firing at runtime (a `next start` with no `DATABASE_URL` returns 500 with `DATABASE_URL must be a postgres:// URL in production` instead of silently serving an empty PGlite), the day-note migration exercised against a database pre-seeded with the duplicate rows it outlaws, the security headers confirmed on a live response, and the CSP checked in a real browser across every route. **Remaining: P2/P3 backlog plus two documented residuals — the `postcss`/`sharp` advisories that need a `next` major, and no IP rate limit on the credentials callback.**

## Verdict: ~~NOT READY~~ → **P0 and P1 clear as of 2026-08-03**

*Original verdict (pre-fix) preserved below for context; every blocker it describes is now closed.*

The application core is genuinely well built. **Authorization is airtight**: all 24 server actions and 5 API routes check the session and derive trip scope from the stored row, read queries fold membership into an `innerJoin`, and the audit found **no IDOR and no unauthenticated write path**. The settlement math was executed against a multi-trip party scenario and **balances to exactly zero**. Migrations are fully in sync with the schema. There's a nightly Neon→R2 backup with restore drill, a thoughtfully engineered offline PWA sheet, and zero `TODO`/`any`/`console.log`/commented-out cruft in `src/`.

What's missing is the **operational layer** — the code that runs when things go wrong — plus a handful of real bugs and an abuse surface that matters once the app is on the public internet. The blocking list below is roughly **one day of work**.

### Blocking fixes (P0) — ✅ all fixed 2026-08-03

| # | Finding | Fix as implemented |
|---|---|---|
| ✅ P0-1 | Missing `DATABASE_URL` in prod silently falls back to ephemeral PGlite → **silent total data loss** | `src/db/index.ts` throws before the PGlite fallback when `NODE_ENV=production`, with a carve-out for `NEXT_PHASE=phase-production-build` so local/CI builds without a DB still pass. Runtime firing verified against a real `next start`. |
| ✅ P0-2 | Migrations run unlocked on the request path through the Neon pooler | New `scripts/migrate.mjs`: single `pg.Client` (not Pool — advisory locks are session-scoped), `pg_advisory_lock(727144907)` around drizzle's migrator, reads `DIRECT_DATABASE_URL` **with no fallback to `DATABASE_URL`**, skips cleanly when unset. Wired into `vercel.json` `buildCommand` + `npm run db:migrate:deploy`. `dbReady()` now no-ops for production postgres; PGlite dev still self-migrates. README/`.env.example` updated.<br><br>**Deploy-time caveat, accepted knowingly:** `buildCommand` means DDL commits at *build* time, and a build is not a promotion. Two mitigations: the no-fallback rule above, plus scoping `DIRECT_DATABASE_URL` to Vercel's **Production environment only** — so preview/branch builds skip migrating rather than running DDL against whatever database they can reach. Residual risk: a build that never gets promoted leaves the schema ahead of live code (safe for additive migrations, not for drops/renames — sequence those in their own deploy), and a Vercel rollback does not roll back the schema. |
| ✅ P0-3 | Client can **rewrite primary keys** via update schemas (`id` survives `.partial()`) | `bookingUpdateSchema` and `todoUpdateSchema` now `.omit({ id: true })` before `.partial()`; zod strips the now-unknown key. Brings them in line with `expenseUpdateSchema`/`dayReminderUpdateSchema`, which already did this. |
| ✅ P0-4 | **Open signup**: any Google account gets a full account (storage + paid-LLM access) | `signIn` callback in `src/auth.ts` admits Google only for an email that already has a `users` row (i.e. was invited to a trip by email) or matches `ADMIN_EMAILS` (bootstrap). PIN provider was already closed; dev provider is dev-only. Stale "open signup" comments corrected. |
| ✅ P0-5 | `/api/parse-booking` unmetered — paid Poe key drainable | `maxDuration = 60`; `content-length` precheck; `typeof` guards on `file`/`text` (closes the `undefined > N` bypass); 200k text cap; base64 cap now 4 MB (~3 MB source); `AbortSignal.timeout(45s)` → 504 with a real message; in-memory per-user budget of 20 parses/hour → 429. |
| ✅ P0-6 | No error boundaries — any render-time DB blip = dead white screen mid-trip | Added `src/app/(app)/error.tsx` (Try again / Go home / **Open offline sheet** — the useful fallback when the DB is down, surfaces `error.digest` as a ref), `src/app/global-error.tsx` (own `<html>/<body>`, inline styles), `src/app/not-found.tsx`. `/bookings/[type]` now `notFound()`s on an unknown type via `bookingTypeSchema.safeParse`. |
| ✅ P0-7 | `runAction` returns raw `err.message` **and logs nothing server-side** | New `src/lib/errors.ts` `AppError` — the only class whose message reaches the client verbatim. `authz.ts` + user-facing throws across `src/actions/*` converted. Anything else is `console.error`'d with an 8-char ref and returned as `Something went wrong (ref …)`, so Vercel logs and the user's toast share an identifier. |
| ✅ P0-8 | Upload limits (10 MB) exceed Vercel's ~4.5 MB body cap; body buffered before size check | `ATTACHMENT_MAX_SIZE = 4MB` + derived `ATTACHMENT_MAX_LABEL` (all copy now derives from the constant — there were three hardcoded "10MB" strings). `content-length` precheck before `formData()`; oversize now 413. Download response no longer copies the buffer and sets `Content-Length` from `size_bytes`. Client maps a bare 413 to a real sentence. |
| ✅ P0-9 | `pool.on('error')` missing — an idle-client error **crashes the Node process** | `pool.on("error", …)` handler plus `connectionTimeoutMillis: 5_000` so an unreachable Neon compute fails fast instead of hanging to the function timeout. |

**Deliberate deviations from the original recommendation:** (1) the **PDF** client-side cap stays at 10 MB — a PDF is never uploaded, only its extracted text, so the 4.5 MB body cap doesn't apply and lowering it would have been an unforced capability loss; images are 3 MB as specified. (2) `todos.ts` "Moved to-do missing from order" stays a plain `Error` — it's an invariant on our own client's payload, not something a user can act on, so it belongs in the logged-with-ref bucket.

### First-week fixes (P1) — ✅ all fixed 2026-08-03

| # | Finding | Where |
|---|---|---|
| ✅ P1-1 | Settlements not idempotent — a retry silently duplicates a payback (money data) | `src/actions/settle.ts:38-48` |
| ✅ P1-2 | Day-note upsert is check-then-insert with no unique `(trip_id, date)` constraint — concurrent edits duplicate rows | `src/actions/dayNotes.ts:17-46`, `schema.ts:232-247` |
| ✅ P1-3 | Flight-duration timezone math off by ~2 days on month/year boundaries (**verified by execution**) | `src/lib/airports.js:193-198` |
| ✅ P1-4 (partial) | `npm audit fix`: `@auth/core <=0.41.2` has a critical advisory chain (incl. email homoglyph bypass — this app keys identity on email equality with `allowDangerousEmailAccountLinking`); pin `next-auth` (currently `^` over a **beta**) | `package.json:24` |
| ✅ P1-5 | No security headers at all (CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`) | `next.config.ts`, `vercel.json` |
| ✅ P1-6 | PIN lockout is a read-modify-write race — parallel guesses never trip the 5-try lock; PINs generated with `Math.random()` | `src/auth.ts:45-62`, `Settings.jsx:403` |
| ✅ P1-7 | Four non-atomic multi-step writes — worst: `createTripAction` can leave an ownerless, undeletable, invisible trip | `bookings.ts:163-172`, `todos.ts:143-170`, `members.ts:275-289,35-64` |
| ✅ P1-8 | Offline-sheet purge on account switch can silently no-op yet be recorded as done — next user on the browser can read the previous user's itinerary offline | `src/components/SheetSync.tsx:59-60`, `Sidebar.jsx:236` |

**Manual pre-deploy checks:** Vercel project Node version is 24.x (`engines: >=24`, no pin); Neon project region matches `sin1`; `ADMIN_EMAILS` is set (read once at module scope — needs a **redeploy** to change, and unset means no one can perform admin actions); Vercel `AUTH_SECRET` is a fresh random value (local `.env.local` carries a known dev string).

---

## 1. Security

**Overall: authorization excellent; risk concentrated in abuse/cost surface and missing hardening.**

### High

**✅ S-H1. Open signup** (= P0-4) — **FIXED**. No `signIn` callback, no allowlist anywhere (`src/auth.ts:13-99`, `src/lib/authz.ts:13-16`). Any Google account gets a full account: self-granted trip ownership via `createTripAction`, 10 MB attachment uploads into billed Neon `bytea`, unbounded text rows, and paid Poe API access. Data stays correctly partitioned — this is a billing/abuse exposure, not confidentiality. **Fix:** a `signIn` callback admitting only emails in an allowlist or emails that already have a `users` row (matches the invite model).

**✅ S-H2. `/api/parse-booking` unmetered** (= P0-5) — **FIXED**. `src/app/api/parse-booking/route.ts:102-117` — body fully buffered before checks; `text` mode has **no length cap ever**; a non-string `file` makes the size check `undefined > N` = false; every accepted request hits `api.poe.com` with `POE_API_KEY`. No rate limit anywhere in the codebase. The route is deliberately excluded from middleware (`src/proxy.ts:15`) and self-guards with `auth()` — that's its only guard. **Fix:** `content-length` precheck, `typeof file !== "string" → 400`, cap `text` (~40 KB), per-user hourly counter, `AbortSignal.timeout` + `export const maxDuration`.

### Medium

- **S-M1. No security headers** (= P1-5). `next.config.ts` has no `headers()`; `vercel.json` is just `{"regions":["sin1"]}`. Framable auth'd pages → clickjacking against delete-trip/record-settlement; no CSP backstop; no `nosniff` behind S-M2. **Fix:** `headers()` block — `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, CSP with `frame-ancestors 'none'`.
- **S-M2. Attachments served inline with client-declared MIME, no `nosniff`** — `api/attachments/[id]/route.ts:52-62`; `mime_type` is uploader-controlled `file.type`, allowlist-checked (`src/lib/attachments.ts:9-30`) but never magic-byte sniffed; default disposition `inline`, same origin as the session cookie. Safe *today* only because the allowlist excludes `text/html`/`svg`. `DaySheet.jsx:482` also renders attachment bytes into an un-sandboxed `<iframe>`. **Fix:** `nosniff` + `Content-Security-Policy: sandbox` on the response; force `attachment` disposition except for `image/*` and PDF; `sandbox` the iframe.
- **S-M3. Vulnerable auth chain** (= P1-4). `npm audit --omit=dev`: `@auth/core <=0.41.2` critical (uncaught throw on malformed Bearer; **email homoglyph normalization bypass** — material here since identity is email string equality with `allowDangerousEmailAccountLinking`; OAuth state/nonce/PKCE cookies not provider-bound). Transitive highs in `postcss`/`sharp` via `next@16.2.11`. **Fix:** `npm audit fix`, pin `next-auth` exactly, bump Next patch.
- **S-M4. PIN hardening** (= P1-6). Non-atomic `failed_pin_attempts` increment (`src/auth.ts:55`) — bug-hunt pass independently confirmed parallel requests bypass the lockout; `Math.random()` PIN generation (`Settings.jsx:403`); no rate limit on the credentials callback → also an account-lockout DoS (5 requests/15 min locks a known email out); `scryptSync` blocks the event loop. **Fix:** atomic SQL increment + `RETURNING`, `crypto.getRandomValues`, IP limiter, async scrypt.
- **✅ S-M5. Upload buffers whole body before size check** (= P0-8) — **FIXED**. `api/attachments/route.ts:26,43` — `formData()` materializes everything first; a 1 GB POST OOMs before the 400. Also 10 MB app limit vs ~4.5 MB Vercel cap (see R-H3).

### Low (summary)

- **S-L1** Dev-login gate: verified compiled out of production builds; risk only in self-hosted `npm run dev` with `AUTH_GOOGLE_ID` unset. Harden with explicit `ENABLE_DEV_LOGIN=1` + `VERCEL_ENV` check (`src/auth.ts:11`).
- **S-L2** Latent IDOR in `getAssignableUsers(userId, tripId)` — no membership check on the non-null branch; currently only called with `null`, not exploitable (`src/lib/queries.ts:324-341`). Fix before anyone adds a second call site.
- **✅ S-L3** Raw error text to client (= P0-7) — **FIXED**; — `action-utils.ts:36`; `friendlyError` only rewrites Supabase-era patterns.
- **S-L4** No length caps on any user text field (`src/lib/schemas.ts`) — multi-MB rows writable into Neon.
- **S-L5** Custom POST routes lack explicit origin checks — mitigated by `SameSite=Lax`; add `Sec-Fetch-Site` checks (`attachments/route.ts:19`, `parse-booking/route.ts:96`).
- **S-L6** Unsolicited trip membership: owners can add any existing account by email, no invite/accept (`members.ts:30-67`); the old account-takeover chain via this is **confirmed fixed** (`requireAdmin` now gates identity writes). Related quality finding: `addTripMemberAction` still *creates* placeholder `users` rows gated only on self-granted trip ownership — combined with `allowDangerousEmailAccountLinking` a user can pre-create `victim@example.com` and the victim's first Google sign-in links to it (`members.ts:43-48`). Consider invite-and-accept.
- **S-L7** DELETE loads the full bytea to authorize (`attachments/[id]/route.ts:20-34,71`) — split the loader.
- **S-L8** `Content-Disposition` fallback doesn't escape backslashes (`attachments/[id]/route.ts:15`).
- **S-L9** Every member's scrypt hash loaded on Settings render just to compute has-PIN (`queries.ts:212,256-260`).
- **S-L10** Client-supplied primary keys on create (`bookings.ts:53`, `todos.ts:29`, `dayReminders.ts:32`) — inserts, so no overwrite, but duplicate-key errors form a cross-trip existence oracle. (The **update**-path variant is P0-3 and is serious.)
- **S-L11** Offline cache retains full itinerary + attachment bytes in the browser's Cache API after tab close (purged on sign-out/account-switch — but see P1-8 for when that purge silently fails).
- **S-L12** Local `.env`/`.env.local` (gitignored, never committed — verified) hold a weak dev `AUTH_SECRET` and stale Supabase keys; rotate prod secret, decommission old Supabase project, delete stale entries.

### Verified clean

No SQL injection (no `sql.raw`/`db.execute`; all `sql``` templates bind parameters). No XSS sinks (`dangerouslySetInnerHTML`/`innerHTML`/`eval` absent; `maps_url` scheme-restricted at every write; offline `document.write` replays script-stripped same-origin HTML). Middleware + page guard + action guard triple layer consistent. JWT sessions with working server-side revocation (`sessions_valid_after`). `itinerary.dump` is 0 bytes, gitignored, **never committed** (checked `git log --all`). Only `.env.example` tracked. Backup workflow handles secrets correctly. Prior review's critical account-takeover chain and Highs (non-atomic split writes, `maps_url` XSS, irrevocable JWTs) all confirmed fixed in current code.

---

## 2. Reliability & deploy readiness

### Critical

**✅ R-C1. Silent PGlite fallback** (= P0-1) — **FIXED**. `src/db/index.ts:19-40`: if `DATABASE_URL` is unset/misspelled/not `postgres*`-prefixed, production instances each boot a private empty PGlite on ephemeral storage. The app *works* — login succeeds, writes accept — and everything evaporates per cold start. No error, no log. **Fix:** throw at module scope when `NODE_ENV === "production"` and the URL isn't a postgres URL.

**✅ R-C2. Request-path migrations** (= P0-2) — **FIXED**. `src/db/index.ts:50-70`; README documents "migrations run automatically on first request". Drizzle's migrator takes **no advisory lock** (verified in `drizzle-orm/pg-core/dialect.js:44-71`) and the generated SQL isn't idempotent (`CREATE TABLE`/`ADD COLUMN` without `IF NOT EXISTS`). N cold instances after a schema deploy race the same migration; losers 500, and `dbReady()`'s memo-clear-on-failure retries forever, sustaining the storm. README also points `DATABASE_URL` at the **pooled** PgBouncer host — wrong place for DDL. **Fix:** run `drizzle-kit migrate` as a deploy step against a `DIRECT_DATABASE_URL`; make `dbReady()` a prod no-op; interim: wrap in `pg_advisory_lock`.

### High

- **✅ R-H1. No error boundaries** (= P0-6) — **FIXED**. Zero `error.tsx`/`global-error.tsx`/`not-found.tsx` under `src/app`; every page is `force-dynamic` and queries the DB during render — a transient Neon blip is a stock white error page with no way back. Also `/bookings/[type]` passes unknown types through unvalidated (empty list instead of 404). **Fix:** three small files; the `(app)/error.tsx` should link to `/sheet` (the offline copy — a genuinely useful fallback here).
- **✅ R-H2/H4. Raw errors out, nothing logged** (= P0-7) — **FIXED**. `runAction` catches, stringifies, returns 200 — Vercel logs record success; the only incident evidence is a toast screenshot. Server codebase has 9 console calls total, no `instrumentation.ts`. **Fix:** log with a short correlation id in `runAction`, return the id in a generic message; add `instrumentation.ts` `onRequestError`; add `pool.on('error')` (P0-9).
- **✅ R-H3. Upload limits vs platform** (= P0-8) — **FIXED**. 10 MB app limits vs Vercel's ~4.5 MB body cap: 5–10 MB uploads die at the platform as opaque 413s the client renders as `Upload failed (413)`. Parse route worse: base64 inflation makes the real ceiling ~3.4 MB while the client promises 10 MB. Downloads fully buffer and copy (`new Uint8Array(body)` — drop the copy). **Fix:** 4 MB / 3 MB constants + copy changes, `content-length` prechecks, or move to direct-to-blob (contradicts the bytea decision — decide explicitly).
- **R-H5. Settlement duplication on retry** (= P1-1). Bare INSERT, server-generated UUID, no idempotency key (`settle.ts:38-48`); `disabled={busy}` stops double-clicks but not lost-response retries. Duplicated paybacks silently shift every balance. **Fix:** client-generated id (pattern already used by bookings/todos) + `onConflictDoNothing`.
- **R-H6. Day-note duplicate race** (= P1-2). SELECT-then-INSERT with no unique constraint on `(trip_id, date)`; two members (or two devices) editing the same day both insert; UI flips randomly between rows. Recent history is three consecutive day-note fixes — live territory. **Fix:** unique index + `ON CONFLICT DO UPDATE`; simplifies the action.

### Medium

- **R-M1.** DB client constructed at module import (`db/index.ts:42`) — source of the benign-looking `PGlite failed to initialize` build noise that would also mask a real import failure; malformed prod URL throws opaquely at module load. Lazy getter or the R-C1 guard.
- **R-M2.** Four non-atomic multi-step writes (= P1-7): `createTripAction` (ownerless invisible trip — `scripts/list-tripless.mjs`'s existence suggests orphans already happened), `moveTodoAction`, `createPartyAction`, `addTripMemberAction` (self-healing). All fit the existing `transaction()` helper.
- **✅ R-M3.** (= P0-5) — **FIXED**. `/api/parse-booking` had no `maxDuration`, no upstream `AbortSignal` (pattern exists in `fx.ts:109`, just not applied), unbounded `text` (= P0-5). Otherwise the best-error-handled file in the repo.
- **R-M4.** Last-write-wins everywhere; no `updated_at`/version columns. Split rewrites are DELETE+INSERT in a transaction, but under `READ COMMITTED` two concurrent split edits can interleave to one editor's splits wholesale — silently changes who owes what. **Fix:** `updated_at` optimistic concurrency; `SELECT … FOR UPDATE` on the parent row for splits.
- **R-M5.** `auth()` does a `users` lookup per call (revocation check) and is called ≥2× per page load — cache the cutoff per-request with `React.cache()`.
- **R-M6.** Misleading `deleteTripAction` docstring (three passes flagged this independently): comment says trip deletion "nulls trip_id on todos/notes/reminders"; schema says `NOT NULL` + `onDelete: "cascade"` — **deletion destroys them**, and the Settings confirm dialog (`Settings.jsx:726-732`) doesn't say so. Fix comment + dialog copy (or change the FK if nulling was the intent).
- **R-M7.** `engines: >=24` with no pin — verify the Vercel project Node setting before first deploy.

### Low / Info

Missing indexes on queried user-FKs (`bookings.paid_by`, `expenses.paid_by`, `settlements.from_user/to_user`, split `user_id`s) — `userFootprint()` fires 8 parallel seq-scan probes per member-delete; fine now, add before growth. `getSettleData` fetches everything across all trips unbounded (known ceiling of the deliberate client-side-filter architecture). `next.config.ts` git-sha fallback always fails on Vercel (no `.git`) → sidebar shows `dev` in prod; use `VERCEL_GIT_COMMIT_SHA`. No CI workflow (only `db-backup.yml` — which is itself well built). No env fails fast at boot — a 10-line zod `env.ts` fixes the two worst. Pool lacks `connectionTimeoutMillis`. Stale root `.env` with Supabase leftovers — delete.

---

## 3. Bugs (correctness)

### High

**B-1. Flight-duration timezone math** (= P1-3). `src/lib/airports.js:193-198` — the day-rollover correction compares day/month digits instead of full dates. **Executed repros:** SFO→JFK on Oct 1 returns 3210 min instead of 330; LAX→JFK Jan 1 returns 3180 instead of 300; HKG→NRT Dec 31 23:00 returns null. Poisons per-flight durations and the `/bookings/flight` "Flying time" stat (which also derives layover time from it). **Fix:** compute the offset via `Date.UTC` on both full probe and input dates.

### Medium

- **B-2. SSR hydration mismatches from `new Date()` in render** — 10+ sites (`Costs.jsx:57,290`, `BookingCard.jsx:378`, `MonthView.jsx:172`, `MobileMonthView.jsx:24,165,220`, `JourneyView.jsx:71`, `WeekView.jsx:9`, `Calendar.jsx:102,236`). Server-UTC vs user-local "today" diverge nightly (00:00–08:00 for UTC+8 users): wrong Today cell in server HTML, refund tier can differ server/client. `Costs.jsx:57` (`useState(localNow)` → `datetime-local` value) mismatches on **every** load. `sheet/page.tsx` already demonstrates the fix (server passes `today` as a prop, with a comment saying why) — apply the same pattern.
- **B-3. Hotel night count inconsistency** — full `BookingCard` diffs raw timestamps (`:221-225`) while the compact card and `bookingStats.nightsBetween` normalize to midnight: 22:00 check-in → 09:00 check-out shows "1 night" on one surface, "2" on the others.
- **B-4. Trip selection never re-validated against a changed trip list** — `AppShell.tsx:37-40,58-69,114`: removed-from-trip users keep a stale selected id → blank screens, `BookingModal` prefills the lost trip, saves fail `Forbidden`, and the stale id re-persists to localStorage. Derive selection at render from `stored ∩ trips`.
- **B-5. To-do assignee picker offers cross-trip members the server always rejects** — `Todos.jsx:64-70` uses the union roster; `requireAssignable` (`authz.ts:68-77`) enforces the row's own trip → optimistic flip then revert + error toast. Scope the picker to `todo.trip_id`'s roster.
- **B-6. Offline purge recorded-but-skipped** (= P1-8) — `SheetSync.tsx:59-60`: purge message is fire-and-forget and conditional on a controlling SW; `OWNER_KEY` written unconditionally → purge never retried; second account on the browser can read the first's itinerary offline. Also a race where the post-switch gap-fill loop sees the old user's cache entries as hits, then the delete wipes them → zero offline attachments. Purge via `caches.delete()` from the page, then write `OWNER_KEY`. Same issue in the sign-out path (`Sidebar.jsx:236`).
- **B-7. Settle "mark paid" prefill destroyed by the required trip picker** — `Settle.jsx:286-294,725`: under multi-trip selection `trip_id` prefills empty, and choosing a trip clears `from_user`/`to_user`. Carry the transfer's trip on the transfer object.
- **B-8. PIN lockout race** — same as S-M4; independently confirmed.
- **✅ B-9. Upload OOM window** — **FIXED**; same as S-M5/R-H3.

### Low

- **B-10** Double-submit duplicates todos (`Todos.jsx:199-214,298` — `isPending` exposed but unused).
- **B-11** Trip filter chips render from the full trip list under partial selection → clicking an excluded trip empties the board (`Todos.jsx:109,351-364`).
- **B-12** New-todo trip `useState(selectedTrip)` never syncs with later sidebar changes (`Todos.jsx:77`).
- **B-13** Failed multi-file upload skips `load()` → already-committed files invisible → user re-uploads duplicates (`AttachmentsSection.jsx:82-84`; move `load()` to `finally`).
- **B-14** = R-M6 (trip-delete comment).
- **B-15** Layover merge: mixed-currency legs write `cost_currency` with `cost_amount: null`; last leg's flight number never stored; legs assumed pre-sorted chronologically (`BookingModal.jsx:39-52`).
- **B-16** Settle recomputes the full balance graph every render — `useMemo` deps are fresh `.filter()` arrays (`Settle.jsx:63-81`). Perf only.
- **B-17** Sheet manifest pre-caches the 40 *earliest-uploaded* attachments, not the soonest-needed — tomorrow's boarding pass is the one dropped at 50 files (`api/sheet-manifest/route.ts:27-30`, `queries.ts:453`).
- **B-18** = S-L7 (DELETE loads blob).
- **B-19** AI-parsed `layovers[].arrival/departure` bypass the `wall()` date normalization — a bare `YYYY-MM-DD` from the model renders a day early west of Greenwich (verified: `new Date("2026-09-07")` in LA → Sep 6) (`BookingModal.jsx:29-34`).

### Verified correct (executed, no action)

Settlement math balances to exactly zero across a two-trip party scenario with extras-bearing splits; simplified and pairwise transfers agree; member-set keying across differing rosters works. Attachment authorization on every byte path. FX refresh handles unsupported symbols gracefully (live-tested against Frankfurter). Cancellation-policy math is deliberately lexicographic-string-based and correct.

---

## 4. Dead code & code quality

### The headline gap: 73% of `src/` is not type-checked

`tsconfig.json` has `allowJs: true` but no `checkJs`, and `include` covers only `*.ts(x)`. **5,084 lines checked; 13,791 lines of `.js`/`.jsx` — every screen, every component, `split.js`, `calendar.js` — parsed but never checked.** The green `npm run typecheck` says nothing about the UI layer. Either document this as accepted or ratchet with `checkJs` + per-file `@ts-nocheck` removal.

### Confirmed dead (verified zero references) — delete

- `src/components/TripAgenda.jsx` (113 lines) and `src/components/Spinner.jsx` (23 lines)
- `getTripForUser` (`queries.ts:94`); `deleteDayNote` + `setMemberParty` (`client-actions.js:50,73`)
- 18 unused Drizzle inferred types (`schema.ts:481-500`) — or keep the full `$infer` set deliberately with a comment
- Unreachable tripless branches (three passes converged on these): `dayNotes.ts:19` `isNull` arm, `dayReminders.ts:22-24` arm, `.filter(Boolean)` casts at `todos.ts:138`/`dayReminders.ts:89` — `trip_id` is `NOT NULL` everywhere now. Related latent bug: `useTodoList.js:63` sends `trip_id ?? null`, which zod would reject after the optimistic row renders.
- `tsx` devDependency (nothing uses it); `scripts/list-tripless.mjs` (its migration is done)
- The hard-disabled full-page Journey view (`Calendar.jsx:87` `JOURNEY_ENABLED = false` + its dead branch/props threading) — delete or ticket it

**Not dead (false-positive guard):** all `*Relations`/`pgEnum` exports in `schema.ts` feed `db.query.*`; `react-dom` is a required peer. Keep.

### Repo hygiene

- Root files already handled: `itinerary.dump` (0 bytes — `rm` it), `itinerary-pdf-example.pdf`, `tsconfig.tsbuildinfo` are all gitignored and untracked; `.env*` untracked except `.env.example`. Verified.
- **`scripts/` tracked/untracked split is arbitrary**: `seed-note-overlap.mjs` is committed while its five identical-in-kind siblings are untracked. Recommendation: commit all six under `scripts/seed/` (they encode repro fixtures for shipped bug fixes) — after fixing **`seed-layover-test.mjs:3`, which hardcodes a dead absolute scratchpad path and is currently unrunnable**. Keep `copy-pdf-worker.mjs` (build-critical) and `ui-test-day-notes.mjs` (the repo's only executable regression test — consider a `test:ui` npm script).
- `.gitignore`: add `.claude/` (currently only covered by machine-local `.git/info/exclude`); optionally `*.pem`, `.vercel/`, `coverage/`.
- `docs/architecture.md` documents hooks and helpers that no longer exist; `docs/code-review.md` (2026-07-24) lists 9 findings with no per-item resolution markers — most verified fixed by this review, but do an explicit sign-off pass.
- No test script; the settlement math — the highest-risk logic — has no automated coverage (it was verified by execution *in this review*, but that's not a regression net).

### Quality findings

- **✅ Q-1 (= P0-3) — FIXED:** update schemas leak `id` → client PK rewrite; `expenseUpdateSchema`/`dayReminderUpdateSchema` already do it right.
- **Q-2:** `addTripMemberAction` identity-row creation gated on self-granted ownership (see S-L6).
- **Q-3:** 11 actions take raw unvalidated `id: string` while two peers `.uuid().parse()` it — contained (row-load + authz follows) but inconsistent.
- **Q-4:** 11 of 12 `members.ts` actions define zod schemas inline instead of `lib/schemas.ts`; `recordSettlementAction` hand-rolls the membership check `requireTripMembers` provides.
- **Oversized files:** `Settle.jsx` 1336, `MobileMonthView.jsx` 1099, `Settings.jsx` 1047, `BookingForm.jsx` 844, `Todos.jsx` 767, `Costs.jsx` 704, `members.ts` 699 (+5 more >500).
- **Duplication, ranked by payoff:**
  1. `toLocalDateStr` reimplemented 6× + `midnight()` inlined ~81× with "matches MobileMonthView" comments — a live correctness hazard (any one copy drifting splits day-notes). Export both from `lib/calendar.js` first; everything else builds on it.
  2. `AgendaItem` (`MobileMonthView.jsx:922-1099`) is a fork of `BookingCard` that has **already drifted** (regex at `:984` vs `BookingCard.jsx:433`). Collapse to a `compact` prop; ~180 lines out.
  3. Seven near-identical mid-stay chip subtrees across three files → `stayProgress()` + one chip component (~180→40 lines).
  4. `parseDetails` implemented 7× despite `bookingStats.js:15` exporting it; `TYPE_LABELS` in 4 divergent copies (adding a booking type touches 6 files); money formatting bypasses `formatCurrency` in 13 places; `sortBookingsForDay` duplicated verbatim while two other views use a different sort; day-note editor JSX (the code path behind three recent Safari fixes) hand-written 3×; plus mechanical extractions (`useBookingModal`, `revalidateApp`, `requireRowTripAccess` covering 11 sites, split-replace helper, reorder-CASE helper).
- **Clean sweep results:** zero `TODO`/`FIXME`/`HACK`, zero `@ts-ignore`, zero `any` in the TS layer, zero `console.log`, zero commented-out code; all 12 `eslint-disable`s carry reasons; all 35 actions share `runAction` + uniform `revalidatePath`; migrations verified in sync with schema two independent ways. Lint's 3 warnings are benign (2 `exhaustive-deps`, 1 justified `no-img-element`).

---

## 5. Feature inventory (context for the findings)

A private, invite-only travel-itinerary PWA for a small circle of friends/family. Trips with per-trip rosters (`owner`/`editor`/`viewer`); bookings (7 types) on month/week/day calendar views, created by hand or by LLM-parsing an uploaded screenshot/PDF (PDF text extracted **client-side** via pdfjs; only text/base64 goes to the server → Poe `claude-haiku-4.5`); attachments in Postgres bytea; costs with per-currency totals and cancellation/refund exposure modeling; per-person splitting with couples-as-one-unit settlement (`src/lib/split.js`, per-currency exact, FX display-only by design); kanban todos; per-day notes/reminders; and an offline "day sheet" (`/sheet` + service worker) that keeps the itinerary and up to 40 upcoming attachments readable with the radio off — the actual usage mode is multi-leg journeys split across 2–3 trips, browsed on a phone mid-travel.

**Data model** (`src/db/schema.ts`, 500 lines): Auth.js tables (JWT strategy; `sessions`/`verification_tokens` structurally present but unused) + `trips`, `trip_members` (the entire authorization surface), `bookings` (typed `details` jsonb incl. layovers/cancellation tiers), `booking_attachments` (bytea), `todos`, `day_notes`/`day_reminders`, `trip_parties`, `booking_splits`/`expenses`/`expense_splits`, `settlements` (note: **no `ON DELETE` on its FKs**, unlike everything else — guarded by `deleteUserAction` refusing non-empty rows), `fx_rates`. Dates are naive text strings compared lexicographically — a deliberate timezone-stability convention. Money is `numeric`.

**Routes:** `/` calendar, `/bookings/[type]`, `/costs`, `/settle`, `/todos`, `/settings`, `/sheet` (outside the app shell, self-contained for offline), `/login`; APIs: `POST /api/attachments`, `GET|DELETE /api/attachments/[id]`, `POST /api/parse-booking`, `GET /api/sheet-manifest`, NextAuth. Edge middleware (`src/proxy.ts`) gates everything except auth, parse-booking (self-guarded), login, and static assets. Trip selection is deliberately pure client state (Next 16 searchParam-staleness workaround); every page fetches the union of accessible trips and filters locally.

**Auth:** NextAuth v5 — Google (`allowDangerousEmailAccountLinking` so placeholder invitees claim their row), email+PIN credentials (scrypt, 5-failure/15-min lockout), and a dev provider verified compiled out of production builds. Open signup by design (see P0-4); real access is entirely per-trip membership. JWT revocation via `sessions_valid_after`.

**Half-built / stale (from the inventory pass):** disabled Journey view; tripless-concept leftovers; wrong trip-delete docstring; dead `TripAgenda`/`Spinner`; outdated `docs/architecture.md`; unresolved-marker `docs/code-review.md`; missing `/settings` `loading.tsx`; single-model AI dependency with no retry/fallback/timeout.

---

## 6. Consolidated punch list

**P0 — before public deploy: ✅ COMPLETE (2026-08-03).** All nine items in the table at the top are implemented and verified (lint/typecheck/build green; runtime guard and migrator skip-path exercised directly). Not yet committed at time of writing.

**P1 — first week:** settlement idempotency; day-note unique constraint; `airports.js` timezone fix; `npm audit fix` + pin `next-auth`; security headers; PIN atomic increment + CSPRNG + credentials rate limit; four missing transactions; offline purge ordering.

**P2 — first month:** hydration-date props (B-2, worst: Costs as-of picker); stale trip-selection derivation (B-4); todo assignee scoping (B-5); settle prefill (B-7); attachment `nosniff`/sandbox/disposition (S-M2); user-FK indexes; `updated_at` optimistic concurrency; env-var zod fail-fast; CI workflow (lint/typecheck/build on push); text-field length caps; `VERCEL_GIT_COMMIT_SHA` version fallback; error-ref correlation ids surfaced in toasts.

**P3 — hygiene & refactor backlog:** delete confirmed-dead code; fix + commit the seed scripts under `scripts/seed/`; `.gitignore` additions; decide the `checkJs` ratchet; `toLocalDateStr`/`midnight` extraction (do first — correctness hazard); `AgendaItem`→`BookingCard(compact)`; stay-chip extraction; `TYPE_LABELS`/`parseDetails`/money-format consolidation; update `docs/architecture.md`; resolution markers on `docs/code-review.md`; a settlement-math test file (the math is right today — keep it that way).

---

*Full per-pass reports (security, features, bugs, dead-code/quality, reliability) were generated by five independent Opus 5 review agents on 2026-08-03; this document is the deduplicated collation. Where passes disagreed on severity, the higher rating with the concrete failure scenario won. Findings marked "verified by execution" were reproduced with running code, not inferred from reading.*
---

## 7. Timezone review (added 2026-08-03)

Prompted by a direct question: *if I fly from Hong Kong to Canada, does anything change about what I see?* Three independent passes — storage round-trip, "now"/"today" derivation, and flight/airport handling.

### The good news: stored times are timezone-immune, and that is by design

A booking that reads "14:30" in Hong Kong reads "14:30" in Vancouver. Verified end to end:

- **Write** — `BookingForm`'s `wall()` helper passes the `datetime-local` value through verbatim and appends `T00:00:00` to date-only values; no `toISOString()`, no `Date.parse`, no UTC conversion anywhere on the path to the DB. The comment there names the reason: `toISOString()` "would bake in the entering device's offset".
- **Storage** — `bookings.start_date`/`end_date`, trip dates, todo due dates, day-note dates, reminder times and expense dates are all `text`. The only `timestamptz` columns that reach a UI (`fx.fetched_at`, the sheet's `generatedAt`) are genuine instants, where shifting with the viewer is correct.
- **Read** — `queries.ts` never transforms a date column.
- **Render** — every formatter parses a naive string (which JS reads as local) and formats with no `timeZone` option (which renders local). Both halves move together, so the digits are invariant. There are **zero** `timeZone:` options in any render path; the only one in the codebase uses the *airport's* zone for flight math.

Four separate view files independently build local `YYYY-MM-DD` day keys with comments citing the UTC off-by-one they are avoiding. This discipline is real and should be preserved.

### What actually changed with the viewer — and why Canada specifically

Vercel runs in UTC. Hong Kong is *ahead* of UTC; Vancouver is *behind* it. So every place that trusted a UTC "today" was **generous** in Hong Kong and **premature** in Vancouver. Flying doesn't create these bugs — it flips their sign from invisible to breaking.

| Finding | Effect | Status |
|---|---|---|
| Offline sheet's `today` computed as a UTC date server-side; `DaySheet` selects trips with `end_date >= today` | On the evening of a trip's last day in Vancouver, the trip you are standing in deselects itself and the offline sheet — opened with the radio off — reads "No trips selected". The `localStorage` fallback only exists if the user previously opened the trip picker. | ✅ Fixed — one day of slack; over-including a just-ended trip beats an empty screen, and max real-world skew is ~26h |
| `sheet-manifest` filtered upcoming attachments against the same UTC today | In that same Vancouver evening window, attachments on a booking ending *today* were excluded from the offline pre-cache — the traveler's hotel voucher. Bounded: nothing evicts, so it only bit a device whose *first* sync fell in that window. | ✅ Fixed — same slack; the comment claiming it followed the app's local-date convention was simply wrong |
| Cancellation tiers evaluated against the *viewer's* device clock | Landing in Vancouver rolled "now" back ~15h and could resurrect a refund tier that had already lapsed. This contradicted the invariant `cancellation.js` states in its own header. | ✅ Fixed — see below |
| SSR renders "today" on a UTC server, client corrects on hydration | First-paint flash on the wrong day for ~8h/day in each city, plus a console hydration error. Self-healing. | ✅ Partly — the `/costs` as-of input no longer mismatches; the calendar flash remains (P2) |

### The design decision: a cutoff belongs to the provider

Confirmed by the owner: **a Kyoto hotel's 18:00 deadline belongs to Kyoto, not to whichever airport the viewer is standing in.**

Implemented as an architecture rather than a patch. The as-of now travels as an **instant**, and each booking converts it to its own provider's wall clock at comparison time:

1. A **flight** resolves to its departure airport's zone (you cancel a flight where it leaves from).
2. **Anything else** resolves to the trip's destination — the arrival airport of that trip's earliest flight.
3. With **neither**, it falls back to device-local, exactly the old behaviour — so trips with no flights or unrecognized airport codes are never worse off than before.

The `daysUntilCutoff` countdown ("in 3 days") deliberately stays reader-local — it is a display convenience, and the asymmetry is now documented at both the module and the call site. **Caveat:** step 2 is inference. A multi-country trip could resolve a few hours off, which is a rounding error against the ~16h device error it replaces, but it is a heuristic and not ground truth. Storing a per-trip or per-booking timezone would make it exact.

### The flight-duration bug was worse than first reported

`localToUTC` in `airports.js` had **two** independent defects, not one:

1. **Month/year boundary sign inversion** — the day-rollover correction compared day-of-month and month-of-year *integers*, which invert against chronological order at a boundary, so the correction took the wrong sign: a 2-day (2880 min) error.
2. **Wrong-instant DST probe** — the offset was sampled at an instant off by exactly the offset, so DST transitions landed an hour out.

Brute-forced across 2026: **393 boundary errors + 72 DST errors over 10 airports — ~0.53% of wall-clock hours, so roughly 1% of flights** (two ends each). Concrete: SFO→JFK departing Oct 1 reported **53h 30m** instead of 5h 30m; HKG→NRT across New Year returned **null** and the flight silently vanished from the totals.

The blast radius was made worse by the reporting around it. An inflated duration did **not** set the `approx` flag — both airports were in the table, the arithmetic was simply wrong — so `/bookings/flight` displayed a confidently wrong "Flying time" with no `~` marker, while the other stats on the same strip stayed correct. A nulled duration produced the hint *"1 booking missing an arrival time"*, which is false: the booking had both times and the conversion failed, sending the user to check data that was already right.

✅ Fixed with two-pass offset resolution that never compares date digits. Verified by execution: all five named cases correct, plus a sweep of **87,840 cases** (every wall-clock hour of 2026 across ten zones) with zero failures. `bookingStats.js` now distinguishes "a time is missing" from "a duration couldn't be computed" and signals the latter honestly.

### Also fixed

AI-parsed `details.layovers[].arrival`/`.departure` bypassed all date normalization — the parse route normalized costs, policies and notes but never date fields, so a hallucinated trailing `Z` persisted verbatim and rendered in the viewer's zone. **This was the one value in the entire app that genuinely shifted when you flew.** Now normalized server-side at parse time and defensively at merge time.

### Known and deliberately not changed

- **Flight times are never labeled with a timezone.** `HKG 11:00 PM → YVR 7:00 PM` on the same date is genuinely ambiguous to a reader; the tiny "11h" duration is the only clue a date line was crossed. `getAirportTimezone` already exists and is already imported at both surfaces, so this is a UI decision, not a data problem. **Recommended P2.**
- **Layover durations use naive subtraction, correctly** — both stamps are at the same airport so the offsets cancel, and the code says so. Only breaks for a connection straddling a DST change.
- **`transitStats` has no timezone awareness** for trains/buses — right for domestic rail, silently wrong for a Eurostar, unflagged.
- **Calendar "today" is device-local**, which is correct: flying the Pacific westbound, you genuinely re-live the day.
