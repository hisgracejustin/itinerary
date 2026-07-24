# Split expenses & settle up — implementation plan

**Status:** plan / not implemented. Scope confirmed with Justin (2026-07-23);
updated 2026-07-24 for the shipped client-state multi-trip selection (see the
"Trip selection" section of [architecture.md](architecture.md)).

## Context

The app tracks trips, bookings, and costs, but has no concept of *who paid* or *who
owes whom*. Costs live inline on `bookings` (`cost_amount`, `cost_currency`,
`cost_share`), and `cost_share` is a bare multiplier ("×0.5") that conflates
"the trip's portion of an externally shared cost" with "my share of a group
cost" — which is why the Costs page total is ambiguous: is it the trip total, or
the logged-in user's cost (possibly 2× what they'd expect when they're half of a
couple)?

Goal: let trip members split costs — not always everyone, not always equally,
with couples treated as one settlement unit — and see who owes whom at the end
of a trip.

Decisions already made (do not re-litigate):

1. **Split booking costs AND ad-hoc expenses** (dinners, taxis) — new
   lightweight `expenses` entity, not fake bookings.
2. **Record settlements** ("Bob paid Alice back HK$500") so balances go to zero
   over time.
3. **New "Settle up" page** in the sidebar. The Costs page separately gains a
   clear Everyone / Me / Us scope toggle.
4. **Settlement math is per-currency exact — never FX-converted.** The static
   `toHKD` table in [`src/lib/currencies.js`](../src/lib/currencies.js) is
   approximate and is only for cost *exploration* (Costs page totals, sorting,
   by-type bars, always rendered with a `~` prefix). It must never determine
   what people actually owe each other.

### Existing infrastructure to reuse — do NOT reinvent

| What | Where |
| --- | --- |
| Member roster w/ roles, email invites, placeholder users | `trip_members` table; [`src/actions/members.ts`](../src/actions/members.ts) |
| Authorization | `requireTripAccess`, `WRITE_ROLES` in [`src/lib/authz.ts`](../src/lib/authz.ts) |
| Server-action wrapper (auth + error normalization) | `runAction` in [`src/lib/action-utils.ts`](../src/lib/action-utils.ts) |
| Member queries | `getTripsWithMembers`, `getAssignableUsers` in [`src/lib/queries.ts`](../src/lib/queries.ts) |
| Member UI atoms | `Avatar`, `memberLabel`, `memberFirstName`, `AssigneePicker` in [`src/components/AssigneePicker.jsx`](../src/components/AssigneePicker.jsx) |
| Filter pills | [`src/components/FilterChip.jsx`](../src/components/FilterChip.jsx) |
| Money helpers | `toHKD`, `formatCurrency`, `CURRENCIES` in [`src/lib/currencies.js`](../src/lib/currencies.js) |
| Design system | `.mat-surface`, `.mat-btn-*`, `.mat-input`, `.mat-select` in [`src/app/globals.css`](../src/app/globals.css) |
| Page pattern | [`src/app/(app)/costs/page.tsx`](../src/app/(app)/costs/page.tsx): `force-dynamic`, `requirePageUser()`, union fetch via queries, client screen filters by `useTripContext()` selection, sibling `loading.tsx` |

Placeholder members (invited by email, never logged in) are real `users` rows,
so they participate in splits with no special handling.

---

## Data model

All in [`src/db/schema.ts`](../src/db/schema.ts), mirroring the file's existing
conventions (snake_case columns via drizzle config, `text` user ids, `numeric`
with `mode: "number"`, cascade FKs, exported types, relations block at the
bottom). Generate the migration with `npx drizzle-kit generate` → `drizzle/0009_*.sql`;
the runtime migrator (`dbReady()` in [`src/db/index.ts`](../src/db/index.ts))
applies it automatically on next boot — no manual migration step.

New tables:

