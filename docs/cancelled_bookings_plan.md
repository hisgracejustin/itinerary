# Cancelled bookings — implementation plan

**Status:** planned, not started. Scope confirmed with Justin (2026-08-23).

## Context

A booking sometimes gets cancelled after it's recorded. Deleting it is wrong —
it destroys the confirmation number, the attachments, the audit trail and the
memory that the trip once had that shape. What's needed is a **cancelled** state
that keeps the row intact but takes it out of the money.

Goal: mark a booking cancelled; it stops contributing to the /costs total, the
By Type bars and the settle balances, and the trip gains a visible "cancelled"
figure so the money that evaporated is still legible.

Decisions confirmed with Justin (2026-08-23) — **do not re-litigate**:

1. **A cancellation can keep money.** A change fee, a forfeited deposit, a
   non-refundable first night. That retained amount is real spend and must still
   split between the same people. Hence `retained_amount`, not a bare boolean.
2. **The retained amount counts toward the main /costs total.** The cancelled
   booking's *original* value never does. With `retained_amount = 0` — the
   common case — a cancelled booking contributes exactly nothing, which is the
   behaviour asked for.
3. **Cancelled bookings stay visible on the calendar**, struck through and
   dimmed with a Cancelled chip, rather than being hidden behind a toggle. The
   trip's historical shape and the gap left behind are both worth seeing.
4. **Reversible.** Reinstating is one toggle and clears `retained_amount`.

### Existing infrastructure to reuse — do NOT reinvent

| What | Where |
| --- | --- |
| The two chokepoints every money surface funnels through | `bookingCostItem` in [`src/lib/cost-items.js`](../src/lib/cost-items.js), `bookingItem` in [`src/lib/split.js`](../src/lib/split.js) |
| Proportional re-scaling of an item's shares + funding | `settleDenomination` / `settleRate` in [`src/lib/split.js`](../src/lib/split.js) — cancellation is the same mechanism with a different factor |
| What a cancellation *should* refund | `refundableAsOf`, `applicableTier` in [`src/lib/cancellation.js`](../src/lib/cancellation.js) |
| Booking update path (authz, audit, revalidate) | `updateBookingAction` in [`src/actions/bookings.ts`](../src/actions/bookings.ts) |
| Audit diffing | `bookingAuditChanges`, `BookingSnapshot` in [`src/lib/audit.ts`](../src/lib/audit.ts) |
| Destructive-action confirm UI | [`src/components/ConfirmDanger.jsx`](../src/components/ConfirmDanger.jsx) |
| Filter pills | [`src/components/FilterChip.jsx`](../src/components/FilterChip.jsx) |
| Money helpers | `toHKD`, `formatCurrency` in [`src/lib/currencies.js`](../src/lib/currencies.js) |

## Data model

Two new columns on `bookings` (migration `drizzle/0028_*`):

```ts
// When this booking was cancelled, or null for a live booking. A TIMESTAMP
// rather than a status enum: null/not-null is the predicate every query wants,
// and "cancelled on 12 Aug" is worth knowing. Stamped server-side — the client
// sends a boolean, never a date (see updateBookingAction).
cancelled_at: timestamp("cancelled_at", { withTimezone: true }),

// What the provider KEPT when this booking was cancelled — a change fee, a
// forfeited deposit — expressed in cost_currency. This IS the booking's
// effective cost once cancelled: it replaces `cost_amount × cost_share`
// outright rather than being subtracted from it, so a stale cost_amount can
// never leak into the total. 0 (the default, and the common case) means the
// cancellation cost nothing and the booking contributes nothing anywhere.
//
// NOT share-scaled, matching the `amount`/`fee` tiers in cancellation.js —
// it is the figure the trip actually lost, as typed.
//
// Meaningless while cancelled_at is null, and cleared when a booking is
// reinstated, so a stale value can't reappear on a re-cancel.
retained_amount: numeric("retained_amount", { mode: "number" }).notNull().default(0),
```

Nothing is backfilled — every existing row reads as live, which is correct.

### Semantics (put these in doc comments on `cost-items.js` and `split.js`)

The single rule the whole feature reduces to:

