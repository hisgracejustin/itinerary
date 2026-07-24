import { useState } from 'react'
import AssigneePicker, { Avatar, memberFirstName } from './AssigneePicker'
import { formatCurrency } from '../lib/currencies'
import { itemUnitTransfers } from '../lib/split'

/**
 * Shared split editor, used by BookingForm (and the expense form in commit 3).
 *
 * Controlled: the parent owns `paidBy` + `splits` and receives every change via
 * `onChange({ paid_by, splits })`. `amount`/`currency` drive the live per-person
 * share preview only.
 *
 * Roster rule: `members`/`parties` are the ITEM's trip roster (BookingForm feeds
 * the members of `form.trip_id`), NOT the sidebar selection.
 *
 * Auto-enable (decision 4): when a payer is picked while there are no splits yet,
 * pre-fill every member at weight 1 (extra 0). Clearing the payer keeps the
 * splits (they surface as "needs a payer" until one is picked — validation
 * blocks save).
 *
 * Extras: each person can carry an itemized `extra_amount` attributed off the
 * top (e.g. their baggage on a shared flight). The live share is
 *   share_i = extra_i + weight_i/Σweights × (amount − Σextras)
 * matching src/lib/split.js. With every extra 0 this is the old weight split.
 *
 * @param {object} props
 * @param {Array}  props.members  trip roster rows ({ id, name, email, image, party_id })
 * @param {Array}  props.parties  [{ id, name }] settlement units for this trip
 * @param {number} props.amount   splittable amount, for the live share preview
 * @param {string} props.currency currency code for the preview
 * @param {string|null} props.paidBy  user id who paid, or null
 * @param {Array}  props.splits   [{ user_id, weight, extra_amount }]
 * @param {(next: { paid_by: string|null, splits: Array }) => void} props.onChange
 */
