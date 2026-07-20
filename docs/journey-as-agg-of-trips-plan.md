# Journey view — a calendar across multiple trips

**Status:** plan / not implemented.

Today the calendar shows exactly one trip (`?trip=<id>`) or "All Trips". Real
travel doesn't split that cleanly: a single run of travel is often filed as two
or three trips that butt up against each other, sometimes with a day in between.

Worked example used throughout:

| Trip | Range |
| --- | --- |
| Vancouver 2026 | … → Aug 11 |
| Alaska 2026 | Aug 13 → … |

Aug 12 belongs to neither. That day — not the trips — is the interesting part.

## Goal

1. Select **several trips at once** in the sidebar.
2. See them in the calendar as **one continuous journey**, not as separate views.
3. Make the **seams** legible: the gap days, the overlap days, and where you have
   nowhere to sleep.

---

## The view: continuous span, not a month grid

Render one day-by-day timeline from the earliest selected `start_date` to the
latest `end_date`.

A month grid is the wrong shape here: it buries Aug 12 in a cell alongside 30
irrelevant days. A continuous timeline makes the seam the point. The machinery
already exists — `getRangeGrid(start, end)` in
[`src/lib/calendar.js`](../src/lib/calendar.js) builds exactly this, and the
current **Trip** view renders it. It just takes one trip's bounds today.

**Journey replaces the Trip view.** Trip view is Journey with one trip selected;
keeping both would be two names for one thing. Month / Week / Day views stay and
simply show the union of selected trips. Journey becomes the default whenever 2+
trips are selected.

### The day is the unit; the trip is a per-item attribute

An earlier draft of this plan proposed colour-banding each *day* by its trip.
That is wrong, and the overlap case is what breaks it.

Vancouver checks out on Aug 11 and the Alaska flight departs Aug 11 — that day
sits inside **both** trips. So a day cannot carry one trip identity:

```
Aug 11
  │ Vancouver   🏡 Fairmont Pacific Rim   OUT
  │ Vancouver   🎯 Granville Island       10:00
  │ Alaska      ✈️ YVR → ANC              18:40
```

Each row carries its own trip rail; the day header stays neutral; rows sort by
time. The day then reads as an actual itinerary — check out, do the thing, fly.
This case is the strongest argument for the whole feature.

Trip identity needs a **second visual channel**, because fill colour is already
spoken for by booking type (flight blue, hotel amber — `TYPE_COLORS`). Use a thin
coloured rail on the row's leading edge plus the trip name. Do not recolour the
chips.

### Empty runs collapse — by content, not by a day count

**Rule: any maximal run of days with nothing on them collapses to a single
divider labelled with its length. Any day with content renders.**

There is deliberately **no threshold**. An earlier draft said "gaps ≤ 2 days
render inline", which was an arbitrary constant standing in for a question it
never answered.

```
Aug 11  │ Vancouver   🏡 Fairmont Pacific Rim   OUT
────────────────────────────────────────────────────
▸ 1 day — no accommodation booked
────────────────────────────────────────────────────
Aug 13  │ Alaska      ✈️ YVR → ANC
```

```
Aug 29  │ Alaska      ✈️ ANC → IAH
────────────────────────────────────────────────────
▸ 96 days
────────────────────────────────────────────────────
Dec 3   │ Japan       ✈️ IAH → NRT
```

One rule produces both. One empty day and ninety-six empty days each cost one
row and expand on click, so the layout degrades gracefully at any scale — which
is the property the constant was trying and failing to buy.