```
effectiveCost(b) = b.cancelled_at ? b.retained_amount : b.cost_amount × b.cost_share
```

and a companion factor for anything expressed as an absolute per-person figure:

```
retentionFactor(b) = b.cancelled_at
  ? (original > 0 ? b.retained_amount / original : 0)   // original = cost_amount × cost_share
  : 1
```

- **Split rows are stored at original scale and never rewritten by a
  cancellation.** Cancelling is not an edit of who owed what; it's a change to
  how much there is to owe. Reinstating must restore the old numbers exactly,
  which is only true if they were never touched.
- **`extra_amount` scales by `retentionFactor`.** Weights are ratios and need no
  help, but an extra is an absolute figure: a 447 baggage extra against a 500
  retained amount would otherwise hand that person 447 and leave 13 for
  everyone else. The baggage was refunded too. This is exactly what
  `settleDenomination` already does for charged rates — scale shares and funding
  by one common factor and both proportions and the zero-sum invariant survive.
- **`paid_amount` scales by the same factor.** The payer fronted the full amount
  and got the refund back on their own card; what's left outstanding is the
  retained fraction of every contribution. Zero-sum holds:
  `Σ share_i = retained = Σ funding`.
- **A charged rate composes on top**, unchanged. The two factors multiply; order
  doesn't matter.
- **`retained_amount > cost_amount × cost_share` is allowed but odd** (a fee
  larger than the booking). Don't clamp it in the math — clamping would hide a
  data-entry error behind a plausible number. Warn in the form instead.

## Backend

### Schema ([`src/lib/schemas.ts`](../src/lib/schemas.ts))

Add to `bookingBaseShape`:

```ts
// The client sends INTENT, not a timestamp: the server owns the clock, so a
// cancellation date can't be forged and the audit diff reads as a clean
// no → yes. `undefined` leaves the state untouched on a partial update.
cancelled: z.boolean().optional(),
retained_amount: z.number().finite().nonnegative().nullish(),
```

`cancelled_at` itself is **never** accepted from the client.

New `superRefine`: `retained_amount > 0` requires `cancelled === true` (or an
already-cancelled booking) — a live booking with a retained fee is nonsense and
should fail loudly rather than sit there invisibly.

### Action ([`src/actions/bookings.ts`](../src/actions/bookings.ts))

In `updateBookingAction`, after parsing, map intent to columns:

```ts
const { cancelled, ...rest } = parsed;
// Re-cancelling an already-cancelled booking must NOT restamp the date —
// `existing.cancelled_at ?? new Date()` keeps the original cancellation day
// through later edits.
if (cancelled !== undefined) {
  updates.cancelled_at = cancelled ? (existing.cancelled_at ?? new Date()) : null;
  if (!cancelled) updates.retained_amount = 0;   // reinstating clears the fee
}
```

**The existing `contributed > splittable` guard must keep using the
pre-cancellation splittable** (`cost_amount × cost_share`). Split rows stay at
original scale by design, so measuring them against the retained amount would
reject the cancellation of any booking that had separate contributions — the
exact case the feature exists for.

`createBookingAction` needs nothing: nobody creates a booking cancelled.

### Queries ([`src/lib/queries.ts`](../src/lib/queries.ts))

`getSettleData` filters `isNotNull(cost_amount)` today. Add:

```
and(..., or(isNull(cancelled_at), gt(retained_amount, 0)))
```

Without this, a cancelled booking with no splits sits under **Needs attention**
as "unallocated" forever — a permanent false alarm about money that no longer
exists. `getBookingsForUser` returns everything unchanged; the screens decide.

### Audit ([`src/lib/audit.ts`](../src/lib/audit.ts))

Add `cancelled_at` and `retained_amount` to `BookingSnapshot`. In
`bookingAuditChanges`, emit a `cancelled` change rendered as the state, not the
timestamp (`"no" → "yes"`), plus `retained_amount` through the existing `money()`
helper so it reads as currency. This is precisely the sort of edit that gets
queried three months later.

## Shared derivation — `src/lib/cost-items.js`

Export the rule once so no surface can disagree with another:

```js
export const isCancelled = (b) => !!b.cancelled_at
export function bookingEffective(b) { … }     // the effectiveCost rule above
export function retentionFactor(b) { … }
/** Split rows rescaled for a cancellation. Identity when live. */
export function scaledSplits(b, splits) { … }  // extra_amount & paid_amount × factor
```

`bookingCostItem` gains `cancelled: isCancelled(b)`, `original:
b.cost_amount × b.cost_share` (what it *would* have cost), sets `effective` from
`bookingEffective`, and runs its splits through `scaledSplits`. `itemContribution`
then needs no change at all — it divides whatever `effective` says.

`bookingItem` in [`src/lib/split.js`](../src/lib/split.js) does the same, and
must return `null` for a cancelled booking with `retained_amount = 0` so it never
reaches the unallocated/missing-payer buckets.

## UI

### 1. BookingModal ([`src/components/BookingModal.jsx`](../src/components/BookingModal.jsx))

- **View mode:** a cancelled booking opens under a muted banner — "Cancelled 12
  Aug · HK$500 kept" — with a **Reinstate** button. Everything else stays
  readable; attachments and confirmation number are the reason the row survived.
- **Edit-mode footer:** a **Mark cancelled** action beside Delete Booking,
  styled below Delete's severity (this is reversible; deletion is not).
- **The cancel panel** (same inline-confirm pattern as `showDelete`, not a
  second modal): asks *"How much did the provider keep?"*, prefilled from
  `refundableAsOf(policy, effective, now)` as `effective − refundable` when a
  cancellation policy is on file, and 0 otherwise. Show both directions — typing
  "kept" fills "refunded" and vice versa — since the number a person actually
  knows is usually the refund. Store the retained side.

  This is where all the cancellation-policy machinery finally pays off at the
  moment it was built for.

### 2. Costs ([`src/screens/Costs.jsx`](../src/screens/Costs.jsx))

- Cancelled items with `retained = 0` drop out of `scopedAll` entirely, and with
  them the total, currency pills, By Type bars and the All Costs list.
- A cancelled item with `retained > 0` stays in all of those at its retained
  value, its list row struck through with a `Cancelled` chip and the retained
  amount labelled as a fee.
- **New Cancelled card**, below the Total: the original value of everything
  cancelled, the count, and — when non-zero — how much of it was kept. Give the
  original figure the muted/struck treatment so it never reads as spend.
- **It must follow the Everyone / Me / Us chips** like every other card on this
  page (standing rule). Under "Me" it's the viewer's share of the cancelled
  value: `itemContribution` against the item's `original`, not its `effective`.
- `missingPolicy` should skip cancelled bookings — nagging for a cancellation
  policy on something already cancelled is noise.

### 3. Refund ([`src/screens/Refund.jsx`](../src/screens/Refund.jsx))

Skip cancelled bookings outright, alongside the existing "already underway"
guard around line 127. There is nothing left to cancel, and leaving them in
would inflate the refundable headline with money that has already been settled
one way or the other.

### 4. Calendar surfaces

`line-through`, reduced opacity and a small `Cancelled` chip in
[`BookingCard`](../src/components/BookingCard.jsx),
[`MonthView`](../src/components/MonthView.jsx),
[`WeekView`](../src/components/WeekView.jsx),
[`DayView`](../src/components/DayView.jsx),
[`JourneyView`](../src/components/JourneyView.jsx),
[`TripAgenda`](../src/components/TripAgenda.jsx) and the offline day sheet.

**Two correctness landmines in [`src/lib/calendar.js`](../src/lib/calendar.js),
both of which quietly lie to the user if missed:**

- `hasOvernightCoverage` must not count a cancelled stay. Otherwise the app
  tells you you have a bed on a night you have nowhere to sleep — the single
  worst failure this feature could introduce.
- `makeZoneResolver` in [`src/lib/booking-zones.js`](../src/lib/booking-zones.js)
  infers a booking's timezone from surrounding flights. A cancelled flight is a
  journey that didn't happen and must not place anything; skip cancelled rows
  when building the resolver.

### 5. By-type pages ([`src/screens/BookingsByType.jsx`](../src/screens/BookingsByType.jsx))

