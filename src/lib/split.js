/**
 * Settlement math — pure functions, no DB access, no React. Style mirrors
 * src/lib/bookingStats.js.
 *
 * Everything here is PER-CURRENCY EXACT. `toHKD` (the approximate static FX
 * table in ./currencies) MUST NOT appear in this file: it exists only for cost
 * *exploration* on the Costs page (totals/sorting/bars, always rendered with a
 * `~` prefix) and must never determine what people actually owe each other.
 *
 * Semantics:
 *  - Splittable amount of a booking = `cost_amount × cost_share` — the same
 *    "effective cost" the Costs screen and bookingStats.spendStat use.
 *    `cost_share` keeps its meaning ("the trip's portion of an externally shared
 *    cost"); the per-person split divides what's left. An expense's splittable
 *    amount is simply `amount`.
 *  - A person's share of an item, with itemized EXTRAS attributed to specific
 *    people (e.g. one traveller's baggage on a shared flight):
 *        sumExtras = Σ extra_amount over the item's rows
 *        remainder = splittable − sumExtras
 *        share_i   = extra_i + (weight_i / Σweights) × remainder
 *    Extras come off the top; the remainder divides by weight exactly as before.
 *    With every extra_amount = 0 this is identical to the old pure-weight split,
 *    so historical rows behave byte-for-byte the same. Zero-sum holds:
 *    Σ share_i = sumExtras + remainder = splittable = what the payer fronted.
 *    Example: a HK$15,061 flight split 4 ways at weight 1, where one person has
 *    a 447 baggage extra → that person owes 447 + 14,614/4 = 4,100.50 and each
 *    of the other three owes 3,653.50. An extras-only participant sits at
 *    weight 0 (they owe just their extra). Equal split = everyone at weight 1,
 *    no extras. A couple included "as a couple" = both members present at
 *    weight 1 each (they consume 2 of N shares). Parties never appear in split
 *    rows — they only aggregate at settlement/display time.
 *  - Guard: if Σextras exceeds the splittable amount (beyond a 0.01 tolerance)
 *    the item is skipped rather than dividing a negative remainder (which would
 *    poison balances). Likewise, a positive remainder with Σweights ≤ 0 has
 *    nothing to divide by, so that item is skipped too; but Σweights = 0 with
 *    extras that cover ≈ the whole amount is fine — the extras just apply.
 *  - No split rows ⇒ the item is UNALLOCATED: excluded from balances and
 *    surfaced under "Needs attention". We never silently default to
 *    everyone-equal.
 *  - Splits WITHOUT a payer are also excluded (they'd break the zero-sum
 *    invariant) and surfaced as "needs a payer" (`missingPayer`).
 *  - The payer needn't be in the split (paying on behalf of others is fine).
 *  - With `cost_share < 1` the payer is assumed to have fronted only the trip's
 *    effective portion; the external remainder is out of scope.
 *  - CHARGED RATE: an item may carry `charged_currency` + `charged_rate` — the
 *    exact currency and rate its card was billed at (e.g. a USD fare charged to
 *    an HKD card at a known rate). When present, the item's ENTIRE settlement
 *    contribution — the paid amount and every share, extras included — is
 *    re-denominated at that rate into `charged_currency`. This is a user-entered
 *    charged rate that re-denominates the item exactly — it is NOT approximate
 *    FX; the no-toHKD rule still holds. itemShares stays native; scaling the
 *    paid amount and shares by the same factor afterwards preserves proportions
 *    and extras exactly.
 */

// Same zero-decimal set formatCurrency special-cases. ε is the settle threshold:
// 1 whole unit for zero-decimal currencies, 1 cent otherwise.
const ZERO_DECIMAL = ['JPY', 'KRW', 'TWD']
const epsilonFor = (currency) => (ZERO_DECIMAL.includes(currency) ? 1 : 0.01)

/** Display label for a member row (falls back to the email local-part). */
function label(member) {
  if (!member) return 'Someone'
  return member.name || (member.email ? member.email.split('@')[0] : null) || 'Someone'
}

const memberId = (m) => m?.id ?? m?.user_id

const firstName = (member) => label(member).trim().split(/\s+/)[0]

/**
 * Per-user share map for one item's split rows — the extras formula
 * computeBalances uses (share = extra + w/Σw × (amount − Σextras)), with the
 * same guards. Returns a Map(user_id → share), or null when the item can't be
 * divided (no rows, extras exceed the amount, or a positive remainder with no
 * weights).
 */