export default function SplitEditor({
  members = [],
  parties = [],
  amount = 0,
  currency,
  paidBy = null,
  splits = [],
  onChange,
}) {
  const [showShares, setShowShares] = useState(false)
  // Local text drafts so a half-typed weight/extra ("1.", "44.", "") doesn't get
  // clobbered by the numeric round-trip; the parent still only ever sees valid
  // non-negative numbers. Separate maps keyed by user id.
  const [drafts, setDrafts] = useState({})
  const [extraDrafts, setExtraDrafts] = useState({})

  const includedIds = new Set(splits.map((s) => s.user_id))
  const weightOf = (id) => {
    const s = splits.find((x) => x.user_id === id)
    return s ? s.weight : 1
  }
  const extraOf = (id) => {
    const s = splits.find((x) => x.user_id === id)
    return s && s.extra_amount != null ? s.extra_amount : 0
  }
  const sumW = splits.reduce((acc, r) => acc + (Number(r.weight) || 0), 0)
  const sumExtras = splits.reduce((acc, r) => acc + (Number(r.extra_amount) || 0), 0)
  const remainder = amount - sumExtras
  const extrasExceed = amount > 0 && sumExtras > amount + 0.01

  const emit = (next) =>
    onChange?.({
      paid_by: next.paid_by !== undefined ? next.paid_by : paidBy,
      splits: next.splits !== undefined ? next.splits : splits,
    })

  // ---- Units: a party chip toggles all its members; a solo chip toggles one. --
  const partyById = new Map(parties.map((p) => [p.id, p]))
  const units = []
  const seenParty = new Set()
  for (const m of members) {
    if (m.party_id && partyById.has(m.party_id)) {
      if (seenParty.has(m.party_id)) continue
      seenParty.add(m.party_id)
      const groupMembers = members.filter((x) => x.party_id === m.party_id)
      units.push({
        kind: 'party',
        key: m.party_id,
        name: partyById.get(m.party_id).name,
        members: groupMembers,
        memberIds: groupMembers.map((x) => x.id),
      })
    } else {
      units.push({ kind: 'solo', key: m.id, name: memberFirstName(m), members: [m], memberIds: [m.id] })
    }
  }

  // ---- Per-item settlement preview: who ends up owing the payer's unit for
  // THIS item alone — same math as split.js (shared helper).
  const previewResult = itemUnitTransfers({ members, parties, amount, paidBy, splits })
  const transferPreview = previewResult?.lines ?? []
  const payerUnitName = previewResult?.payerName ?? null

  const handlePaidBy = (member) => {
    const newPaid = member?.id ?? null
    if (newPaid && !paidBy && splits.length === 0) {
      // Auto-enable: pre-fill everyone equal, no extras.
      emit({ paid_by: newPaid, splits: members.map((m) => ({ user_id: m.id, weight: 1, extra_amount: 0 })) })
    } else {
      emit({ paid_by: newPaid })
    }
  }

  const toggleUnit = (unit) => {
    const allIn = unit.memberIds.every((id) => includedIds.has(id))
    if (allIn) {
      emit({ splits: splits.filter((s) => !unit.memberIds.includes(s.user_id)) })
    } else {
      const toAdd = unit.memberIds
        .filter((id) => !includedIds.has(id))
        .map((id) => ({ user_id: id, weight: 1, extra_amount: 0 }))
      emit({ splits: [...splits, ...toAdd] })
    }
  }

  const setWeight = (id, raw) => {
    const clean = raw.replace(/[^0-9.]/g, '')
    setDrafts((d) => ({ ...d, [id]: clean }))
    const num = parseFloat(clean)
    // weight ≥ 0 now (an extras-only participant sits at 0); empty/invalid keeps
    // the last good weight rather than emitting NaN.
    if (!Number.isFinite(num) || num < 0) return
    emit({ splits: splits.map((s) => (s.user_id === id ? { ...s, weight: num } : s)) })
  }

  const setExtra = (id, raw) => {
    const clean = raw.replace(/[^0-9.]/g, '')
    setExtraDrafts((d) => ({ ...d, [id]: clean }))
    const num = parseFloat(clean)
    // empty/invalid extra = 0.
    const extra = Number.isFinite(num) && num >= 0 ? num : 0
    emit({
      splits: splits.map((s) => (s.user_id === id ? { ...s, extra_amount: extra } : s)),
    })
  }

  const includedMembers = members.filter((m) => includedIds.has(m.id))
  const missingPayer = splits.length > 0 && !paidBy

  return (
    <div className="space-y-3 rounded-xl border border-outline/30 bg-surface-container/40 p-3">
      {/* Paid by */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <label className="text-xs font-medium text-on-surface-variant shrink-0">Paid by</label>
        <AssigneePicker value={paidBy} members={members} onChange={handlePaidBy} align="right" />
      </div>

      {/* Split between */}
      <div>
        <div className="text-xs font-medium text-on-surface-variant mb-1.5">Split between</div>
        <div className="flex flex-wrap gap-1.5">
          {units.length === 0 && (
            <p className="text-[11px] text-on-surface-variant/70">
              Add people to this trip to split its cost.
            </p>
          )}
          {units.map((unit) => {
            const active = unit.memberIds.every((id) => includedIds.has(id))
            return (
              <button
                key={unit.key}
                type="button"
                onClick={() => toggleUnit(unit)}
                className={`inline-flex items-center gap-1.5 min-w-0 max-w-[10rem] pl-1 pr-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  active
                    ? 'border-primary bg-primary-light text-primary'
                    : 'border-outline/30 bg-white text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                <span className="flex -space-x-1.5 shrink-0">
                  {unit.members.slice(0, 2).map((m) => (
                    <Avatar key={m.id} member={m} size="xs" />
                  ))}
                </span>
                <span className="truncate min-w-0">{unit.name}</span>
              </button>
            )
          })}
        </div>
        {missingPayer && (
          <p className="text-[11px] text-amber-600 mt-1.5">Pick who paid before splitting this cost.</p>
        )}
      </div>

      {/* Adjust shares */}
      {includedMembers.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowShares((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-medium text-primary"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${showShares ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Adjust shares
          </button>
          {showShares && (
            <div className="mt-2 space-y-2">
              {includedMembers.map((m) => {
                const w = weightOf(m.id)
                const extra = extraOf(m.id)
                // share = extra + weight/Σweights × (amount − Σextras); mirrors split.js.
                const share = extra + (sumW > 0 ? (remainder * w) / sumW : 0)
                const value = drafts[m.id] !== undefined ? drafts[m.id] : String(w)
                const extraValue =
                  extraDrafts[m.id] !== undefined ? extraDrafts[m.id] : extra ? String(extra) : ''
                return (
                  <div key={m.id} className="flex items-center gap-1.5 min-w-0">
                    <Avatar member={m} size="xs" />
                    <span className="text-xs text-on-surface truncate min-w-0 flex-1">
                      {memberFirstName(m)}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => setWeight(m.id, e.target.value)}
                      className="mat-input w-14 text-center shrink-0"
                      aria-label={`Weight for ${memberFirstName(m)}`}
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      value={extraValue}
                      onChange={(e) => setExtra(m.id, e.target.value)}
                      placeholder="+ extra"
                      className="mat-input w-20 text-center shrink-0"
                      aria-label={`Extra for ${memberFirstName(m)}`}
                    />
                    <span className="text-xs text-on-surface-variant w-20 text-right shrink-0 truncate">
                      {formatCurrency(share, currency)}
                    </span>
                  </div>
                )
              })}
              {extrasExceed && (
                <p className="text-[11px] text-amber-600">Extras exceed the total cost.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Result preview: what this item alone does to the balances. */}
      {transferPreview.length > 0 && (
        <div className="pt-2 border-t border-outline/20 space-y-1">
          {transferPreview.map((t, i) => (
            <p key={i} className="text-[11px] text-on-surface-variant min-w-0 truncate">
              <span className="font-medium text-on-surface">{t.name}</span>
              <span aria-hidden> → </span>
              <span className="font-medium text-on-surface">{payerUnitName}</span>{' '}
              {formatCurrency(t.amount, currency)}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