Exclude cancelled bookings from `getBookingStats` — a cancelled flight is not
12 hours in the air and a cancelled hotel is not 3 nights. Keep them in the
list, struck through, with a `Cancelled (n)` FilterChip to hide them; the chip
appears only when the current filter actually contains one.

### Mobile checklist (the app is phone-first)

- The Cancelled card must not push the Total below the fold on a phone —
  consider folding it into the Total card as a secondary line when the count
  is small.
- The banner/chip title spans need `truncate` inside their flex rows (standing
  lesson: pills in flex rows wrap ugly on mobile without it).
- The retained-amount panel's two inputs stack on narrow screens.
- Action buttons in the cancel panel fire on `mousedown` with a ref guard, per
  the blur-save lesson — Safari blurs regardless of what chromium does.

## Files touched

| File | Change |
| --- | --- |
| `src/db/schema.ts` + `drizzle/0028_*` | two columns, documented |
| `src/lib/schemas.ts` | `cancelled` / `retained_amount` + refine |
| `src/actions/bookings.ts` | intent → timestamp mapping; guard fix |
| `src/lib/queries.ts` | settle filter |
| `src/lib/audit.ts` | snapshot + diff |
| `src/lib/cost-items.js` | the shared rule; `bookingCostItem` |
| `src/lib/split.js` | `bookingItem` scaling |
| `src/lib/calendar.js`, `src/lib/booking-zones.js` | coverage + zone inference |
| `src/lib/bookingStats.js` | exclude cancelled |
| `src/components/BookingModal.jsx` | cancel/reinstate UI |
| `src/components/BookingCard.jsx` + 5 calendar views + sheet | struck styling |
| `src/screens/Costs.jsx` | Cancelled card, exclusions |
| `src/screens/Refund.jsx` | skip cancelled |
| `src/screens/BookingsByType.jsx` | stats + chip |
| `tests/split.test.ts`, new `tests/cancelled-bookings.test.ts` | see below |

## Suggested commit sequence (direct-to-main workflow)

1. Migration + schema + zod + action + audit — the state exists and round-trips,
   nothing reads it yet.
2. `cost-items.js` / `split.js` rule + tests — the money is correct before any
   pixel moves.
3. Costs card, Refund exclusion, settle query filter.
4. Calendar/journey/sheet styling + the coverage and zone-inference guards.
5. By-type stats + chip.

## Edge cases & guards

- **Cancelled + no splits + `retained = 0`** → invisible to settle, no "needs
  attention" row. Covered by the query filter.
- **Cancelled + `retained > 0` + no payer** → still a real unallocated cost and
  *should* appear under Needs attention. Don't over-filter.
- **`retained_amount` with `cost_amount = null`** — an unpriced booking that was
  cancelled with a fee. `retentionFactor` divides by zero; return 0 and let the
  retained amount stand on its own as the effective cost.
- **A cancelled booking moved to another trip** — nothing special, but the audit
  diff should show both changes.
- **Reinstating restores the previous split arithmetic byte-for-byte**, because
  the rows were never rewritten. Worth an explicit test.
- **An option converted into a booking that is later cancelled** —
  `options.converted_booking_id` still points at it, which is correct: the
  decision was made, then undone. Out of scope for this change.

## Verification

Beyond `npm run lint && npm run typecheck && npm test && npm run build`:

- Unit: a 4-way HK$15,061 flight with one 447 baggage extra, cancelled retaining
  HK$500 → each share is `500/4` scaled with the extra held in proportion, and
  `Σ shares == 500 == Σ funding`.
- Unit: cancelled with `retained = 0` → `bookingItem` returns null, the item
  reaches neither `unallocated` nor `missingPayer`.
- Unit: cancel then reinstate → balances identical to before, to the cent.
- Unit: a cancelled hotel does not satisfy `hasOvernightCoverage`.
- Browser (per the headless recipe in project memory): cancel a real booking
  from the modal, confirm the /costs total drops by its full value, the
  Cancelled card shows it, the calendar row goes struck, and Me/Us scope the
  cancelled figure correctly.
