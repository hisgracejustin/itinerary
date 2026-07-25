# Itinerary — Adversarial Code Review

**Date:** 2026-07-24
**Scope:** Full codebase — server actions, authorization, database schema/queries, settlement & currency math, calendar/journey UI, bookings/attachments/PDF-parse pipeline, auth/shell/PWA/infra, todos/members/settings.
**Method:** Seven parallel area reviews; each finding below was traced to the actual code path. Headline findings were independently re-verified against source. Findings reported by more than one reviewer are marked **[corroborated]** — treat those as high-confidence.

Line references use `path:line` at the time of review; they may drift as the code changes.

---

## Executive summary

The app is generally well-constructed: the load-then-authorize pattern on mutations is applied consistently, per-trip access control is real and layered (middleware → page guard → action guard), money is stored as Postgres `numeric` (not float), the core per-item share arithmetic is zero-sum and correct, and FX approximations are correctly kept out of settlement math. Most of what follows is about **edge cases, concurrency, and a small number of genuine security holes** rather than broken fundamentals.

That said, there is **one critical, exploitable account-takeover cluster** that should be fixed before anything else, and several correctness bugs that bite in exactly the multi-trip, timezone-crossing journey workflow this app is built around: cross-trip debt hiding, member-removal balance corruption, and booking times that shift days when the viewer changes timezone.

### Priority fix order

1. **Account takeover via member management** (Critical) — `setMemberPinAction` / `updateMemberProfileAction` let any trip owner seize an existing user's global account.
2. **Cross-trip debt hiding** (High) — union-find over-merges partied members across trips, netting real debts to zero in the journey view.
3. **Member removal corrupts balances** (High) — deleting split rows silently redistributes shares and can direct payment to a departed member.
4. **`dbReady()` bricks a serverless instance on one failed migration** (High).
5. **Non-atomic split writes can destroy allocations** (High, corroborated ×3).
6. **`maps_url` `javascript:` XSS** (High) — unvalidated URL rendered as an anchor href, reachable via the parse pipeline.
7. **JWT sessions are irrevocable for 30 days** (High, corroborated ×3).
8. **Booking times stored as UTC instants** (High) — days shift with the viewer's timezone; wrong for an app used while crossing timezones.
9. **Month navigation skips months on day-31 overflow** (High) — a whole month becomes unreachable from the phone.
10. Everything else (validation gaps, missing transactions, perf, PWA/infra) as capacity allows.

---

## CRITICAL

### C1. Any signed-in user can take over any existing account via forced roster add + PIN/email edit **[corroborated]**

- **Files:** `src/actions/members.ts:30-67` (`addTripMemberAction`), `:402-418` (`setMemberPinAction`), `:323-389` (`updateMemberProfileAction`); `src/auth.ts:41-72` (PIN credentials provider); `src/actions/bookings.ts:151-167` (`createTripAction` auto-owner).
- **Verified:** Yes — full chain read end-to-end.
- **Issue:** Person-level mutations (`setMemberPinAction`, `updateMemberProfileAction`, `setMemberAvatarAction`) are gated only by "caller is owner of *some* trip the target is a member of." Membership is exactly what an attacker can manufacture: anyone can sign up (open signup), `createTripAction` makes them owner, and `addTripMemberAction` adds **any email — including an existing user's — to that trip with no invite or consent**, resolving to the existing `users.id`. The PIN provider in `auth.ts` authenticates against `users.password_hash` and returns the full user, so the session `sub` becomes the victim's id.
- **Exploit chain:**
  1. Attacker signs up, calls `createTripAction` → becomes owner of trip X.
  2. `addTripMemberAction({ trip_id: X, email: "victim@x.com" })` → victim's **existing** user row is added to X (`found.id` reused, members.ts:35-48).
  3. `setMemberPinAction({ trip_id: X, user_id: victim, pin: "123456" })` → passes `requireTripAccess` (attacker owns X) + `requireTripMembers` (victim now a member) → writes `password_hash` onto the victim's row.
  4. Attacker signs in via the `pin` provider with the victim's email + chosen PIN → session as victim → **full read/write on every trip the victim belongs to.**
- **Alternate chain (email):** `updateMemberProfileAction` sets the victim's email to an attacker-controlled address and **deletes all their `accounts` rows**; with Google `allowDangerousEmailAccountLinking: true` (auth.ts:29), the attacker's next Google sign-in links onto the victim's `users.id`. Permanent takeover; the victim's original Google login now creates a fresh empty account.
- **Fix:** Restrict person-level field edits (email, `password_hash`) to **managed/placeholder accounts only** — e.g. require the target has no `accounts` rows and no password_hash set by another owner, or that the caller created the row. Adding an *existing* account to a trip must require an accepted invite, not a unilateral insert. Never silently delete a member's auth identities from a trip-scoped owner action.

---

## HIGH

### H1. Cross-trip union-find over-merges units, hiding real debts in the multi-trip journey view

