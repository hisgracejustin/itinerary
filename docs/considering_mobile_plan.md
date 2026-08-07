# Considering — mobile List / Details view — implementation plan

**Status:** ready to implement. Design approved by Justin 2026-08-07 from three
rounds of mockups.

**Approved mockups** (open these before writing code — they are the spec):

| Mockup | URL |
| --- | --- |
| Round 1 — three layout options, current view annotated | https://claude.ai/code/artifact/ab13b18c-1777-4340-9f59-57d7971b823a |
| Round 2 — thumbnail treatments for the compare row | https://claude.ai/code/artifact/c1f56603-639e-4714-a685-d581e0cd6ce4 |
| **Round 3 — the approved design: List / Details** | **https://claude.ai/code/artifact/e893e302-9664-46e7-b5e7-ad49d3b94e78** |

Round 3 is what to build. Rounds 1–2 are context for why.

## Context

On a phone the Considering **detail view** (a decision and its options) puts the
options in a horizontal snap rail of 280 px cards
([`src/screens/Considering.jsx:1565`](../src/screens/Considering.jsx#L1565)).
You see one card and a sliver of the next. The card itself was sized for a
desktop grid column and never re-flowed for the narrower one, so inside 280 px:

1. There is no option count or pager — the neighbouring card's edge is the only
   clue more exist.
2. Pros and cons sit in a 2-column grid inside ~248 px of content width, so
   every bullet wraps to two or three lines at 12 px.
3. The four action buttons wrap onto two rows, the delete can is orphaned, and
   the targets are ~30 px tall — under the 44 px touch minimum.

Desktop is fine: `sm:grid sm:grid-cols-2 xl:grid-cols-3` shows everything at
once, which is exactly what the phone lacks.

Goal: give the phone both halves of what desktop gives — *all options at a
glance* and *one option read properly* — as two views behind a toggle.

## Decisions already made — do not re-litigate

1. **Two mobile views behind a segmented toggle labelled `List` / `Details`.**
   Earlier drafts called it Compare/Cards; Justin rejected those labels as
   unclear. The labels are final.
2. **List is the dense row** — 48 px thumbnail, one truncated title line, a
   subtitle of `Picked · ✓ 3 · ✕ 1`, and price with its difference from the
   cheapest. No buttons in the row.
3. **Details is the full card** — 96 px thumbnail (NOT a full-width hero photo;
   a hero puts you back to one option per screen, which is the original
   complaint), all pros and cons in one full-width column, collapsible notes,
   and a 3-target action row.
4. **Tapping a List row switches to Details and scrolls to that card**, which
   flashes briefly. There is **no detail sheet / modal** — that component was
   deliberately designed out so the back gesture keeps meaning "leave this
   decision".
5. **Price comparison is a `+delta` number, not a bar.** An earlier mockup drew
   a teal progress bar whose fill grew with price; Justin flagged that a filling
   bar reads as *more is better* when it means *more expensive*. The bar is
   gone. Under each price, show what that option costs over the cheapest one.
6. **Desktop is untouched.** Everything here is scoped below the `sm`
   breakpoint (640 px). Above it the existing grid of `OptionCard` renders
   exactly as it does today.
7. **The view choice persists per decision**, so reopening a decision resumes
   where you left it. Default is **Details**.

## Existing infrastructure to reuse — do NOT reinvent

| What | Where |
| --- | --- |
| The screen being changed | [`src/screens/Considering.jsx`](../src/screens/Considering.jsx) — `Considering` default export, detail branch starts at the `// Detail / comparison board` comment (~line 1459) |
| Existing option card (desktop) | `OptionCard` in the same file (~line 820) — **leave its rendering alone** |
| Existing photo carousel | `ImageCarousel` in the same file (~line 209) — 160 px hero, dots, prev/next |
| Price sorting (unpriced always last) | `sortOptionsByPrice` in [`src/lib/considering-state.js`](../src/lib/considering-state.js) |
| Pure-helper unit tests | [`tests/considering-state.test.ts`](../tests/considering-state.test.ts) — `node:test`, `assert/strict` |
| Money formatting | `formatCurrency(amount, currency)` in [`src/lib/currencies.js`](../src/lib/currencies.js) — symbol + locale digits, 0 decimals for JPY/KRW/TWD |
| Type emoji for placeholders | `TYPE_ICONS` from [`src/lib/calendar.js`](../src/lib/calendar.js), already imported |
| Photo bytes | `GET /api/option-images/:id` — already what `ImageCarousel` uses |
| Delete confirmation | `useConfirmDanger()` → `ask({title, message, confirmLabel})`, already wired in the screen as `ask` / `confirmDialog` |
| Toasts, in-flight guard | `useToast()`, `runVisibleAction(key, label, op)`, `pendingAction` — all already in the screen |
| Design system | `.mat-surface`, `.mat-btn-filled`, `.mat-btn-outlined`, `.mat-icon-btn` in [`src/app/globals.css`](../src/app/globals.css); colour tokens `primary`, `primary-light`, `accent-ink`, `on-surface`, `on-surface-variant`, `outline`, `outline-variant`, `surface-container` |

The handlers you need already exist in the screen and must be reused as-is —
`markPick`, `deleteOption`, `openBook`, `setOptionModal`, `toggleOptionNotes`,
`expandedNoteIds`, `priceSort`, `activeOptions`, `hasMixedCurrencies`.

---

## Step 1 — price helpers (pure, tested)

Add to [`src/lib/considering-state.js`](../src/lib/considering-state.js):

```js
/**
 * Cheapest-option summary for a decision's options.
 * Amounts are only comparable within a single currency — the app never
 * FX-converts for anything a user acts on.
 */
export function summarizePrices(options) {
  const priced = (options || []).filter((o) => {
    const amount = o?.cost_amount == null ? null : Number(o.cost_amount);
    return Number.isFinite(amount) && !!o?.cost_currency;
  });

  const currencies = new Set(priced.map((o) => o.cost_currency));
  if (priced.length < 2 || currencies.size !== 1) {
    return { comparable: false, currency: null, cheapestIds: new Set(), deltas: new Map() };
  }

  const amounts = priced.map((o) => Number(o.cost_amount));
  const min = Math.min(...amounts);
  const cheapestIds = new Set(priced.filter((o) => Number(o.cost_amount) === min).map((o) => o.id));
  const deltas = new Map(priced.map((o) => [o.id, Number(o.cost_amount) - min]));

  return { comparable: true, currency: priced[0].cost_currency, cheapestIds, deltas };
}
```

Rules encoded above, all deliberate:

- **Fewer than 2 priced options → not comparable.** "Cheapest" is meaningless
  against nothing.
- **Mixed currencies → not comparable.** The screen already computes
  `hasMixedCurrencies` for its sort warning; this is the same rule.
- **Ties both get the badge.** Two options at HK$3,200 are both the cheapest;
  do not tie-break arbitrarily.
- Unpriced options are absent from `deltas` — callers render nothing for them.

Add tests to [`tests/considering-state.test.ts`](../tests/considering-state.test.ts)
in the existing style (`node:test` + `assert/strict`), covering: single priced
option, mixed currencies, a tie at the minimum, unpriced options excluded, and
correct deltas.

## Step 2 — new file for the mobile components

Create **`src/components/ConsideringOptions.jsx`** with `"use client"` at the
top. `Considering.jsx` is already ~1630 lines; new UI goes here so the diff
stays reviewable. It holds presentational components only — all state and all
server calls stay in the screen and arrive as props.

Export four components, specified in Steps 3–6.

## Step 3 — `OptionListRow` (the List row)

```jsx
export function OptionListRow({ option, isCheapest, delta, currency, onOpen })
```

Renders a single `<button type="button">` — the whole 70-ish px row is the tap
target, and it must contain no nested buttons.

```
[ 48px thumb ] [ title (truncated)          ] [ HK$4,850 ]
               [ Picked · ✓ 2 · ✕ 1         ] [ +1,650   ]
```

- Root: `w-full text-left mat-surface !rounded-2xl px-3 py-2.5 flex items-center gap-3 active:scale-[0.99] transition-transform`
- Picked option: add `ring-2 ring-primary`.
- **Thumb**: `w-12 h-12 rounded-[9px] overflow-hidden shrink-0 bg-surface-container`.
  With images: `<img src={`/api/option-images/${option.images[0].id}`} alt="" loading="lazy" className="w-full h-full object-cover" />`.
  Without: centred `TYPE_ICONS[type]` emoji at `text-lg opacity-60` — never an
  empty or stretched box. Pass the decision's `type` down for this.
- **Text column**: `flex-1 min-w-0` — the `min-w-0` is required or `truncate`
  will not truncate inside a flex row.
  - Title: `truncate text-[14.5px] font-semibold leading-tight`
  - Subtitle: `truncate text-xs text-on-surface-variant`, built from parts
    joined with ` · `: `"Picked"` when `option.is_pick`, `"Booked"` when
    `option.converted_booking_id`, then `✓ {pros.length}` and `✕ {cons.length}`
    (omit a count that is 0; if there are no pros, no cons, and no flags, fall
    back to the first line of `notes`, else render nothing).
- **Amount column**: `shrink-0 text-right`
  - `formatCurrency(option.cost_amount, option.cost_currency)` at
    `text-base font-semibold tabular-nums`, or `No cost` at
    `text-xs text-on-surface-variant` when unpriced.
  - Under it, `text-[10px] tabular-nums`:
    - `cheapest` in `text-emerald-700 font-semibold` when `isCheapest`
    - `+{delta.toLocaleString()}` in `text-on-surface-variant` when `delta > 0`
    - nothing when the set is not comparable
  - No currency symbol on the delta — it sits directly under the amount that
    carries one.

## Step 4 — `MobileOptionCard` (the Details card)

```jsx
export function MobileOptionCard({
  option, tripType, isCheapest, pending, notesOpen,
  onNotesToggle, onEdit, onDelete, onPick, onBook, onOpenPhotos,
})
```

Same data as the desktop `OptionCard`, re-flowed. Mirror `OptionCard`'s existing
logic for `renderSoftMarkdown(option.notes)`, the picked ring, and the
`Booked`/disabled state of the book button — read it before writing this.

- Root `<article className="mat-surface overflow-hidden scroll-mt-28">`, plus
  `ring-2 ring-primary` when picked. **`scroll-mt-28` is required** — the detail
  header at `Considering.jsx:1469` is `sticky top-0`, and without a scroll
  margin the jump from Step 7 parks the card's title underneath it.
- Keep the existing `Picked` flag ribbon from `OptionCard`.
- **Header**: `grid grid-cols-[96px_minmax(0,1fr)] gap-3 p-3 items-start`
  - Thumb: 96 px square, `rounded-xl`, same image/placeholder rules as Step 3.
    When the option has images, wrap it in a `<button>` calling `onOpenPhotos()`
    and overlay a count badge (`{option.images.length}`) bottom-right in
    `bg-black/55 text-white text-[10px] rounded-full px-1.5`.
  - Meta column: title `text-[15px] font-semibold leading-snug`; the existing
    `View listing →` anchor when `option.url`; then a price row —
    `formatCurrency(...)` at `text-xl font-semibold tabular-nums` (or the
    existing `No cost set` fallback) followed by a `Cheapest` chip when
    `isCheapest` (`text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5`).
- **Pros and cons — one merged full-width list, no headings**:
  `<ul className="flex flex-col gap-1 text-sm">`, each item
  `grid grid-cols-[16px_minmax(0,1fr)] gap-1.5`, pros first with a
  `text-emerald-700 font-bold` `✓`, then cons with a `text-red-700 font-bold`
  `✕`, and the text itself in `text-on-surface`. Render nothing when both are
  empty. This is the fix for problem 2 — do not reuse the `grid-cols-2` block.
- **Notes**: same `<details>` + `renderSoftMarkdown` block as `OptionCard`,
  wired to the same `notesOpen` / `onNotesToggle` props so `Expand all notes`
  keeps working.
- **Actions**: `flex gap-2` with three targets, all `min-h-[44px]`:
  - `Book this` — `mat-btn-filled flex-1`, disabled when
    `pending || option.converted_booking_id`, labelled `Booked` in that case
    (copy the existing logic).
  - `Pick` / `Unpick` — `mat-btn-outlined flex-1`, filled variant when picked
    (as `OptionCard` does today).
  - `⋯` — `OverflowMenu` (Step 5) at `w-11 shrink-0`, containing **Edit** and
    **Delete**.

## Step 5 — `OverflowMenu`

```jsx
export function OverflowMenu({ items, disabled })  // items: [{label, onSelect, danger?}]
```

A small popover — there is no menu primitive in the codebase yet, so build a
minimal one and keep it local to this file:

- Trigger `<button type="button" className="mat-btn-outlined w-11 !px-0 min-h-[44px] justify-center" aria-haspopup="menu" aria-expanded={open}>⋯</button>`
- Panel absolutely positioned, `right-0 bottom-full mb-1 z-20 min-w-[160px] mat-surface py-1 shadow-elevation-2`, `role="menu"`, items are
  `<button role="menuitem" className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-container">`, danger items in `text-red-600`.
- Close on: item select, `Escape` (return focus to the trigger), and a
  `pointerdown` listener on `document` that fires when the event target is
  outside the menu root. Clean the listener up in the effect's teardown.
- Deleting goes through the screen's existing `deleteOption`, which already
  raises the `ConfirmDanger` dialog — do not add a second confirmation.

## Step 6 — `PhotoLightbox`

```jsx
export function PhotoLightbox({ images, startIndex, onClose })
```

Full-screen photo viewer, since mobile Details only shows the first photo:

- `fixed inset-0 z-50 bg-black/95 flex flex-col`, rendered only when open.
- Image centred at `max-h-full max-w-full object-contain`; prev/next taps on the
  left/right thirds plus visible `‹` / `›` buttons at 44 px; a dot row and an
  `n / total` counter; a `✕` close button top-right at 44 px.
- Close on `Escape`; set `document.body.style.overflow = "hidden"` while open
  and restore it on unmount.
- Keep it dumb — index lives in local state, `onClose` is the only callback.

This step is separable. If it runs long, ship Steps 1–5 and 7 first, and have
the thumbnail do nothing until this lands.

## Step 7 — wire it into the screen

All edits in [`src/screens/Considering.jsx`](../src/screens/Considering.jsx),
inside the detail branch (after the `// Detail / comparison board` comment).

**7a. State.** Alongside the existing `priceSort` / `expandedNoteIds`:

```js
const [optionView, setOptionView] = useState("details");   // "list" | "details"
const [jumpToId, setJumpToId] = useState(null);
const [photoOption, setPhotoOption] = useState(null);
const cardRefs = useRef(new Map());
```

**7b. Persistence.** Per decision, under `considering-view:${activeId}`.
Read it in an effect, never during render — a `localStorage` read in the render
path breaks SSR hydration in Next 16:

```js
useEffect(() => {
  if (!activeId) return;
  const saved = window.localStorage.getItem(`considering-view:${activeId}`);
  setOptionView(saved === "list" || saved === "details" ? saved : "details");
}, [activeId]);
```

Write it in the toggle handler, wrapped in `try/catch` (Safari private mode
throws). Note the existing effect at ~line 1004 already resets `priceSort` and
`expandedNoteIds` on `activeId` change — leave it alone and add this one
separately.

**7c. Derived values**, next to the existing `activeOptions` memo:

```js
const priceSummary = useMemo(() => summarizePrices(active?.options || []), [active?.options]);
```

**7d. The toggle.** Render directly under the sticky decision header, inside a
`sm:hidden` wrapper. Only when `(active.options || []).length >= 2` — with one
option there is nothing to compare, so force Details and hide the control.

Segmented control matching the mockup: `flex bg-surface-container rounded-full p-[3px] gap-[3px]`, each button
`flex-1 min-h-[38px] rounded-full text-[13.5px] font-medium`, selected gets
`bg-white text-accent-ink font-semibold shadow-elevation-1`, unselected
`text-on-surface-variant`. Use `role="tablist"` / `role="tab"` with
`aria-selected`.

When switching **to List** while `priceSort` is `null`, also call
`setPriceSort("asc")` — the deltas only make sense against a sorted column, and
setting it visibly (the chip label changes to `Price: low → high`) keeps it from
looking like magic.

**7e. Replace the option container.** The current block at line 1565 is:

```jsx
<div className="flex gap-4 overflow-x-auto snap-x pb-4 mb-8 sm:grid sm:grid-cols-2 xl:grid-cols-3 sm:overflow-visible sm:snap-none">
```

Split it into two siblings — a mobile branch and the untouched desktop grid:

```jsx
{/* mobile */}
<div className="sm:hidden mb-8">
  {optionView === "list" ? (
    <div className="flex flex-col gap-1.5">{/* OptionListRow per option */}</div>
  ) : (
    <div className="flex flex-col gap-3">{/* MobileOptionCard per option */}</div>
  )}
  {/* the existing dashed "Add option" button, full width */}
</div>

{/* desktop — unchanged behaviour */}
<div className="hidden sm:grid sm:grid-cols-2 xl:grid-cols-3 gap-4 pb-4 mb-8">
  {/* the existing OptionCard map and dashed Add button, minus the w-[280px]
      shrink-0 snap-start wrappers, which only existed for the mobile rail */}
</div>
```

Both branches iterate `activeOptions` so sorting is shared. Both are in the DOM
at all times — that is fine, and the duplicate `<img>` for `images[0]` resolves
to one HTTP request because the URL is identical.

**7f. Toolbar.** The existing chip row at ~line 1531 stays, with one change:
render `Expand all notes` only when `optionView === "details"` on mobile (it
does nothing in List). `Sort by price` shows in both. Keep the existing
mixed-currency note.

**7g. Tap-through.** `OptionListRow`'s `onOpen` does:

```js
const openOption = (optionId) => {
  setOptionView("details");
  persistView("details");
  setJumpToId(optionId);
};
```

and an effect performs the scroll once Details has rendered:

```js
useEffect(() => {
  if (!jumpToId || optionView !== "details") return;
  const node = cardRefs.current.get(jumpToId);
  if (!node) { setJumpToId(null); return; }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  node.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  node.classList.add("ring-2", "ring-primary/60");
  const timer = setTimeout(() => {
    node.classList.remove("ring-2", "ring-primary/60");
    setJumpToId(null);
  }, 1400);
  return () => clearTimeout(timer);
}, [jumpToId, optionView]);
```

Guard the flash so it does not strip the permanent ring from a picked option —
check `option.is_pick` before removing the classes, or apply the flash with a
distinct class the picked ring does not use.

## Edge cases to handle

| Case | Expected |
| --- | --- |
| Option with no photos | Category emoji on `surface-container`, both views. Never an empty or stretched box; no photo-count badge; thumbnail is not tappable |
| Option with no cost | `No cost` in List, `No cost set` in Details; no delta; sorts last (existing `sortOptionsByPrice` behaviour) |
| Mixed currencies | No `Cheapest` chip, no deltas, existing "compared without currency conversion" note still shows when sorting |
| Two options tied at the lowest price | Both get the chip, both have delta 0 (render nothing under them) |
| One option in the decision | Toggle hidden, Details forced |
| Zero options | Existing empty state / dashed Add button only; no toggle |
| Long title | List truncates to one line with an ellipsis; Details wraps (no clamp) |
| Option already booked | Book button reads `Booked` and is disabled in both places, as today; List subtitle shows `Booked` |
| In-flight action | Every button respects the existing `pending` prop |

## Verification

Run all four — Justin's deploy is direct-to-main and there is no staging:

```
npm run lint
npm run typecheck
npm test
npm run build
```

Then check by hand at 390 px (Chrome device toolbar is enough) on a decision
with 3+ options, at least one unpriced and one with no photos:

1. Toggle switches views; the choice survives leaving the decision and coming back.
2. Tapping a List row lands on that card, fully visible below the sticky header, with a brief flash.
3. Pros and cons are one column, no bullet wraps to a second line.
4. Book / Pick / ⋯ are all ≥44 px; Edit and Delete work from the menu; Delete still raises the danger dialog.
5. `Expand all notes` and `Sort by price` still work, and sorting is shared by both views.
6. At ≥640 px the page is visually identical to `main` — diff a screenshot if unsure.

There is a headless-browser recipe used on this repo (dev-login env overrides,
seeded PGlite, cached chromium) — see the browser scenario notes in
[`docs/split_expenses_plan.md`](./split_expenses_plan.md) and
[`scripts/ui-test-day-notes.mjs`](../scripts/ui-test-day-notes.mjs) for the
pattern if you want to drive this end to end.

## Out of scope

- Any change to the decisions **index** (the list of decision cards before you
  open one) — this plan only touches the detail view.
- Desktop layout, `OptionCard`'s rendering, `OptionForm`, `DecisionForm`,
  booking conversion, image upload.
- Currency conversion of any kind.
- A detail sheet or modal for an option — deliberately designed out (decision 4).

## Follow-ups worth a separate todo

- The same 48 px row would suit the decisions index on mobile.
- `Expand all notes` could remember its state per decision the way the view does.