```
trip_parties                      -- settlement units for couples/groups
  id          uuid PK defaultRandom
  trip_id     uuid  → trips.id        on delete cascade
  name        text  notNull           -- e.g. "Justin & Coco"
  created_at  timestamptz default now

booking_splits
  booking_id  text  → bookings.id     on delete cascade   -- NOTE bookings.id is text
  user_id     text  → users.id        on delete cascade
  weight      numeric(mode number) notNull default 1
  PK (booking_id, user_id)

expenses                          -- ad-hoc shared costs (dinner, taxi…)
  id          uuid PK defaultRandom
  trip_id     uuid  → trips.id        on delete cascade
  title       text  notNull
  amount      numeric(mode number) notNull
  currency    text  notNull
  paid_by     text  → users.id        on delete set null
  date        text  (nullable)        -- "YYYY-MM-DD", matching trips' text dates
  created_at  timestamptz default now

expense_splits
  expense_id  uuid  → expenses.id     on delete cascade
  user_id     text  → users.id        on delete cascade
  weight      numeric(mode number) notNull default 1
  PK (expense_id, user_id)

settlements                       -- recorded pay-backs, person-to-person
  id          uuid PK defaultRandom
  trip_id     uuid  → trips.id        on delete cascade
  from_user   text  → users.id
  to_user     text  → users.id
  amount      numeric(mode number) notNull
  currency    text  notNull
  note        text  (nullable)
  created_at  timestamptz default now
```

New columns on existing tables:

```
trip_members.party_id  uuid nullable → trip_parties.id  on delete set null
bookings.paid_by       text nullable → users.id         on delete set null
```

Add drizzle relations (`bookings → splits`, `expenses → splits`, `trips →
parties/expenses/settlements`, etc.) and exported TS types alongside the
existing ones.

### Semantics (also put these in `src/lib/split.js` doc comments)

- **Splittable amount of a booking = `cost_amount × cost_share`** — the
  existing `effectiveCost` used by [`src/screens/Costs.jsx`](../src/screens/Costs.jsx)
  and `spendStat` in [`src/lib/bookingStats.js`](../src/lib/bookingStats.js).
  `cost_share` keeps its meaning ("the trip's portion of an externally shared
  cost"); the per-person split divides what's left. An expense's splittable
  amount is simply `amount`.
- **Weights**: a person's share of an item = `weight / Σweights` over that
  item's split rows. Equal split = everyone at weight 1. A couple included "as
  a couple" = both members present at weight 1 each (they consume 2 of N
  shares). Parties never appear in split rows — they only aggregate at
  settlement/display time.
- **No split rows = unallocated**: the item is excluded from balances and
  surfaced on the Settle page under "Needs attention". Do NOT silently default
  to everyone-equal.
- **Splits without a payer are also excluded** from balances (they'd break the
  zero-sum invariant) and surfaced as "needs a payer". The split editor
  requires a payer whenever splits exist (client + Zod validation).
- The payer needn't be in the split (booking on behalf of others is fine).
- With `cost_share < 1`, assume the payer fronted only the trip's effective
  portion; the external remainder is out of scope.

---

## Balance math — new `src/lib/split.js`

Pure functions, no DB access, style mirroring
[`src/lib/bookingStats.js`](../src/lib/bookingStats.js). Everything here is
**per-currency exact** — `toHKD` must not appear in this file.

```js
computeBalances({ members, parties, bookings, expenses, settlements })
// → {
//     units: [{ key, name, memberIds, paid, owed, net }],   // paid/owed/net: {currency: amount}
//     unallocated: [...items with a cost but no splits],
//     missingPayer: [...items with splits but no paid_by],
//   }
```

- Per item (booking with cost+splits+payer, or expense with splits+payer), in
  its **native currency**:
  `owed[user][cur] += splittable × w/Σw`; `paid[payer][cur] += splittable`.
- Aggregate users into **units**: members sharing a `party_id` form one unit;
  everyone else is a solo unit. **Key units by the sorted member-id set joined
  with `+`, not by `party_id`** — parties are per-trip rows, and the same
  couple in two trips must merge into one unit when balances span multiple
  trips (see Multi-trip selection below). The party `name` is display-only
  (solo units use `memberLabel`).
