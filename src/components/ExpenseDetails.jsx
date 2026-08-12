import { useEffect, useState } from 'react'
import { formatCurrency } from '../lib/currencies'
import { itemUnitTransfers } from '../lib/split'
import { expenseCategory } from '../lib/expense-categories'
import { useTripContext } from '../lib/trip-context'
import { getEntityAudit } from '@/lib/client-actions'
import { memberLabel } from './AssigneePicker'
import AuditFeed from './AuditFeed'

/** "Sat, Aug 8, 2026" for a 'YYYY-MM-DD' expense date. */
function formatDate(iso) {
  if (!iso) return null
  // Parsed at local midnight: `new Date('2026-08-08')` is UTC, which reads as
  // the day before for anyone west of Greenwich.
  const d = new Date(`${iso}T00:00:00`)
  if (isNaN(d)) return iso
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function Row({ label, children }) {
  if (children == null || children === '') return null
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-outline/10 last:border-b-0">
      <span className="text-xs font-medium text-on-surface-variant shrink-0">{label}</span>
      <span className="text-sm text-on-surface text-right break-words min-w-0">{children}</span>
    </div>
  )
}

/**
 * Read-only face of an expense — the counterpart to BookingDetails, and what an
 * expense opens into everywhere before the pencil hands over to the form.
 */
export default function ExpenseDetails({ expense }) {
  const { trips } = useTripContext()
  // Fetched here rather than passed down, exactly as BookingDetails does: it's
  // per-expense, only this view wants it, and a reader without the rights gets
  // an empty list back, so the section simply doesn't appear.
  const [history, setHistory] = useState([])
  const expenseId = expense?.id
  useEffect(() => {
    if (!expenseId) return
    let live = true
    getEntityAudit('expense', expenseId)
      .then((rows) => { if (live) setHistory(rows) })
      .catch(() => {})
    return () => { live = false }
  }, [expenseId])
  if (!expense) return null

  const category = expenseCategory(expense.category)
  const currency = expense.currency || 'HKD'
  const amount = Number(expense.amount) || 0
  const rate = Number(expense.charged_rate)
  const charged = expense.charged_currency && rate > 0 ? { rate, currency: expense.charged_currency } : null

  const trip = (trips || []).find((t) => t.id === expense.trip_id)
  const roster = trip?.members || []
  const nameOf = (userId) => {
    const member = roster.find((m) => m.id === userId)
    return member ? memberLabel(member) : 'Someone who has since left'
  }

  // Net result of this split, aggregated by settlement unit — "who owes the
  // payer for this one item". Same call BookingDetails makes, minus cost_share.
  const splitResult = trip
    ? itemUnitTransfers({
        members: roster,
        parties: trip.parties || [],
        amount,
        paidBy: expense.paid_by,
        splits: expense.splits,
      })
    : null

  const addedBy = expense.created_by
    ? `Added by ${nameOf(expense.created_by)}`
    : 'Added before this was recorded'

  return (
    <div className="space-y-4 min-w-0">
      <div>
        <span className="inline-block text-xs font-medium bg-surface-container text-on-surface-variant px-2.5 py-1 rounded-full">
          {category.icon} {category.label}
        </span>
      </div>

      <div className="rounded-xl border border-outline/20 px-4 py-1">
        <Row label="Trip">{trip?.name}</Row>
        <Row label="Date">{formatDate(expense.date)}</Row>
        <Row label="Amount">
          {formatCurrency(amount, currency)}
          {charged && (
            <span className="text-on-surface-variant">
              {' '}· charged @{parseFloat(charged.rate.toFixed(4))} ={' '}
              {formatCurrency(amount * charged.rate, charged.currency)}
            </span>
          )}
        </Row>
        <Row label="Paid by">{expense.paid_by ? nameOf(expense.paid_by) : 'Nobody yet'}</Row>
        {/* Both are already folded into the split rows; shown because a tip is
            exactly what someone reopens an expense to check. */}
        {expense.service_percent != null && (
          <Row label="Service charge">{parseFloat(Number(expense.service_percent).toFixed(2))}%</Row>
        )}
        {expense.shared_charge != null && (
          <Row label="Shared charge">{formatCurrency(Number(expense.shared_charge), currency)}</Row>
        )}
        {splitResult && splitResult.lines.length > 0 && (
          <Row label="Split">
            <span className="block space-y-0.5">
              {splitResult.lines.map((line, i) => (
                <span key={i} className="block">
                  {line.fromName}
                  <span className="text-on-surface-variant" aria-hidden> → </span>
                  {line.toName} {formatCurrency(line.amount, currency)}
                </span>
              ))}
            </span>
          </Row>
        )}
      </div>

      <p className="text-[11px] text-on-surface-variant">{addedBy}</p>

      {history.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">History</h3>
          <div className="rounded-xl border border-outline/20 px-4 py-3">
            <AuditFeed entries={history} scope="entity" />
          </div>
        </div>
      )}
    </div>
  )
}