This generalises what `TripAgenda` already does ("empty days are skipped to keep
the list tight"), but improves on it: today those days vanish silently, whereas a
labelled divider says *how much* was skipped.

### Gap days: offer both trips, infer nothing

A gap day has no bookings by definition, so there is **no signal** for whether
you were leaving Vancouver or heading to Alaska. Don't guess — name both trips:

```
▸ 1 day — no accommodation booked
   add to  [ Vancouver 2026 ]  [ Alaska 2026 ]
```

Clicking moves that trip's `start_date` / `end_date` to cover the gap. This is a
real edit — the same as changing dates in Settings — and it is visible to every
member of that trip.

- **Collapsed divider** → the action covers the whole run.
- **Expanded gap** → each day gets its own pair of buttons, so a 4-day gap can be
  split 2 days trailing Vancouver, 2 leading Alaska.

It is an offer, not a demand. If you really were home those days, leave it
collapsed.

This also resolves the day-notes problem below.

---

## Two problems this fixes

### 1. Day notes and reminders have nowhere to live on a gap day

`trip_id` is `NOT NULL` on `day_notes` and `day_reminders` (migration `0006`).
Aug 12 belongs to no trip, so on the very day you most want *"drive Vancouver →
Seattle, find a hotel"* there is nowhere to put it.

| Option | Trade-off |
| --- | --- |
| **Extend a trip to cover the gap** (recommended) | No schema change. Honest if the gap really is travel-to-Alaska. This is what the gap-day action does. |
| Prompt for a trip on gap days | Keeps the model intact, adds friction. |
| Re-allow tripless notes | Reopens the cross-user hole `0006` closed. Rejected. |

### 2. "No stay" currently produces a false warning

The accommodation check is bounded by the selected trip's range and only sees
bookings in scope ([`MonthView.jsx:331`](../src/components/MonthView.jsx#L331) +
`hasOvernightCoverage`).

Viewing **only Alaska** today, Aug 11 warns "No stay" — wrong; you had a bed, it
just belonged to Vancouver. Feed it the union and the warning is correct on Aug
11 and correct on the genuine Aug 12 gap.

**Consequence:** the bound must move from *one trip's range* to *the whole
journey span*, so gap days stay in scope rather than being skipped as "outside
the trip".

---

## Implementation

### URL

`?trip=a&trip=b` — repeated params, read with `searchParams.getAll`.
Bookmarkable and shareable. All five pages currently type it as
`{ trip?: string }`; becomes `string | string[]`.

### Sidebar

A checkbox per trip:

- **Click the row** → select only that trip (preserves today's fast path).
- **Click the checkbox** → add / remove.
- Header shows `3 trips selected · Clear`.

Checkboxes beat cmd-click because they work on touch.

### Data layer

`getBookingsForUser` / `getTodosForUser` / `getDayNotesForUser` /
`getDayRemindersForUser` take `string[] | null`, swapping `eq(trip_id, x)` for
`inArray(trip_id, xs)`.

**Authorization is unaffected.** Every read is already scoped by the membership
`INNER JOIN`, so an unauthorised trip id in the URL simply yields nothing. This
was verified directly against the real query code — a non-member forcing
`?trip=<other trip>` gets 0 rows.

### Context

```
selectedTrip: string | null   →  selectedTrips: string[]
tripMeta:  TripSummary | null →  tripMetas: TripSummary[]
                              +  spanStart / spanEnd (derived)
```

Keep a `selectedTrip` compatibility getter returning the single id when exactly
one trip is selected, so `Costs`, `BookingsByType`, `BookingForm` and
`BookingModal` need no changes in phase 1.

### Blast radius

13 files reference `selectedTrip` / `tripMeta`. The heavy ones:

| File | refs |
| --- | --- |
| `MobileMonthView.jsx` | 19 |
| `Calendar.jsx` | 18 |
| `MonthView.jsx` | 14 |
| `AppShell.tsx` | 11 |
| `Sidebar.jsx` | 8 |

The rest are 2–5 each and mostly covered by the compatibility getter.

### Creating things while multi-selected

"Add Booking", day notes and reminders all need a target trip. Default to the
trip whose range contains the clicked date; if the date is ambiguous (overlap) or
a gap day, make the trip selector required. `BookingForm` already validates
`trip_id`, and already warns when a booking's dates fall outside its trip's range
— that warning becomes more likely here and is working as intended.

---

## Phasing

1. **Plumbing** — URL, context, queries, sidebar multi-select. Existing views show
   the union. Shippable alone; Month / Week / Day just work.
2. **Journey view** — continuous span, per-item trip rails, collapse-empty-runs,
   overlap days. The actual value.
3. **Gap-day actions** — "add to *trip*", per-day when expanded.

Phase 1 touches the most files; phase 2 is where the benefit is felt.

## Open questions

- Should Journey be the default for a **single** trip too, replacing Trip view
  outright? (Leaning yes — one concept instead of two.)
- Should selecting trips that are months apart prompt anything, or is a `▸ 96
  days` divider self-explanatory? (Leaning: divider is enough.)
- Does extending a trip's dates via a gap action need a confirmation, given it
  affects other trip members?