- `net[unit][cur] = paid − owed`.
- Apply settlements exactly in their recorded currency:
  from→to of `X CUR` ⇒ `net[fromUnit][CUR] += X`, `net[toUnit][CUR] −= X`.
  (Sign check: a debtor who pays moves toward 0 from below.)

```js
suggestTransfers(units)
// → [{ fromUnit, toUnit, amount, currency }]
```

- Greedy min-cash-flow run **independently per currency**: repeatedly match the
  largest debtor with the largest creditor for `min(|debt|, credit)` until all
  `|net| < ε`, where ε = 1 for the zero-decimal currencies (JPY/KRW/TWD — same
  set `formatCurrency` special-cases), else 0.01.
- A pair who shared costs in two currencies gets two suggested transfers.
  That is correct — cross-currency netting would require FX, which is exactly
  what we refuse to do here.
- Guard: skip items whose `Σweights ≤ 0`.

Rendering rule: settle figures use `formatCurrency` with **no** `~` prefix —
they are exact. The `~HK$` treatment stays on the Costs page only.

---

## Backend

### Zod (in [`src/lib/schemas.ts`](../src/lib/schemas.ts))

- `splitEntrySchema = { user_id: string, weight: number > 0 }`.
- Extend `bookingInsertSchema` (and the update variant) with optional
  `paid_by: string | null` and `splits: splitEntrySchema[] | undefined`.
- New `expenseInsertSchema` (`trip_id`, `title` non-empty, `amount > 0`,
  `currency` ∈ known codes, `paid_by`, `date` optional, `splits` required
  non-empty), `settlementInsertSchema` (`trip_id`, `from_user`, `to_user` ≠
  `from_user`, `amount > 0`, `currency`, `note` optional), `partySchema`.
- Cross-field rule: `splits` non-empty ⇒ `paid_by` required.

### Actions

All follow the existing pattern: `"use server"`, `runAction(async (user) => …)`,
`requireTripAccess(user.id, trip_id, WRITE_ROLES)`, Zod parse first,
`revalidatePath("/", "layout")` on success.

**[`src/actions/bookings.ts`](../src/actions/bookings.ts)** — extend
`createBookingAction` / `updateBookingAction`:

- Persist `paid_by` with the booking row.
- When `splits` is provided: **replace-all** — delete existing `booking_splits`
  rows for the booking, insert the new set. `splits: []` therefore un-splits;
  `splits: undefined` leaves existing rows untouched. Use a transaction if the
  codebase already uses them; otherwise sequential delete+insert is acceptable
  here.
- Validate that `paid_by` and every split `user_id` is a member of
  `data.trip_id` (one `trip_members` query with `inArray`; mirror
  `requireAssignable` in [`src/lib/authz.ts`](../src/lib/authz.ts)). On
  update, validate against the booking's (possibly new) trip — moving a
  booking to another trip must not carry members who don't belong there.

**New `src/actions/expenses.ts`** — `createExpenseAction`,
`updateExpenseAction`, `deleteExpenseAction`. Splits handled inline with the
same replace-all + membership validation as bookings.

**New `src/actions/settle.ts`** — `recordSettlementAction`,
`deleteSettlementAction`. Validate both parties are trip members.

**[`src/actions/members.ts`](../src/actions/members.ts)** —

