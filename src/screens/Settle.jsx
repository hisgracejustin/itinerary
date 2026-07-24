"use client";

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useTripContext } from '../lib/trip-context'
import { computeBalances, suggestTransfers } from '../lib/split'
import { formatCurrency, CURRENCIES } from '../lib/currencies'
import AssigneePicker, { Avatar, memberLabel, memberFirstName } from '../components/AssigneePicker'
import SplitEditor from '../components/SplitEditor'
import { useToast } from '../components/Toast'
import { friendlyError } from '../lib/friendlyError'
import {
  createExpense, updateExpense, deleteExpense,
  recordSettlement, deleteSettlement,
} from '../lib/client-actions'

// Same zero-decimal set the settle math special-cases; used here only to hide
// dust (a net a fraction of a unit away from zero reads as "settled up").
const ZERO_DECIMAL = ['JPY', 'KRW', 'TWD']
const epsFor = (c) => (ZERO_DECIMAL.includes(c) ? 1 : 0.01)

const cleanAmount = (raw) => String(raw).replace(/[^0-9.]/g, '')
const toNumber = (raw) => {
  const n = parseFloat(cleanAmount(raw))
  return Number.isFinite(n) ? n : NaN
}

/** Non-dust net entries for a unit, as [currency, amount]. */
function netEntries(net) {
  return Object.entries(net || {}).filter(([c, a]) => Math.abs(a) >= epsFor(c))
}