export function itemShares(amount, splits) {
  if (!Array.isArray(splits) || splits.length === 0) return null
  const sumW = splits.reduce((s, r) => s + (Number(r.weight) || 0), 0)
  const sumExtras = splits.reduce((s, r) => s + (Number(r.extra_amount) || 0), 0)
  if (sumExtras > amount + 0.01) return null
  const remainder = amount - sumExtras
  if (remainder > 0.01 && sumW <= 0) return null
  const shares = new Map()
  for (const row of splits) {
    const w = Number(row.weight) || 0
    const extra = Number(row.extra_amount) || 0
    const share = extra + (sumW > 0 ? (w / sumW) * remainder : 0)
    shares.set(row.user_id, (shares.get(row.user_id) || 0) + share)
  }
  return shares
}

/**
 * Group-level result of ONE item: which settlement units end up owing the
 * payer's unit, and how much. Used for the live preview in SplitEditor and the
 * "Split" row in the booking view modal.
 *
 * @returns {{ payerName: string, lines: [{ name, amount }] } | null}
 */
export function itemUnitTransfers({ members = [], parties = [], amount, paidBy, splits }) {
  if (!paidBy || !(amount > 0)) return null
  const memberById = new Map()
  for (const m of members) {
    const id = memberId(m)
    if (id && !memberById.has(id)) memberById.set(id, m)
  }
  if (!memberById.has(paidBy)) return null
  const shares = itemShares(amount, splits)
  if (!shares) return null

  const partyNameById = new Map(parties.map((p) => [p.id, p.name]))
  const unitKeyOf = (id) => memberById.get(id)?.party_id || `solo-${id}`
  const unitNameOf = (id) => {
    const pid = memberById.get(id)?.party_id
    if (pid && partyNameById.has(pid)) return partyNameById.get(pid)
    return firstName(memberById.get(id))
  }

  const payerUnit = unitKeyOf(paidBy)
  const owedByUnit = new Map()
  for (const [userId, share] of shares) {
    if (!memberById.has(userId)) continue
    const key = unitKeyOf(userId)
    if (key === payerUnit || share <= 0) continue
    const prev = owedByUnit.get(key)
    owedByUnit.set(key, { name: unitNameOf(userId), amount: (prev?.amount || 0) + share })
  }
  return { payerName: unitNameOf(paidBy), lines: [...owedByUnit.values()] }
}

/**
 * The viewer's unit-level net for ONE item: + it is owed, − it owes, 0 even.
 * `unitMemberIds` is the viewer plus anyone sharing their party in the item's
 * trip. Returns null when the item isn't settleable (no payer / bad splits).
 */
export function itemViewerNet({ amount, paidBy, splits, unitMemberIds }) {
  if (!paidBy) return null
  const shares = itemShares(amount, splits)
  if (!shares) return null
  const ids = new Set(unitMemberIds)
  let net = ids.has(paidBy) ? amount : 0
  for (const [userId, share] of shares) if (ids.has(userId)) net -= share
  return net
}

/**
 * The settle currency + scaling rate for an item: its charged currency/rate when
 * both are present and valid, else the native currency at rate 1.
 */
function settleDenomination(nativeCurrency, chargedCurrency, chargedRate) {
  const rate = Number(chargedRate)
  if (chargedCurrency && rate > 0) return { settleCurrency: chargedCurrency, settleRate: rate }
  return { settleCurrency: nativeCurrency, settleRate: 1 }
}

/** Normalize a cost-bearing booking into a settle item, or null if not priced. */
function bookingItem(b) {
  if (b.cost_amount == null || !b.cost_currency) return null
  const share = b.cost_share != null ? b.cost_share : 1
  return {
    kind: 'booking',
    ref: b,
    amount: b.cost_amount * share,
    currency: b.cost_currency,
    paid_by: b.paid_by ?? null,
    splits: Array.isArray(b.splits) ? b.splits : [],
    ...settleDenomination(b.cost_currency, b.charged_currency, b.charged_rate),
  }
}

/** Normalize an expense into a settle item. Splittable amount is just `amount`. */
function expenseItem(e) {
  return {
    kind: 'expense',
    ref: e,
    amount: e.amount ?? 0,
    currency: e.currency,
    paid_by: e.paid_by ?? null,
    splits: Array.isArray(e.splits) ? e.splits : [],
    ...settleDenomination(e.currency, e.charged_currency, e.charged_rate),
  }
}

/** { [currency]: amount } accumulator helper. */
function add(map, currency, amount) {
  if (!currency || !amount) return
  map[currency] = (map[currency] || 0) + amount
}

/**
 * Per-unit balances across the given items, all per-currency exact.
 *
 * @param {object} data
 * @param {Array}  data.members     rows carrying an id (or user_id) + party_id
 * @param {Array}  data.parties     [{ id, name }] — display names for party units
 * @param {Array}  data.bookings    cost-bearing bookings, each with `splits`
 * @param {Array}  data.expenses    ad-hoc expenses, each with `splits`
 * @param {Array}  data.settlements recorded pay-backs
 * @returns {{
 *   units: Array<{ key: string, name: string, memberIds: string[],
 *                  paid: object, owed: object, net: object }>,
 *   unallocated: Array,   // cost-bearing items with no splits
 *   missingPayer: Array,  // items with splits but no payer
 * }}
 */