- **Files:** `src/lib/split.js:260-334` (unit aggregation / union-find), `src/screens/Settle.jsx:129-134`.
- **Verified:** Yes — read the union-find; units are keyed by user id globally, unioned by shared `party_id`, and applied across all selected trips.
- **Issue:** Union-find unions any two users who share a party in **any** selected trip, and the resulting unit is global. Different-roster journeys are the documented primary usage: a couple partied in trip A but deliberately solo in trip B collapses into one unit for **all** items, so trip B's debts between them net to zero.
- **Failure scenario:** Journey = trips A+B. J & K partied in A, both solo in B. In B, K pays a ¥30,000 dinner split J/K → J owes K ¥15,000. Trip-B-only view: "J pays K ¥15,000." Whole-journey view: J,K unioned via A's party → net 0 → **the ¥15,000 debt disappears with no trace.** Worse, the per-item pills use `viewerUnitIds(tripId)` (per-trip party), so the split-costs row still shows "−¥15,000 for you" while the hero/Balances say settled — **the page contradicts itself on one screen.**
- **Fix:** Aggregate each item to units using **that item's trip party structure** (as `viewerUnitIds`/`itemUnitTransfers` already do per-row), then merge unit *balances* only for member-sets partied in every trip they co-occur in. Make the hero/balances use the same per-trip unit rule as the pills so the screen is internally consistent.

### H2. Removing a member silently redistributes shares and can direct payment to the departed member **[corroborated]**

- **Files:** `src/actions/members.ts:178-216` (`removeTripMemberAction`), `src/lib/split.js:274-280` (settlement participants added to `universe`).
- **Verified:** Yes.
- **Issue (two compounding effects):**
  1. **Silent redistribution:** a share is `weight / Σweights` of the amount, so deleting a member's split row does not make their share "unallocated" — it **inflates every remaining participant's share retroactively.** Their `extra_amount` deletion also silently shrinks the payer's reimbursement. Only `paid_by` rows get a "needs attention" signal; costs they merely *owed on* are reallocated with no signal. The code comment ("Acceptable data loss") mischaracterizes the effect.
  2. **Phantom transfers to the departed member:** settlements are kept ("Settlement history stays"), and `computeBalances` adds settlement participants to `universe`. The removed member resurfaces as a unit whose net is only their settlement credit — but the debt that settlement paid off is gone. Result: suggested transfers tell a remaining member to **pay the person who left** (who was already square).
- **Failure scenario:** A/B/C, dinner HK$300 paid by A split evenly. C settles their 100 to A, then owner removes C. Dinner re-divides A/B at 150 each; retained C→A settlement nets A +50, B −150, C(gone) +100 → suggestion: "B pays departed-C HK$100 and A HK$50." B's real debt was 100 to A.
- **Fix:** Wrap the whole removal in `db.transaction`. On removal, either **refuse while the member has non-zero balance/settlement history** (safest for real money), or scrub symmetrically (delete their settlements too) and convert their share to an explicit unallocated remainder; at minimum warn in the UI with the affected item count. Exclude settlement-only non-members from `universe`.

### H3. `dbReady()` permanently caches a rejected migration promise — one failed cold start bricks the instance

- **File:** `src/db/index.ts:50-65`.
- **Verified:** Yes — the memo is assigned with no `.catch`/reset.
- **Issue:** `globalThis.__itinDbReady` is set to the migration promise once. If `migrate()` rejects (transient Neon wake timeout, cross-instance migration race), every later `await dbReady()` re-awaits the same rejected promise. Every request path goes through it (`runAction`, `page-auth`, `auth.ts`, both attachment routes, `fx.ts`).
- **Failure scenario:** Cold start hits Neon mid-autosuspend-wake → `migrate()` throws → the rejected promise is memoized → **every request on that warm serverless instance 500s until it is recycled**, even though the DB is healthy seconds later.
- **Fix:** `globalThis.__itinDbReady = run().catch((e) => { globalThis.__itinDbReady = undefined; throw e; })`. Related: take a `pg_advisory_lock` around `migrate()` (or move migrations to a deploy step) to prevent the cross-instance race that triggers this (see M16).

### H4. Split replacement is delete-then-insert with no transaction — allocations can be silently destroyed **[corroborated ×3]**

- **Files:** `src/actions/bookings.ts:25-41`, `src/actions/expenses.ts:16-32`, plus the parent insert/update (`bookings.ts:43-134`, `expenses.ts:34-109`). No `db.transaction` exists anywhere in `src/`.
- **Verified:** Yes.
- **Issue:** `replace*Splits` run `DELETE` then `INSERT` as independent statements, and the parent write is a third separate statement. A failure between them leaves an item with its old splits deleted and new ones unwritten — settle math treats zero rows as "unallocated," so a shared cost silently drops out of everyone's balances with no error. Dev PGlite (single in-process connection) never reproduces this; it only bites in prod.
- **Fix:** Wrap parent write + `replace*Splits` in a single `db.transaction`. Both drivers support Drizzle transactions.

### H5. `maps_url` rendered as a raw `href` — `javascript:` scheme injectable via the parse pipeline