export default function Settle({
  members: allMembers,
  parties: allParties,
  bookings: allBookings,
  expenses: allExpenses,
  settlements: allSettlements,
  currentUserId,
}) {
  const { selectedTrips, selectedTrip, tripMeta, trips } = useTripContext()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  // Props carry the union of every accessible trip; filter to the selection
  // (empty selection = all trips) and recompute balances client-side.
  const selSet = new Set(selectedTrips)
  const inSel = (tripId) => selectedTrips.length === 0 || selSet.has(tripId)

  const members = (allMembers || []).filter((m) => inSel(m.trip_id))
  const parties = (allParties || []).filter((p) => inSel(p.trip_id))
  const bookings = (allBookings || []).filter((b) => inSel(b.trip_id))
  const expenses = (allExpenses || []).filter((e) => inSel(e.trip_id))
  const settlements = (allSettlements || []).filter((s) => inSel(s.trip_id))

  // Name/avatar lookup across the filtered roster (a user may appear once per
  // trip; first row wins).
  const memberByUserId = useMemo(() => {
    const map = new Map()
    for (const m of members) if (m.id && !map.has(m.id)) map.set(m.id, m)
    return map
  }, [members])
  const personLabel = (id) => memberLabel(memberByUserId.get(id) ?? { id })

  const { units, unallocated, missingPayer } = useMemo(
    () => computeBalances({ members, parties, bookings, expenses, settlements }),
    [members, parties, bookings, expenses, settlements],
  )
  const transfers = useMemo(() => suggestTransfers(units), [units])

  // Only surface units that actually took part (paid, owed, or settled).
  const activeUnits = units
    .filter((u) => netEntries(u.net).length || Object.keys(u.paid).length || Object.keys(u.owed).length)
    .sort((a, b) => {
      const am = a.memberIds.includes(currentUserId) ? 0 : 1
      const bm = b.memberIds.includes(currentUserId) ? 0 : 1
      return am - bm || a.name.localeCompare(b.name)
    })

  // ---- Record-payment form (shared by "Mark paid" + the manual entry) --------
  const settleFormRef = useRef(null)
  const blankSettle = { trip_id: selectedTrip ?? '', from_user: null, to_user: null, amount: '', currency: 'HKD', note: '' }
  const [settleForm, setSettleForm] = useState(blankSettle)
  const [showSettleForm, setShowSettleForm] = useState(false)

  const settleRoster = (trips.find((t) => t.id === settleForm.trip_id)?.members) ?? []
  // The "to" picker excludes anyone sharing the payer's party in that trip
  // (decision 5), and the payer themselves.
  const fromRow = settleRoster.find((m) => m.id === settleForm.from_user)
  const toRoster = settleRoster.filter((m) => {
    if (m.id === settleForm.from_user) return false
    if (fromRow?.party_id && m.party_id === fromRow.party_id) return false
    return true
  })

  const openSettleForm = (values) => {
    setSettleForm({ ...blankSettle, ...values })
    setShowSettleForm(true)
    requestAnimationFrame(() => settleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  const markPaid = (t) => {
    openSettleForm({
      trip_id: selectedTrip ?? '',
      from_user: t.fromUnit.memberIds[0] ?? null,
      to_user: t.toUnit.memberIds[0] ?? null,
      amount: String(ZERO_DECIMAL.includes(t.currency) ? Math.round(t.amount) : Math.round(t.amount * 100) / 100),
      currency: t.currency,
    })
  }

  const run = async (fn, success) => {
    setBusy(true)
    try {
      await fn()
      if (success) toast.success(success)
      return true
    } catch (err) {
      toast.error(friendlyError(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const submitSettlement = async (e) => {
    e.preventDefault()
    const amount = toNumber(settleForm.amount)
    if (!settleForm.trip_id) return toast.error('Pick a trip for this payment')
    if (!settleForm.from_user || !settleForm.to_user) return toast.error('Pick who paid and who received')
    if (!(amount > 0)) return toast.error('Enter an amount')
    const ok = await run(
      () => recordSettlement({
        trip_id: settleForm.trip_id,
        from_user: settleForm.from_user,
        to_user: settleForm.to_user,
        amount,
        currency: settleForm.currency,
        note: settleForm.note.trim() || null,
      }),
      'Payment recorded',
    )
    if (ok) {
      setSettleForm(blankSettle)
      setShowSettleForm(false)
    }
  }

  return (
    <div className="h-full flex flex-col w-full max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-medium text-on-surface">Settle up</h2>
        {tripMeta && (
          <span className="text-xs font-medium bg-primary-light text-primary px-3 py-1 rounded-full">
            {tripMeta.name}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-10">
        {/* 1 — Balances */}
        <section className="mat-surface p-5">
          <SectionTitle>Balances</SectionTitle>
          {activeUnits.length === 0 ? (
            <EmptyLine>Nothing to settle yet — add a payer and split to a cost or expense.</EmptyLine>
          ) : (
            <div className="space-y-1">
              {activeUnits.map((u) => (
                <BalanceRow key={u.key} unit={u} memberByUserId={memberByUserId} />
              ))}
            </div>
          )}
        </section>

        {/* 2 — Suggested transfers */}
        {transfers.length > 0 && (
          <section className="mat-surface p-5">
            <SectionTitle>Suggested transfers</SectionTitle>
            <div className="space-y-2">
              {transfers.map((t, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <UnitAvatars unit={t.fromUnit} memberByUserId={memberByUserId} />
                    <span className="text-sm text-on-surface truncate min-w-0">{t.fromUnit.name}</span>
                    <svg className="w-4 h-4 text-on-surface-variant shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                    <UnitAvatars unit={t.toUnit} memberByUserId={memberByUserId} />
                    <span className="text-sm text-on-surface truncate min-w-0">{t.toUnit.name}</span>
                  </div>
                  <span className="text-sm font-medium text-on-surface shrink-0">
                    {formatCurrency(t.amount, t.currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => markPaid(t)}
                    className="mat-btn-tonal text-xs shrink-0 !px-3 !py-1.5"
                  >
                    Mark paid
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 3 — Expenses */}
        <ExpensesSection
          expenses={expenses}
          personLabel={personLabel}
          trips={trips}
          selectedTrip={selectedTrip}
          busy={busy}
          run={run}
          toast={toast}
        />

        {/* 4 — Needs attention */}
        {(unallocated.length > 0 || missingPayer.length > 0) && (
          <section className="mat-surface p-5">
            <SectionTitle>Needs attention</SectionTitle>
            <div className="space-y-1.5">
              {unallocated.map((ref, i) => (
                <NeedsAttentionRow key={`u-${i}`} item={ref} reason="Not split yet" />
              ))}
              {missingPayer.map((ref, i) => (
                <NeedsAttentionRow key={`p-${i}`} item={ref} reason="No payer set" />
              ))}
            </div>
          </section>
        )}

        {/* 5 — Settlement history + record a payment */}
        <section ref={settleFormRef} className="mat-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <SectionTitle className="mb-0">Payments</SectionTitle>
            <button
              type="button"
              onClick={() => (showSettleForm ? setShowSettleForm(false) : openSettleForm({ trip_id: selectedTrip ?? '' }))}
              className="mat-btn-outlined text-xs"
            >
              {showSettleForm ? 'Cancel' : '+ Record a payment'}
            </button>
          </div>

          {showSettleForm && (
            <form onSubmit={submitSettlement} className="mb-4 space-y-3 rounded-xl border border-outline/30 bg-surface-container/40 p-3">
              <TripSelect
                trips={trips}
                value={settleForm.trip_id}
                onChange={(trip_id) => setSettleForm((f) => ({ ...f, trip_id, from_user: null, to_user: null }))}
              />
              <div className="flex items-center justify-between gap-2 min-w-0">
                <label className="text-xs font-medium text-on-surface-variant shrink-0">From (paid)</label>
                <AssigneePicker
                  value={settleForm.from_user}
                  members={settleRoster}
                  onChange={(m) => setSettleForm((f) => ({ ...f, from_user: m?.id ?? null, to_user: f.to_user === (m?.id ?? null) ? null : f.to_user }))}
                  align="right"
                />
              </div>
              <div className="flex items-center justify-between gap-2 min-w-0">
                <label className="text-xs font-medium text-on-surface-variant shrink-0">To (received)</label>
                <AssigneePicker
                  value={settleForm.to_user}
                  members={toRoster}
                  onChange={(m) => setSettleForm((f) => ({ ...f, to_user: m?.id ?? null }))}
                  align="right"
                />
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={settleForm.amount}
                  onChange={(e) => setSettleForm((f) => ({ ...f, amount: cleanAmount(e.target.value) }))}
                  placeholder="Amount"
                  className="mat-input flex-1"
                />
                <select
                  value={settleForm.currency}
                  onChange={(e) => setSettleForm((f) => ({ ...f, currency: e.target.value }))}
                  aria-label="Currency"
                  className="mat-select shrink-0"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.code}</option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                value={settleForm.note}
                onChange={(e) => setSettleForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Note (optional)"
                className="mat-input"
              />
              <button type="submit" disabled={busy} className="mat-btn-filled w-full justify-center disabled:opacity-40">
                {busy ? 'Recording…' : 'Record payment'}
              </button>
            </form>
          )}

          {settlements.length === 0 ? (
            <EmptyLine>No payments recorded yet.</EmptyLine>
          ) : (
            <div className="space-y-1">
              {settlements.map((s) => (
                <div key={s.id} className="flex items-center gap-2 py-2 border-b border-outline/20 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-on-surface truncate">
                      <span className="font-medium">{personLabel(s.from_user)}</span>
                      <span className="text-on-surface-variant"> → </span>
                      <span className="font-medium">{personLabel(s.to_user)}</span>
                    </div>
                    {s.note && <div className="text-xs text-on-surface-variant truncate">{s.note}</div>}
                  </div>
                  <span className="text-sm font-medium text-on-surface shrink-0">
                    {formatCurrency(Number(s.amount) || 0, s.currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => run(() => deleteSettlement(s.id), 'Payment deleted')}
                    disabled={busy}
                    aria-label="Delete payment"
                    className="text-on-surface-variant hover:text-red-500 p-1 rounded-full hover:bg-red-50 transition-colors disabled:opacity-30 shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function SectionTitle({ children, className = '' }) {
  return (
    <h3 className={`text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-3 ${className}`}>
      {children}
    </h3>
  )
}

function EmptyLine({ children }) {
  return <p className="text-sm text-on-surface-variant/80 py-2">{children}</p>
}

/** Overlapping avatars for a settlement unit (up to 3). */
function UnitAvatars({ unit, memberByUserId }) {
  const rows = unit.memberIds.map((id) => memberByUserId.get(id) ?? { id })
  return (
    <span className="flex -space-x-1.5 shrink-0">
      {rows.slice(0, 3).map((m) => (
        <Avatar key={m.id} member={m} size="xs" />
      ))}
    </span>
  )
}

function BalanceRow({ unit, memberByUserId }) {
  const [open, setOpen] = useState(false)
  const nets = netEntries(unit.net)
  const settled = nets.length === 0
  const currencies = [...new Set([...Object.keys(unit.paid), ...Object.keys(unit.owed)])]

  return (
    <div className="py-2 border-b border-outline/20 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
      >
        <UnitAvatars unit={unit} memberByUserId={memberByUserId} />
        <span className="text-sm text-on-surface font-medium truncate min-w-0 flex-1">{unit.name}</span>
        <span className="flex flex-wrap justify-end gap-1 shrink-0">
          {settled ? (
            <span className="text-xs text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-full">settled up</span>
          ) : (
            nets.map(([cur, amt]) => (
              <span
                key={cur}
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  amt > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                }`}
                title={amt > 0 ? 'is owed' : 'owes'}
              >
                {amt > 0 ? '' : '-'}{formatCurrency(Math.abs(amt), cur)}
              </span>
            ))
          )}
        </span>
        <svg
          className={`w-4 h-4 text-on-surface-variant shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && (
        <div className="mt-2 pl-8 space-y-1">
          {currencies.length === 0 && (
            <p className="text-[11px] text-on-surface-variant">No costs recorded.</p>
          )}
          {currencies.map((cur) => (
            <div key={cur} className="flex items-center justify-between text-[11px] text-on-surface-variant">
              <span>Paid {formatCurrency(unit.paid[cur] || 0, cur)}</span>
              <span>Share {formatCurrency(unit.owed[cur] || 0, cur)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Booking → link to its type page (the shell exposes no edit-in-place hook). */
function NeedsAttentionRow({ item, reason }) {
  const isBooking = !!item.type
  const title = item.title || 'Untitled'
  const inner = (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-base shrink-0">{isBooking ? '📌' : '🧾'}</span>
      <span className="text-sm text-on-surface truncate min-w-0 flex-1">{title}</span>
      <span className="text-[11px] text-amber-600 shrink-0">{reason}</span>
    </div>
  )
  if (isBooking) {
    return (
      <Link
        href={`/bookings/${item.type}`}
        className="block py-2 border-b border-outline/20 last:border-0 hover:bg-surface-container/50 -mx-2 px-2 rounded-lg transition-colors"
      >
        {inner}
      </Link>
    )
  }
  return <div className="py-2 border-b border-outline/20 last:border-0">{inner}</div>
}

/** Trip picker for expense/settlement creation (same rule Add Booking follows). */
function TripSelect({ trips, value, onChange }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-on-surface-variant uppercase tracking-wide block mb-1">Trip</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Trip"
        className="mat-select w-full"
      >
        <option value="">Select a trip…</option>
        {trips.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </label>
  )
}

function ExpensesSection({ expenses, personLabel, trips, selectedTrip, busy, run, toast }) {
  const blank = () => ({ id: null, trip_id: selectedTrip ?? '', title: '', amount: '', currency: 'HKD', date: '', paid_by: null, splits: [] })
  const [form, setForm] = useState(null) // null = closed

  const roster = form ? ((trips.find((t) => t.id === form.trip_id)?.members) ?? []) : []
  const parties = form ? ((trips.find((t) => t.id === form.trip_id)?.parties) ?? []) : []

  const openNew = () => setForm(blank())
  const openEdit = (e) => setForm({
    id: e.id,
    trip_id: e.trip_id,
    title: e.title || '',
    amount: e.amount != null ? String(e.amount) : '',
    currency: e.currency || 'HKD',
    date: e.date || '',
    paid_by: e.paid_by ?? null,
    splits: (e.splits || []).map((s) => ({ user_id: s.user_id, weight: Number(s.weight) || 1 })),
  })

  // Changing trip prunes split entries / payer to the new trip's roster.
  const changeTrip = (trip_id) => {
    const nextRoster = (trips.find((t) => t.id === trip_id)?.members) ?? []
    const ids = new Set(nextRoster.map((m) => m.id))
    setForm((f) => ({
      ...f,
      trip_id,
      splits: f.splits.filter((s) => ids.has(s.user_id)),
      paid_by: f.paid_by && ids.has(f.paid_by) ? f.paid_by : null,
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    const amount = toNumber(form.amount)
    if (!form.trip_id) return toast.error('Pick a trip for this expense')
    if (!form.title.trim()) return toast.error('Give the expense a title')
    if (!(amount > 0)) return toast.error('Enter an amount')
    if (form.splits.length === 0) return toast.error('Split the expense between at least one person')
    if (!form.paid_by) return toast.error('Pick who paid')
    const payload = {
      trip_id: form.trip_id,
      title: form.title.trim(),
      amount,
      currency: form.currency,
      date: form.date || null,
      paid_by: form.paid_by,
      splits: form.splits,
    }
    const ok = await run(
      () => (form.id ? updateExpense(form.id, payload) : createExpense(payload)),
      form.id ? 'Expense updated' : 'Expense added',
    )
    if (ok) setForm(null)
  }

  return (
    <section className="mat-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <SectionTitle className="mb-0">Expenses</SectionTitle>
        <button
          type="button"
          onClick={() => (form && !form.id ? setForm(null) : openNew())}
          className="mat-btn-outlined text-xs"
        >
          {form && !form.id ? 'Cancel' : '+ Add expense'}
        </button>
      </div>

      {form && (
        <form onSubmit={submit} className="mb-4 space-y-3 rounded-xl border border-outline/30 bg-surface-container/40 p-3">
          <TripSelect trips={trips} value={form.trip_id} onChange={changeTrip} />
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="What was it? (dinner, taxi…)"
            className="mat-input"
          />
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: cleanAmount(e.target.value) }))}
              placeholder="Amount"
              className="mat-input flex-1"
            />
            <select
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              aria-label="Currency"
              className="mat-select shrink-0"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.code}</option>
              ))}
            </select>
          </div>
          <label className="block">
            <span className="text-[11px] font-medium text-on-surface-variant uppercase tracking-wide block mb-1">Date (optional)</span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="mat-input"
            />
          </label>
          {form.trip_id ? (
            <SplitEditor
              members={roster}
              parties={parties}
              amount={toNumber(form.amount) || 0}
              currency={form.currency}
              paidBy={form.paid_by}
              splits={form.splits}
              onChange={({ paid_by, splits }) => setForm((f) => ({ ...f, paid_by, splits }))}
            />
          ) : (
            <p className="text-[11px] text-on-surface-variant/70">Pick a trip to split this expense.</p>
          )}
          <div className="flex justify-end gap-2">
            {form.id && (
              <button type="button" onClick={() => setForm(null)} className="mat-btn-outlined text-xs">
                Cancel
              </button>
            )}
            <button type="submit" disabled={busy} className="mat-btn-filled text-xs disabled:opacity-40">
              {busy ? 'Saving…' : form.id ? 'Save expense' : 'Add expense'}
            </button>
          </div>
        </form>
      )}

      {expenses.length === 0 ? (
        <EmptyLine>No expenses yet — add a dinner, taxi or anything shared.</EmptyLine>
      ) : (
        <div className="space-y-1">
          {expenses.map((e) => (
            <div key={e.id} className="flex items-center gap-2 py-2 border-b border-outline/20 last:border-0">
              <span className="text-base shrink-0">🧾</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-on-surface font-medium truncate">{e.title}</div>
                <div className="text-xs text-on-surface-variant truncate">
                  {e.paid_by ? `${personLabel(e.paid_by)} paid` : 'No payer'}
                  {e.date ? ` · ${e.date}` : ''}
                </div>
              </div>
              <span className="text-sm font-medium text-on-surface shrink-0">
                {formatCurrency(Number(e.amount) || 0, e.currency)}
              </span>
              <button
                type="button"
                onClick={() => openEdit(e)}
                aria-label={`Edit ${e.title}`}
                className="text-on-surface-variant hover:text-primary p-1 rounded-full hover:bg-surface-container transition-colors shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => run(() => deleteExpense(e.id), 'Expense deleted')}
                disabled={busy}
                aria-label={`Delete ${e.title}`}
                className="text-on-surface-variant hover:text-red-500 p-1 rounded-full hover:bg-red-50 transition-colors disabled:opacity-30 shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