export function computeBalances({
  members = [],
  parties = [],
  bookings = [],
  expenses = [],
  settlements = [],
} = {}) {
  // Per-user running totals, keyed by currency.
  const paid = new Map() // userId → { [currency]: amount }
  const owed = new Map()
  const totals = (map, userId) => {
    let t = map.get(userId)
    if (!t) map.set(userId, (t = {}))
    return t
  }

  const unallocated = []
  const missingPayer = []

  const items = [
    ...bookings.map(bookingItem).filter(Boolean),
    ...expenses.map(expenseItem),
  ]

  // Settleable items are also kept for the pairwise (un-simplified) pass below.
  const settleable = []
  for (const item of items) {
    if (item.splits.length === 0) {
      unallocated.push(item.ref)
      continue
    }
    if (!item.paid_by) {
      missingPayer.push(item.ref)
      continue
    }
    // Guards (extras exceeding the amount, positive remainder with no weights)
    // live in itemShares — a null means the item is skipped rather than
    // poisoning balances.
    const shares = itemShares(item.amount, item.splits)
    if (!shares) continue
    settleable.push({ item, shares })

    // Re-denominate at the charged rate (1 / native currency when none): shares
    // stay native above, so scaling the paid amount and every share by the same
    // factor here preserves proportions and extras exactly.
    const cur = item.settleCurrency ?? item.currency
    const rate = item.settleRate ?? 1
    add(totals(paid, item.paid_by), cur, item.amount * rate)
    for (const [userId, share] of shares) {
      add(totals(owed, userId), cur, share * rate)
    }
  }

  // ---- Aggregate users into units -----------------------------------------
  // Members sharing a party form one unit; everyone else is solo. Units are
  // keyed by the sorted member-id SET (not party_id) so the same couple across
  // two trips — two party rows — merges into one unit. Union-find over party
  // membership yields exactly that, and keeps every user in exactly one unit.
  const memberByUserId = new Map()
  for (const m of members) {
    const id = memberId(m)
    if (id && !memberByUserId.has(id)) memberByUserId.set(id, m)
  }
  const partyNameById = new Map(parties.map((p) => [p.id, p.name]))

  // The universe of users: members + anyone touched by an item or settlement.
  const universe = new Set(memberByUserId.keys())
  for (const id of paid.keys()) universe.add(id)
  for (const id of owed.keys()) universe.add(id)
  for (const s of settlements) {
    if (s.from_user) universe.add(s.from_user)
    if (s.to_user) universe.add(s.to_user)
  }

  const parent = new Map()
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x)
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)
    while (parent.get(x) !== root) {
      const next = parent.get(x)
      parent.set(x, root)
      x = next
    }
    return root
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const id of universe) find(id) // seed

  // Union members that share a party_id (party_id is globally unique per trip,
  // so grouping by it alone is correct).
  const byParty = new Map()
  for (const m of members) {
    const id = memberId(m)
    if (!id || !m.party_id) continue
    if (!byParty.has(m.party_id)) byParty.set(m.party_id, [])
    byParty.get(m.party_id).push(id)
  }
  for (const [, ids] of byParty) {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i])
  }

  // Collect components.
  const components = new Map() // root → Set(userIds)
  for (const id of universe) {
    const root = find(id)
    if (!components.has(root)) components.set(root, new Set())
    components.get(root).add(id)
  }

  const units = []
  const unitByUserId = new Map()
  for (const [, idSet] of components) {
    const memberIds = [...idSet].sort()
    const key = memberIds.join('+')
    const unitPaid = {}
    const unitOwed = {}
    const unitNet = {}
    for (const id of memberIds) {
      const p = paid.get(id) || {}
      const o = owed.get(id) || {}
      for (const [cur, amt] of Object.entries(p)) {
        add(unitPaid, cur, amt)
        add(unitNet, cur, amt)
      }
      for (const [cur, amt] of Object.entries(o)) {
        add(unitOwed, cur, amt)
        add(unitNet, cur, -amt)
      }
    }
    // Name: a party name for grouped units (display-only), else the member label.
    let name
    if (memberIds.length > 1) {
      const withParty = memberIds
        .map((id) => memberByUserId.get(id))
        .find((m) => m && m.party_id && partyNameById.has(m.party_id))
      name = withParty ? partyNameById.get(withParty.party_id) : memberIds.map((id) => label(memberByUserId.get(id))).join(' & ')
    } else {
      name = label(memberByUserId.get(memberIds[0]))
    }
    const unit = { key, name, memberIds, paid: unitPaid, owed: unitOwed, net: unitNet }
    units.push(unit)
    for (const id of memberIds) unitByUserId.set(id, unit)
  }

  // ---- Apply settlements, exactly in their recorded currency ---------------
  // from→to of X CUR ⇒ net[fromUnit][CUR] += X, net[toUnit][CUR] −= X. A debtor
  // (net < 0) who pays moves toward 0 from below; the creditor moves toward 0.
  for (const s of settlements) {
    const fromUnit = unitByUserId.get(s.from_user)
    const toUnit = unitByUserId.get(s.to_user)
    const amt = Number(s.amount) || 0
    if (!s.currency || !amt) continue
    if (fromUnit) add(fromUnit.net, s.currency, amt)
    if (toUnit) add(toUnit.net, s.currency, -amt)
  }

  // ---- Direct (un-simplified) pairwise debts -------------------------------
  // "Everyone settles their own debts": per item, each non-payer unit owes the
  // payer's unit its share; reciprocal debts within a pair net out (A→B minus
  // B→A per currency), but money is never rerouted through third parties the
  // way suggestTransfers' min-cash-flow does. Recorded settlements reduce the
  // payer pair's debt directly. Canonical pair key: sorted unit keys, positive
  // net = first-owes-second.
  const pairNets = new Map() // currency → Map("a||b" → signed net)
  const addPair = (currency, fromKey, toKey, amount) => {
    if (!currency || !amount || fromKey === toKey) return
    const [a, b] = fromKey < toKey ? [fromKey, toKey] : [toKey, fromKey]
    const sign = fromKey === a ? 1 : -1
    let m = pairNets.get(currency)
    if (!m) pairNets.set(currency, (m = new Map()))
    const k = `${a}||${b}`
    m.set(k, (m.get(k) || 0) + sign * amount)
  }
  for (const { item, shares } of settleable) {
    const payerUnit = unitByUserId.get(item.paid_by)
    if (!payerUnit) continue
    const cur = item.settleCurrency ?? item.currency
    const rate = item.settleRate ?? 1
    for (const [userId, share] of shares) {
      const unit = unitByUserId.get(userId)
      if (!unit || unit === payerUnit) continue
      addPair(cur, unit.key, payerUnit.key, share * rate)
    }
  }
  for (const s of settlements) {
    const fromUnit = unitByUserId.get(s.from_user)
    const toUnit = unitByUserId.get(s.to_user)
    const amt = Number(s.amount) || 0
    if (!fromUnit || !toUnit || !s.currency || !amt) continue
    // Paying back reduces the from-unit's debt to the to-unit.
    addPair(s.currency, fromUnit.key, toUnit.key, -amt)
  }
  const unitByKey = new Map(units.map((u) => [u.key, u]))
  const pairTransfers = []
  for (const [currency, m] of pairNets) {
    const eps = epsilonFor(currency)
    const rows = []
    for (const [k, net] of m) {
      if (Math.abs(net) < eps) continue
      const [a, b] = k.split('||')
      rows.push(
        net > 0
          ? { fromUnit: unitByKey.get(a), toUnit: unitByKey.get(b), amount: net, currency }
          : { fromUnit: unitByKey.get(b), toUnit: unitByKey.get(a), amount: -net, currency },
      )
    }
    rows.sort((x, y) => y.amount - x.amount)
    pairTransfers.push(...rows)
  }

  return { units, unallocated, missingPayer, pairTransfers }
}