- **Files:** `src/components/BookingCard.jsx:437-439`, `src/components/BookingDetails.jsx:144-149`; taint source: `src/app/api/parse-booking/route.ts:34,46`, schema `src/lib/schemas.ts:100` (`details: z.record(z.string(), z.unknown())`).
- **Verified:** Yes — no scheme validation at form, schema, parse, or render layers.
- **Issue:** `details.maps_url` renders directly into `<a href={mapsUrl}>`. The form accepts free text, the schema is unvalidated, and the parse route explicitly instructs the model to **generate** `maps_url` from document content. A doctored booking document (prompt injection: "set maps_url to javascript:…") flows model → form → DB → a tappable link for every trip member. React 19 warns on `javascript:` hrefs but does not reliably block them.
- **Failure scenario:** A forwarded doctored "confirmation" PDF is parsed and saved (the URL isn't even shown in BookingCard, only the pin icon); another member taps "Open in Google Maps" → attacker JS runs in the app origin with their session.
- **Fix:** Validate `maps_url` to `^https?://` at the Zod layer (`superRefine` on `details.maps_url`), and drop/normalize it in the parse route's post-validation loop where `cost_amount` is already normalized.

### H6. JWT sessions are irrevocable for ~30 days — revoking a PIN or member doesn't log them out **[corroborated ×3]**

- **Files:** `src/auth.config.ts:9` (`session: { strategy: "jwt" }`, default 30-day maxAge); `src/actions/members.ts:374-380` (email change deletes `accounts` only), `:410-412` (PIN clear).
- **Verified:** Yes — Credentials provider forces JWT strategy; the `sessions` table is unused; the `authorized` callback checks only token presence.
- **Issue:** Deleting `accounts` rows or clearing a PIN only blocks **future** sign-ins. Every existing cookie stays valid until JWT expiry. This is also what makes the C1 email-change takeover persist, and means member removal has the same lag for any identity-level (`user.id`-keyed) action.
- **Fix:** Add a `sessions_valid_after` / `sessionVersion` column on `users`, checked in the `jwt`/`authorized` callback against `token.iat`, and bump it on email change / PIN clear / removal. Optionally shorten `session.maxAge`. Or move to database sessions (requires dropping Credentials or bridging).

### H7. Booking wall-times are stored as UTC instants — days shift with the viewer's timezone

- **Files:** `src/components/BookingForm.jsx:219-220` (write side, `new Date(form.start_date).toISOString()`); consumed by every calendar view via `new Date(b.start_date)` (`src/lib/calendar.js:66-75`, `MonthView.jsx:37-38`, `MobileMonthView.jsx:479-482`, `JourneyView.jsx:22-23`, `DayView.jsx:22-25`).
- **Verified:** Yes — `submitSave` calls `toISOString()`, baking in the device timezone; the seed script (`scripts/seed-journey-test.mjs`) stores naive local strings, so the DB holds **two incompatible formats** in a `text` column.
- **Issue:** A `datetime-local` value is a wall-clock time with no zone. Converting it through `toISOString()` freezes it to the offset of the device that entered it; every view then re-localizes to the *current* device offset. Naive strings parse as local wall time; `...Z` strings shift.
- **Failure scenario:** Enter "Tokyo hotel check-in Aug 5, 15:00" at home (UTC-7) → stored `2026-08-05T22:00:00Z`. Viewed on the phone in Japan (UTC+9) → renders check-in **Aug 6, 07:00** — stay bars, night counts, overnight chips, and "No stay" warnings all move to the wrong days for the whole trip. This app is used precisely while crossing timezones.
- **Fix:** Store naive local wall-time strings (`YYYY-MM-DDTHH:mm`) exactly as typed — drop `toISOString()` — matching the seed data and the local-parsing views. Migrate existing `Z` rows by re-rendering through the recording timezone once.

### H8. Month navigation skips months on day-31 overflow

- **File:** `src/screens/Calendar.jsx:218-223` (`navigate`).
- **Verified:** Yes — `d.setMonth(d.getMonth() + direction)` on the raw `currentDate`, which is set to arbitrary days by `handleSelectDate`/`onDayHighlight`.
- **Issue:** `setMonth` overflows when the current day exceeds the target month's length. Since every tap in the mobile month grid updates `currentDate` to that day (often the 29th–31st), paging forward/back can jump two months.
- **Failure scenario:** Tap Aug 31 in the month grid, then the "next" arrow → `setMonth(8)` on Aug 31 yields **Oct 1** — September is unreachable. Jan 31 → next → Mar 3.
- **Fix:** Page from first-of-month: `const d = new Date(currentDate.getFullYear(), currentDate.getMonth() + direction, 1)`.

---

## MEDIUM

### Money & settlement

- **M1. Guard-failed split items vanish from balances with zero signal.** `src/lib/split.js:246-247` — when `itemShares` returns null (Σextras > amount, or positive remainder with Σweights = 0) `computeBalances` does `continue`; the item lands in neither `unallocated` nor `missingPayer`. The server never cross-validates: `updateBookingAction` can lower `cost_amount` with `splits: undefined` (rows untouched) and `expenseUpdateSchema` has no Σextras ≤ amount check — only the client form checks it. *Fix:* add a third `invalidSplit` bucket surfaced under "Needs attention," and validate Σextras ≤ splittable server-side on update (loading existing splits when `splits === undefined`).
- **M2. Multi-trip settlement records against one arbitrary `trip_id`, desyncing per-trip views.** `src/screens/Settle.jsx:271-279,643-647`; `schema.ts:349-368`. A transfer aggregated over several trips is stored with a single `trip_id`; afterward the debt trip still shows the full debt and the settlement trip shows a spurious reverse credit — a user acting on either single-trip view can double-pay. Also `markPaid` prefill is wiped: picking a trip in `TripSelect` resets `from_user`/`to_user` to null. *Fix:* preserve prefilled from/to when the picked trip's roster contains them; scope suggested transfers per trip in multi-trip view, or store journey-level settlements.
- **M3. Stale SplitEditor / ChargedRateEditor state when switching directly between expense edits.** `Settle.jsx:1101-1165`, `SplitEditor.jsx:48-49`, `ChargedRateEditor.jsx:27`. The single `<form>` has no `key`, so editing expense B while A's form is open keeps A's `drafts`/`extraDrafts` and A's rate-open state — B's editor **displays A's typed weights** while `form.splits` holds B's real values; a save-without-touching writes the real value, so the UI lied. *Fix:* `key={form.id ?? 'new'}` on the form (or on the two editors) to remount and clear draft state.
- **M4. All settle math recomputes on every render.** `Settle.jsx:60-82,129-218`. `members/parties/bookings/expenses/settlements` are re-`filter`ed inline each render, so the `useMemo` deps for `computeBalances`/`suggestTransfers` change identity every render and re-run on every keystroke; `splitCostRows`, `splitGroups`, `viewerUnitIds` are unmemoized O(rows × members). *Fix:* memoize the five filtered arrays on `[allX, selectedTrips]`, derive the rest from those, and precompute a `tripId → unitMemberIds` map once.

### Bookings, attachments, parse

- **M5. Informal-stay toggle produces Invalid Date and throws uncaught on save. [corroborated]** `BookingForm.jsx:217-221,279-289,334-335`. Toggling "Informal stay" displays `start_date.slice(0,10)` but leaves the full datetime in state; `submitSave` builds `new Date("2026-08-05T15:00" + 'T00:00:00')` → `RangeError` thrown synchronously **before** `onSave`, so BookingModal's try/catch never fires — silent broken save, no toast. Also reproduced by opening an existing informal stay and changing only the title. *Fix:* normalize state on toggle (slice both dates), and slice defensively inside `submitSave`.
- **M6. Parse route: unbounded request body + uncapped text mode.** `parse-booking/route.ts:90-106`. `await req.json()` buffers the whole body before any size check; `file.length`'s 10MB check runs after. **Text mode has no length check at all** — any authenticated user can POST megabytes of "extracted text" forwarded verbatim to the paid Poe API. A non-string `file` skips the size check (`undefined > N` is false). *Fix:* reject on `content-length` before `req.json()`; require `typeof file === "string"`; cap `text` length (and truncate PDF text client-side).
- **M7. Attachment upload buffers the whole multipart body before validating size.** `attachments/route.ts:24-48`. `req.formData()` materializes the entire upload in memory before `file.size > MAX` is checked; no content-length precheck. *Fix:* reject early on the content-length header (~11MB allowance for multipart overhead).
- **M8. Attachment GET serves client-declared MIME inline without `nosniff`. [corroborated]** `attachments/[id]/route.ts:55-62`. `mime_type` is the client-supplied `file.type` (allowlist-validated, not magic-byte sniffed), replayed as `Content-Type` with `Content-Disposition: inline`, and the response has no `X-Content-Type-Options: nosniff` or CSP sandbox. The allowlist excludes html/svg (blocking the direct vector), so this rests entirely on the allowlist never growing a sniffable type. *Fix:* add `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`; force `attachment` disposition for non-image/PDF types.
- **M9. Parse route validates title/type but not dates.** `parse-booking/route.ts:195-210`; crash site `BookingForm.jsx:73-79`. A non-parseable model date reaches `toLocalDatetime` → `new Date(bad).toISOString()` → `RangeError` in the seed effect → the modal white-screens after a "Booking parsed!" toast. `cost_currency` is likewise unvalidated. *Fix:* reject `Number.isNaN(Date.parse(b.start_date))` in the per-booking loop; validate currency against known codes; make `toLocalDatetime` return `''` on invalid input.
- **M10. No double-submit guard in the booking form.** `BookingForm.jsx:243-251`. `handleSubmit` ignores the `saving` prop; pressing Enter while a save is in flight fires `onSave` again, and the create path generates a fresh UUID each call → duplicate bookings. *Fix:* `if (saving) return` at the top of `handleSubmit`.

### Data model & actions

- **M11. Bookings accept negative / unbounded cost fields; expenses don't. [corroborated]** `schemas.ts:101-103` — `cost_amount`/`cost_share` are `z.number().nullish()` and `cost_currency` is free-text `z.string()`, while the sibling expense schema uses `.positive()` and `currencySchema`. A negative `cost_amount` with `paid_by` set corrupts settlement balances and passes server validation the expense path would reject. *Fix:* constrain `cost_amount` to `.nonnegative()`, `cost_share` to a positive capped range, and `cost_currency` to `currencySchema`.
- **M12. `createTripAction` is not atomic — a failed member insert leaves an orphan, undeletable trip.** `bookings.ts:151-167`. Trip row and owner `trip_members` row are two statements; a failure between them yields a trip with zero members that `deleteTripAction` (owner-gated) can never delete. *Fix:* wrap both inserts in `db.transaction`.
- **M13. `removeTripMemberAction` runs ~7 dependent statements non-atomically. [corroborated]** `members.ts:158-216`. Beyond the balance semantics in H2, a mid-sequence failure leaves the member removed but split/`paid_by` rows dangling (or vice versa) — unrecoverable through the UI. *Fix:* single transaction.
- **M14. `moveTodoAction`: status and position writes are non-atomic and last-write-wins.** `todos.ts:143-160`. The status UPDATE and the CASE position rewrite are separate statements; concurrent drags each send a full pre-drag `orderedIds` snapshot and clobber each other; a failure between the two leaves status changed at a stale slot. *Fix:* wrap both in a transaction; consider a stale-snapshot guard (`updated_at` or `FOR UPDATE`).
- **M15. `day_notes` has no unique `(trip_id, date)` constraint behind its upsert.** `dayNotes.ts:17-46`, `schema.ts:227-242`. `upsertDayNoteAction` does select-then-insert with no unique index; concurrent upserts both insert, then `.limit(1)` with no `ORDER BY` picks nondeterministically. *Fix:* add `uniqueIndex` on `(trip_id, date)` + dedupe migration, switch to `onConflictDoUpdate`.
- **M16. Cross-instance migration race on cold start.** `db/index.ts:50-65`, `drizzle/*.sql`. Multiple instances cold-starting after a deploy each run `migrate()`; DDL isn't `IF NOT EXISTS`, so the race loser fails on `CREATE TYPE`/`ALTER TABLE ADD COLUMN` and — via H3 — bricks for its lifetime. *Fix:* `pg_advisory_lock` around migrate, or migrate as a deploy step.

### Todos / add form

- **M17. Moving a todo between journey trips errors when it carries an assignee, despite a graceful-drop path existing.** `Todos.jsx:216-228`, `actions/todos.ts:66-77`. `updateTodoAction` degrades gracefully only when `assignee_id === undefined`, but the edit form always sends `assignee ?? null`, so the strict `requireAssignable` branch throws "That person isn't a member of this trip." Directly hits the different-roster journey workflow. *Fix:* include `assignee` in the patch only when it actually changed (send `undefined` otherwise), or have the strict branch degrade to `assignee_id = null`.
- **M18. Add-form trip is stale after switching trip selection.** `Todos.jsx:77`. `newTodoTrip` is seeded from `selectedTrip` once at mount; since trip selection is client context (no remount), a new todo lands on the previously-selected trip and is filtered out of view — toast says "added," nothing appears. The assignee picker also offers the selected-trips union, not the target trip's roster. *Fix:* sync `newTodoTrip` on `selectedTrip` change; filter the form's members by the chosen trip's roster.

### Calendar / journey UI

- **M24. Cruise mid-days render both an "On board" chip and a full booking card.** `MobileMonthView.jsx:510-537` (chip) vs `:668-683` (card filter). Mid-stay chips exist for hotel/cruise/rental, but the full-card exclusion filter only handles `hotel`/`rental`, so a 7-night cruise shows both the "On board 3/7" chip and a full card on each middle day — the "wall of cards" the chips were meant to prevent. *Fix:* add `b.type === 'cruise'` to the exclusion branch (~line 670).
- **M25. Day-note editing silently fails and sticks when multiple trips are selected.** `MonthView.jsx:406-428`, `MobileMonthView.jsx:615-636`; rejection at `Calendar.jsx:131-135`. Both month views call `onUpsertDayNote({ date, title })` with no `trip_id`; with 2+ trips selected `selectedTrip` is null so `handleUpsertDayNote` rejects, but neither caller catches — unhandled rejection, no toast, editor won't close (blur retries and fails again). JourneyView does this correctly (`trip_id: owners[0]?.id`). Also `dayNotes.find(n => n.date === dateStr)` shows only one trip's note when both have one on the same date. *Fix:* resolve the owning trip like JourneyView and pass `trip_id`; wrap the `await` in try/catch with a toast; render notes per (date, trip).
- **M26. Rail-resize drag recomputes the entire grid + JourneyView on every pointermove.** `MonthView.jsx:137-150` (drag), `JourneyView.jsx:108-166` (unmemoized day pipeline). `setPanelWidth` per pointermove re-runs the whole 42-cell month pipeline (`getBookingsForDate` + sort + overnight-coverage + `inAnyTrip` with fresh `Date` parses) plus the embedded JourneyView's full multi-trip rebuild plus a `localStorage.setItem` per frame — only the aside width changes. *Fix:* drive the drag via a ref/direct style write, commit width on pointerup; memoize the grid + JourneyView; debounce the localStorage write.
- **M27. Mobile agenda swipe: the at-top guard was designed but never wired.** `MobileMonthView.jsx:242-272`. `startScrollTop` is captured and `SCROLL_TOLERANCE` declared, but neither is used: any upward swipe while expanded commits `gestureMode = 'collapse'` and `preventDefault()`s agenda scrolling, even mid-scroll (reachable by expanding via the Month toggle, which doesn't reset scroll). *Fix:* enter collapse only when `startScrollTop <= SCROLL_TOLERANCE`, else `'scroll'` — the two dead variables are exactly the intended guard.
- **M28. Out-of-trip-range bookings are unreachable in the mobile agenda.** `MobileMonthView.jsx:177-210` (agenda bounded to `tripMeta.start_date..end_date`); same class in `JourneyView.jsx:108-111`. BookingForm deliberately allows out-of-range bookings ("warn, don't block", `BookingForm.jsx:199-212`), but the agenda iterates only trip-start→trip-end, so a pre-trip flight gets no day row — the month grid still shows its dot and the day is tappable, but `scrollAgendaToSelectedDay` finds no `[data-date]` node → silent no-op. *Fix:* extend agenda bounds to `min(tripStart, earliest booking)`/`max(tripEnd, latest booking)`, or show an out-of-range banner row.

### Shell / infra

- **M19. TripContext value rebuilt every render → full-screen re-render storm on sidebar drag.** `AppShell.tsx:205-206,167-187`. The provider `value` is an inline literal recreated every render, and drag-resize calls `setSidebarWidth` on every raw `mousemove`; every pixel re-renders all `useTripContext` consumers, including a booking-heavy Calendar. *Fix:* `useMemo` the context value; throttle mousemove with rAF.
- **M20. No security headers anywhere. [corroborated]** `next.config.ts` (no `headers()`), `vercel.json` (regions only). No CSP/`frame-ancestors`, no `X-Frame-Options`, no `nosniff`, no `Referrer-Policy` — every authenticated page is frameable (clickjacking), and attachment bytes are served without nosniff. *Fix:* add a `headers()` block: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a CSP.
- **M21. Service-worker offline fallback is dead code.** `public/sw.js:55-66`. The network-first `catch` reads `caches.match("/")`, but nothing ever `cache.put()`s navigations or `/` — only static chunks/icon/manifest are cached, so the documented "offline → home" never happens; offline navigations resolve to a bare 503 with no way back. *Fix:* cache a successful `/` navigation in the network-first success path, or delete the fallback and its comment.
- **M22. Attachment DELETE fetches the full bytea blob to authorize the delete. [corroborated]** `attachments/[id]/route.ts:21-35,67-81`. `loadAttachment` selects `content` and is shared by GET and DELETE; DELETE never uses the bytes but still pulls up to 10MB from Neon. *Fix:* split the loader — select only `id, trip_id` for DELETE.
- **M23. List and settle queries ship `raw_text`/`details` for every booking.** `queries.ts:15,112-129,412-425`. `bookingCols = getTableColumns(bookings)` selects the full parsed-email `raw_text` and `details` jsonb for every booking on every itinerary/Costs/Settle render; `getSettleData` is an unbounded multi-trip union. No component consumes `raw_text`. *Fix:* define a narrowed column set omitting `raw_text`/`source_file`/`details` for list/settle reads; fetch heavy columns only in a single-booking detail query.

---

## LOW

- **L1. Client-side todo position tie-break compares `Date.toString()`.** `Todos.jsx:114-116` — `String(a.created_at).localeCompare(...)` sorts by weekday/month name, not time. *Fix:* compare `.getTime()`.
- **L2. Last-owner guard is check-then-act.** `members.ts:98-105,145-155` — two owners concurrently demoting/removing each other can pass both checks and leave zero owners (trip permanently unmanageable). *Fix:* guarded conditional write inside a transaction / row lock.
- **L3. Sign-in PIN generated with `Math.random`.** `Settings.jsx:303` — non-crypto PRNG for a 6-digit login secret (lockout limits impact). *Fix:* `crypto.getRandomValues` with rejection sampling.
- **L4. PIN lockout counter has a read-modify-write race.** `auth.ts:51-64` — `failed_pin_attempts + 1` in JS, not an atomic SQL increment; concurrent guesses read the same base, weakening the 5-try guarantee. *Fix:* `set({ failed_pin_attempts: sql\`... + 1\` })`.
- **L5. Every mutation revalidates the whole layout. [corroborated]** `todos.ts:10`, `members.ts:12`, `dayNotes.ts:10` — `revalidatePath("/", "layout")` re-runs every page query (including the unbounded `getSettleData`) for a one-row change. *Fix:* revalidate affected segments or use tag-based revalidation.
- **L6. Un-toggling informal stay converts a date-only value at UTC midnight — off-by-one day.** `BookingForm.jsx:220-221` — `new Date("2026-07-01")` parses as UTC per spec; in negative-offset zones the stay lands on the previous day. *Fix:* append `'T00:00:00'` before `new Date()`.
- **L7. Client/server size-limit mismatch for AI parse.** `parseBooking.ts:5` (10MB raw) vs `parse-booking/route.ts:6,103` (10MB base64 ≈ 7.5MB raw) — 7.5–10MB files pass the client check and fail server-side with a confusing "max 10MB." *Fix:* align the limits.
- **L8. Staged attachments discarded after a failed upload.** `BookingModal.jsx:132-137` — `setStagedFiles([])` runs regardless of upload success; a transient failure silently drops the file with no retry. *Fix:* clear only on success.
- **L9. `source_file`/`raw_text` provenance is dead code.** `BookingModal.jsx:105-107` vs `parseBooking.ts:68-72` — the modal stamps these but the parser never populates them, so the DB columns are always null for parsed bookings. *Fix:* attach them in `parseBookingFromImage`, or delete the dead stamping.
- **L10. pdf.js document never released; no page cap.** `parseBooking.ts:8-28` — no `pdf.destroy()` (worker heap grows on retry), and every page is extracted unbounded (feeds L7/M6). *Fix:* `finally { await pdf.destroy() }`; cap pages (~20).
- **L11. Client-supplied primary keys allow existence probing.** `bookings.ts:52`, `todos.ts:29`, `dayReminders.ts:32` — a guessed `id` colliding cross-trip surfaces a duplicate-key error vs success (minor info disclosure; inserts, not upserts, so no overwrite). *Fix:* generate ids server-side, or map unique-violations to a generic error.
- **L12. Missing indexes on FK / scrub columns.** `schema.ts` — `booking_splits(user_id)`, `expense_splits(user_id)`, `bookings.paid_by`, `expenses.paid_by`, `trip_members.party_id`, `settlements.from_user/to_user`, `sessions.user_id` are unindexed; scrub/cascade paths do sequential scans. Invisible at household scale; degrades linearly. *Fix:* add the split `user_id` indexes at minimum.
- **L13. `todos` position counter is computed over the entire table, unscoped by trip. [corroborated]** `todos.ts:20-25,163-166` — `max(position)+1` has no trip filter (unlike day-reminders); positions grow unboundedly and drags in a trip-subset selection can scramble All-Trips ordering (colliding positions fall through to the L1 tie-break). *Fix:* scope `max(position)` to the rendered trips.
- **L14. `settlements` user FKs are `ON DELETE NO ACTION`.** `schema.ts:356-361` — every other user FK cascades/set-nulls; a future account-deletion flow will throw for any user with settlement history. *Fix:* document as intentional, or switch to `set null` with a denormalized display name.
- **L15. `getTripsWithMembers` pulls `password_hash` to compute a boolean.** `queries.ts:212,256-260` — the scrypt hash for every member is selected into memory to derive `has_pin`. *Fix:* select `sql\`password_hash is not null\`.as("has_pin")`.
- **L16. `deleteTripAction` docstring describes pre-0006 FK behavior.** `bookings.ts:184-187` — says trip delete nulls todo/day-note/reminder `trip_id`, but migration 0006 made those `ON DELETE CASCADE`; delete now hard-deletes them. *Fix:* correct the comment; state the cascade in the confirm UI.
- **L17. Login flow discards `callbackUrl`.** `login/page.tsx:68-71,93,111-115` — all `signIn` calls hardcode `redirectTo: "/"`, dropping the deep-linked destination (`?trip=…`) the middleware preserved. *Fix:* read/validate a same-origin `callbackUrl` and pass it as `redirectTo`.
- **L18. `toggleTrip` performs a side effect inside a state updater.** `AppShell.tsx:56-67` — `persistSelection` (localStorage) runs inside `setSelectedTripsState`; React 19 StrictMode double-invokes updaters and may discard them, so a never-committed selection could persist. *Fix:* compute `next` outside the updater or persist in an effect.
- **L19. Manifest/icon and old static chunks cached forever with no version bust.** `sw.js:4,23-27` — stable-URL versioned assets are cache-first inside `itinerary-v3` with no eviction; manifest/icon changes don't propagate and cache grows monotonically. *Fix:* network-first the tiny manifest/icon; template `CACHE_NAME` from the git sha.
- **L20. Service worker registers in dev.** `register-sw.tsx:8-10` — cache-firsts unhashed dev chunks, staling HMR and the headless test recipe. *Fix:* guard with `NODE_ENV === "production"`.
- **L21. Toolchain drift.** `package.json` — `engines node >=24` vs `@types/node ^20`; `next-auth ^5.0.0-beta.31` (caret over a prerelease → a lockfile refresh can jump betas and invalidate all sessions). *Fix:* bump `@types/node` to ^24; pin `next-auth` exact until v5 stable.
- **L22. `maximumScale: 1` disables pinch-zoom on Android.** `layout.tsx:21` — WCAG 1.4.4 failure. *Fix:* drop `maximumScale`; use 16px input font-size if the goal was suppressing iOS auto-zoom.
- **L23. Misc Settle display issues.** `Settle.jsx` — hero "settles in N transfers" counts the whole group's transfers not the viewer's; `TransferCard key={i}` index key; `simplify` inits `true` then flips from localStorage (one-frame flash); `itemViewerNet` returns 0 not null for uninvolved items (renders "even" instead of nothing); Costs currency-breakdown chips show native amounts while the total uses charged values. *Fix:* count only viewer-touching transfers, key by unit+currency, lazy-init from localStorage, return null when uninvolved.
- **L24. Content-Disposition ASCII fallback doesn't escape backslashes.** `attachments/[id]/route.ts:13-17` — a filename ending in `\` yields `filename="evil\"` (ambiguous for some parsers; `filename*` takes precedence in modern browsers). *Fix:* also `.replace(/\\/g, "_")`.
- **L25. WeekView places multi-day stays at the check-in hour on every covered day.** `WeekView.jsx:47-50` — filters by `getHour(b.start_date) === hour` on all spanned days including checkout, so a hotel with check-in 15:00 / check-out 11:00 shows its checkout-day chip (with "out" badge) in the 3 PM row, implying a 3 PM checkout. DayView handles this correctly (`end.getHours()` on checkout day, `DayView.jsx:59-66`). *Fix:* reuse DayView's checkout-hour logic, or render mid-stay days as an all-day band.
- **L26. Hydration mismatch: "today" and locale dates computed at render.** `MonthView.jsx:155`, `MobileMonthView.jsx:138`, `WeekView.jsx:9`, `JourneyView.jsx:64`; `toLocaleDateString/TimeString(undefined, …)` throughout. These client components are SSR'd with the server's timezone/locale, then re-run on the phone — near midnight or across locales the "Today" ring/badge and date labels differ between markup and hydration (e.g. 5 PM PDT = next-day UTC → server marks tomorrow as today). *Fix:* compute `today` in `useEffect`/`useSyncExternalStore` (or gate the highlight behind mount); pass an explicit locale or `suppressHydrationWarning` on formatted date text.
- **L27. Day-note editor can double-submit (Enter + click-away).** `MonthView.jsx:406-428`, `MobileMonthView.jsx:615-636`; server action `dayNotes.ts:17-47`. Enter fires `onSubmit`; clicking away during the `await` fires the still-mounted input's `onBlur` → a second `upsertDayNote`; combined with the missing unique constraint (M15) both can insert, and the duplicates then render nondeterministically. *Fix:* guard with a `submittingRef` (skip blur while a submit is in flight); add the `(date, trip_id)` unique index with `onConflictDoUpdate`.
- **L28. No-trip mobile agenda can't show past days; empty-state copy wrong.** `MobileMonthView.jsx:187-209,440` — with no trip selected the agenda loop starts at today and ends `selectedDay + 30`, so a tapped past day gets no row (scroll no-op) and a far-past selection empties the range entirely; the empty state says "No bookings this week" on a month view. *Fix:* start the loop at `min(today, selectedDay)`; fix the copy.

---

## What's solid (verified clean)

- **Authorization pattern:** every update/delete loads the row and derives `trip_id` from it rather than trusting the client; cross-trip moves re-check write access on both trips and re-validate carried payer/split members. No sibling action is missing a check. `settle.ts` blocks intra-party and same-person settlements and re-checks access on delete. `authz.ts` `requireAssignable` restricts tripless-todo assignees to shared-trip members.
- **Core money arithmetic:** `itemShares` extras-off-the-top math is zero-sum (traced: 15,061 / 4-way / 447 extra sums back exactly); float dust stays far below the 0.01/1-unit epsilons; settlement sign conventions are correct in both modes with no double-count; `suggestTransfers` greedy termination is correct; charged-rate direction and re-denomination are consistent across every consumer, and approximate FX never enters settlement math. `fx.ts` inversion + sanity guards are correct and server-only.
- **Data model:** money is Postgres `numeric` (not float); `schema.ts` is in sync with migrations 0000-0013; split loading is batched via `inArray` (no N+1); membership joins are duplicate-safe; attachment upload/list paths correctly exclude the `content` blob and attachments cascade-delete with their booking; pool config is sane for Neon.
- **Auth/infra:** middleware + page guard + action guard form a consistent triple layer; dev-login is effectively gated out of production builds at both registration and UI; `pin.ts` uses scrypt + `timingSafeEqual` with a length check; no searchParam-based trip scoping was reintroduced; the PDF worker version-pinning + cache-bust is correct.
- **Calendar UI:** `DayReminders` dnd-kit setup is solid (6px activation distance, `touch-none` handle, keyboard sensor, id-keyed optimistic reorder — no index-key state bleed); BookingChip and the mid-stay pills follow the truncating-span lesson; internal-scroll panels correctly carry `min-h-0` (MonthView weeks column and rail aside, JourneyView scroller); week-start is consistently Sunday across `getMonthGrid`/`getRangeGrid`/`getWeekDays`/headers; month-boundary stay bars split/merge correctly with rounded ends only at true edges; `getMonthGrid`/date-stepping uses component constructors (DST-safe); day-note/reminder server actions are authz-guarded and the reorder CASE update is per-day-scoped; `useMediaQuery` is SSR-safe.
- **Components:** `AssigneePicker`, `Toast`, `Spinner`, `useTodoList` optimistic/pending guards, and Settings' role/last-owner mirroring of server guards are all correct; the layover merge refuses cross-currency fare summing; `normalizeAmount` guards the `parseFloat("1,234.50")` trap; Content-Disposition is CRLF-injection-safe.

---

## Notes on method

Seven area reviews ran in parallel; each was instructed to trace and confirm before reporting, not to flag hypotheticals or style. The reviewer of a given area was blind to the others, so the **[corroborated]** markers (findings independently surfaced by two or three reviewers — the account-takeover cluster, JWT irrevocability, non-atomic split writes, member-removal corruption, the informal-stay save crash, attachment nosniff, day-note upsert races, unscoped todo positions, whole-layout revalidation) reflect genuine cross-confirmation. The Critical and all eight High findings above were additionally re-verified against the source by hand.

Counts: 1 Critical, 8 High, 28 Medium, 28 Low.