- Party management, **owner-only** (matching the rest of member management):
  `createPartyAction({trip_id, name, member_ids})` (sets `party_id` on those
  members), `renamePartyAction`, `deletePartyAction` (members detach via the
  FK's set-null), `setMemberPartyAction({trip_id, user_id, party_id | null})`.
  A member belongs to at most one party; assigning overwrites.
- `removeTripMemberAction`: alongside the existing todo re-nulling, delete the
  removed user's `booking_splits` / `expense_splits` rows within that trip and
  null any `bookings.paid_by` / `expenses.paid_by` pointing at them.
  Settlements rows stay (history). This is acceptable data loss for this app.

### Queries ([`src/lib/queries.ts`](../src/lib/queries.ts))

- Extend the bookings fetch used by `/costs` (`getBookingsForUser`) to attach
  splits: one extra `booking_splits` select with `inArray(booking_id, …)`,
  merged in JS as `b.splits = [{user_id, weight}]`. `paid_by` comes with the
  row already. Keep the membership `INNER JOIN` — it is the authorization.
- New `getSettleData(userId)` → `{ members, parties, bookings, expenses,
  settlements }` for **every accessible trip** (rows carry `trip_id`; members
  carry `party_id`; only cost-bearing bookings, each with splits attached).
  Like all pages, Settle fetches the union and the screen filters by the
  client-side selection (see Multi-trip selection below).
- `TripSummary` (in [`src/lib/trip-context.tsx`](../src/lib/trip-context.tsx))
  **already carries `members`** — the layout fetches `getTripsWithMembers`.
  Extend it: add `party_id` to each member row and a `parties: [{id, name}]`
  list per trip, so SplitEditor and the globally-mounted BookingModal can
  render party-aware pickers on every page with no extra query.

---

## UI

### 1. Shared split editor — new `src/components/SplitEditor.jsx`

One component used by BookingForm and the expense form.
Props: `{ members, parties, amount, currency, paidBy, splits, onChange }`
(`amount`/`currency` are for the live preview; `onChange` emits
`{ paid_by, splits }`).

- **"Paid by"** — reuse `AssigneePicker`.
- **"Split between"** — chip row, one chip per unit: a party chip toggles all
  of its members at once; a solo chip toggles one member. `Avatar` +
  `memberFirstName`; **truncate the name span** (`truncate` on a `min-w-0`
  span) so chips never wrap ugly on mobile. Default when the user first
  enables splitting: all members at weight 1.
- **"Adjust shares"** disclosure — per included person, a small
  `inputMode="decimal"` weight input plus the live computed share
  (`formatCurrency(amount × w/Σw, currency)`), styled like the existing
  Your-Share row (`src/components/BookingForm.jsx` cost section).
- **The roster follows the item's trip, not the sidebar selection.**
  BookingForm has its own trip dropdown; when `form.trip_id` changes, feed
  SplitEditor that trip's members/parties (from `TripSummary.members`) and
  prune split entries whose users aren't members of the new trip.

### 2. BookingForm ([`src/components/BookingForm.jsx`](../src/components/BookingForm.jsx))

- Render SplitEditor inside the cost section, only when `cost_amount` is set.
- Relabel the existing "Your Share" field to **"Trip's portion"**, helper text
  "Portion of this cost that belongs to this trip" — disambiguating it from
  the per-person split. Field behavior unchanged.
- Submit payload gains `paid_by` + `splits`;
  [`src/components/BookingModal.jsx`](../src/components/BookingModal.jsx)
  passes them through unchanged.

### 3. Costs page ([`src/screens/Costs.jsx`](../src/screens/Costs.jsx), [`src/app/(app)/costs/page.tsx`](../src/app/(app)/costs/page.tsx))

- **Scope toggle** at the top using `FilterChip`: **Everyone** / **Me**
  (labeled with the viewer's first name) / **Us** (only when the viewer is in
  a party; labeled with the party name).
  - Everyone: current behavior; header reads "Trip total".
  - Me / Us: each item contributes
    `effective × (Σ scope-user weights present in its splits) / Σweights`;
    header reads "Your share" / "*party name*'s share". Items without splits
    are excluded from Me/Us, with a footnote: "N costs not split yet — shown
    under Everyone only".
  - "Us" is computed per item: sum the shares of members who share a party
    with the viewer *in that item's trip* (correct even if the partner set
    ever differs between trips).
- **Include expenses** in the totals, per-currency pills, by-type bars (as an
  "Expenses" category), and the sorted list (receipt-style icon), in all
  scopes. The page RSC additionally fetches expenses. HKD conversion (`~`
  prefix) stays as-is here — this page is exploration.