/**
 * Greedy min-cash-flow, run INDEPENDENTLY per currency: repeatedly match the
 * largest debtor with the largest creditor for `min(|debt|, credit)` until every
 * `|net| < ε`. A pair who shared costs in two currencies gets two suggested
 * transfers — that is correct, since cross-currency netting would require FX.
 *
 * @param {Array} units units from computeBalances
 * @returns {Array<{ fromUnit: object, toUnit: object, amount: number, currency: string }>}
 */
export function suggestTransfers(units = []) {
  const currencies = new Set()
  for (const u of units) for (const c of Object.keys(u.net || {})) currencies.add(c)

  const transfers = []
  for (const currency of currencies) {
    const eps = epsilonFor(currency)
    const bal = units
      .map((u) => ({ unit: u, amt: (u.net && u.net[currency]) || 0 }))
      .filter((b) => Math.abs(b.amt) >= eps)

    // Repeatedly settle the biggest creditor against the biggest debtor.
    while (true) {
      let cred = null
      let debt = null
      for (const b of bal) {
        if (b.amt > 0 && (!cred || b.amt > cred.amt)) cred = b
        if (b.amt < 0 && (!debt || b.amt < debt.amt)) debt = b
      }
      if (!cred || !debt) break
      const x = Math.min(cred.amt, -debt.amt)
      if (x < eps) break
      transfers.push({ fromUnit: debt.unit, toUnit: cred.unit, amount: x, currency })
      cred.amt -= x
      debt.amt += x
    }
  }
  return transfers
}