### 4. New Settle page — `src/app/(app)/settle/page.tsx` + `loading.tsx` + `src/screens/Settle.jsx`

Follow the `costs/` route pattern exactly: the RSC fetches the union
(`getSettleData(userId)`), the screen filters by `selectedTrips` from
`useTripContext()` and recomputes balances client-side — so toggling trips
re-settles instantly. Sidebar
([`src/components/Sidebar.jsx`](../src/components/Sidebar.jsx)): add a
"Settle up" nav item (plain path, like the other nav links). No trip-selected
gating: with nothing selected, balances cover all trips (the whole journey).

Sections, top to bottom (single column on phones, `.mat-surface` cards;
remember `min-h-0` on any internally-scrolling flex/grid child):

1. **Balances** — one row per unit: `Avatar`(s) + name, then per-currency net
   pills (exact `formatCurrency`; green "is owed", red "owes"); paid/share
   detail per currency in a sub-line or expandable row.
2. **Suggested transfers** — "Bob → Alice HK$500", "Bob → Alice ¥3,000" rows
   from `suggestTransfers` (one per currency owed). Each has a "Mark paid"
   button pre-filling the record-settlement form (from/to/amount/currency; for
   a party unit, default to the party's first member — settlements are
   person-to-person).
3. **Expenses** — an "Add expense" card that expands into an inline form
   (title, amount + currency `.mat-select`, date, SplitEditor), plus the list
   with edit/delete. An inline expandable card avoids modal/iOS-viewport
   complexity; if a modal is used instead, follow the BookingModal shell rules
   (`max-h-full` not `vh`, body `flex-1 min-h-0 overflow-y-auto`, sticky
   footer, safe-area padding).
4. **Needs attention** — unallocated cost-bearing bookings and payer-missing
   items. Tapping a booking should open the global booking modal in edit mode
   — reuse whatever open-booking mechanism `AppShell.tsx` exposes to screens;
   if none is reachable, link to the booking's `/bookings/[type]` page as a
   fallback.
5. **Settlement history** — recorded settlements with delete, plus a manual
   "Record a payment" entry point.

### 5. Settings ([`src/screens/Settings.jsx`](../src/screens/Settings.jsx))

In the TripCard "People" section (owner view): group members into parties —
select 2+ members → "Group as couple" with a name input (default
"A & B" from `memberFirstName`); grouped members get a small party badge;
rename/ungroup controls. Calls the new party actions.

### Mobile checklist (app is phone-first)

- Chips/pills: truncating `min-w-0` name spans, never let rows wrap raggedly.
- Any internal scroll region inside grid/flex needs `min-h-0` on the item.
- Numeric inputs: `inputMode="decimal"`; the global 16px iOS input rule
  already prevents zoom.
- Modals: `max-h-full` against the safe-area wrapper, never `vh`.

---

## Multi-trip selection (shipped — see the "Trip selection" section of [architecture.md](architecture.md))

Justin files one long journey (~5 weeks) as 2–3 trips because each leg has a
different roster. Settling is usually per trip, but the whole journey is
sometimes viewed together. Multi-trip selection is **already shipped** (July
2026) and works like this — build the split feature on the same pattern:

- Selection is **pure client state** in `TripContext`
  (`selectedTrips` / `toggleTrip`; compat shims `selectedTrip` / `tripMeta`
  read as "All Trips" when 0 or 2+ trips are selected). Pages always fetch the
  **union** of the user's trips; screens filter by the selection, so a toggle
  is one instant client render. Do NOT scope any of the new pages by search
  params — Next 16 serves stale RSC payloads on search-param navigations
  (vercel/next.js#88535, #92187; see the memory in `architecture.md`).
- **Settle follows the union pattern**: `getSettleData(userId)` returns every
  accessible trip's cost-bearing bookings, expenses, settlements, members and
  parties (rows carry `trip_id`); the Settle screen filters by `selectedTrips`
  before running `computeBalances` (pure client-side math). Multi-trip
  settling therefore works from day one: users are global (`user_id` sums
  across legs; someone on one leg only accrues from that leg), and units keyed
  by member-id set merge the same couple across trips. All Trips = the whole
  journey; no empty-state gating on selection is needed.
- **Costs page**: the splits/payer data simply rides on the union bookings the
  page already fetches; the Everyone/Me/Us toggle composes with the existing
  client-side selection filter.
- **Authorization composes**: every query joins `trip_members`, so the union
  only includes trips the viewer belongs to.
- **Creating expenses and settlements needs an explicit `trip_id`**: default
  to `selectedTrip` (the compat shim, i.e. exactly one trip selected);
  otherwise show a required trip selector — the same rule Add Booking follows.
- Nice-to-have: a "By trip" breakdown card on Costs next to "By Type" when
  several trips are selected.

---

## Files touched

New: `src/lib/split.js` · `src/actions/expenses.ts` · `src/actions/settle.ts`
· `src/components/SplitEditor.jsx` · `src/screens/Settle.jsx` ·
`src/app/(app)/settle/page.tsx` · `src/app/(app)/settle/loading.tsx` ·
`drizzle/0009_*.sql` (generated).

Modified: `src/db/schema.ts` · `src/lib/schemas.ts` · `src/lib/queries.ts` ·
`src/lib/trip-context.tsx` · `src/actions/bookings.ts` ·
`src/actions/members.ts` · `src/components/BookingForm.jsx` ·
`src/components/BookingModal.jsx` (payload pass-through) ·
`src/components/Sidebar.jsx` · `src/screens/Costs.jsx` ·
`src/app/(app)/costs/page.tsx` · `src/screens/Settings.jsx` ·
`src/lib/queries.ts` `getTripsWithMembers` (add `party_id` per member + a
`parties` list per trip — the layout already feeds it into `TripSummary`).

## Suggested commit sequence (direct-to-main workflow)

1. `feat: schema + backend for cost splits, expenses, settlements, parties` —
   schema, migration, schemas.ts, queries, actions, `split.js`.
2. `feat: booking split editor + costs page scope toggle` — SplitEditor,
   BookingForm, Costs.
3. `feat: settle-up page, expenses UI, party grouping in settings` — Settle
   page, Sidebar, Settings.

Each commit must pass lint / typecheck / build on its own.

## Edge cases & guards

- Reject `weight ≤ 0` and `Σweights = 0` (Zod + a guard in `split.js`).
- Deleting a booking/expense cascades its splits (FK); deleting a party only
  nulls `party_id`.
- The payer needn't be in the split.
- Mixed currencies: settlement netting is per-currency exact, never
  FX-converted; a settlement recorded in currency X only affects the X
  balance. Approximate `toHKD` remains Costs-page-only, always with `~`.
- `cost_share < 1` + payer: the payer is assumed to have fronted only the
  trip's effective portion (document in `split.js`).
- Placeholder (never-logged-in) members split normally — they're `users` rows.

## Verification

- `npm run lint`, typecheck, and `npm run build` all pass (no test suite in
  this repo — check `package.json` for the exact script names).
- Headless browser drive against local dev (dev-login env overrides + seeded
  PGlite, cached Chromium — the established recipe):
  1. Trip with 3+ members; group two as a couple in Settings.
  2. Set a booking's payer + equal split; add an ad-hoc expense split
     unequally (weights 2/1/1).
  3. Hand-verify Settle balances and suggested transfers against the math.
  4. Record a settlement → the corresponding per-currency net goes to ~0.
  5. Costs toggle: Everyone / Me / Us numbers consistent (Us ≈ 2× Me for an
     equal couple split); unsplit-costs footnote appears under Me/Us.
  6. Mixed currencies (e.g. HKD + JPY items): two independent per-currency
     balances and separate suggested transfers, exact amounts, no `~` on the
     Settle page.
- Justin eyeballs on the phone: SplitEditor chips (truncation), Settle page
  layout, expense form, Costs toggle, modal footer reachability on iOS Safari.
