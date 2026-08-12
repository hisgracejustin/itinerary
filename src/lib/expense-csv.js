import { itemShares } from './split'
import { expenseCategory } from './expense-categories'

const HEADERS = [
  'Trip',
  'Date',
  'Expense',
  'Category',
  'Amount',
  'Currency',
  'Paid by',
  'Split between',
  'Split details',
  'Service %',
  'Shared charge',
  'Charged currency',
  'Charged rate',
  'Charged amount',
  'Created by',
  'Created at',
  'Expense ID',
]

const number = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const personName = (member, fallback = 'Unknown user') =>
  member?.name?.trim() || member?.email || fallback

const isoDate = (value) => {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

// Quotes, line breaks and commas are legal CSV content. Guard user-entered
// strings from becoming spreadsheet formulas when the download opens in Excel.
function csvCell(value) {
  let text = value == null ? '' : String(value)
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

/**
 * One row per expense. Split details carry each person's exact calculated
 * share, weight and itemized extra without duplicating the expense total across
 * several CSV rows.
 */
export function buildExpensesCsv(expenses = [], trips = []) {
  const tripById = new Map(trips.map((trip) => [trip.id, trip]))
  const rows = expenses.map((expense) => {
    const trip = tripById.get(expense.trip_id)
    const memberById = new Map((trip?.members || []).map((member) => [member.id, member]))
    const nameOf = (id) => personName(memberById.get(id), id ? `Unknown user (${id})` : '')
    const amount = number(expense.amount)
    const splits = Array.isArray(expense.splits) ? expense.splits : []
    const shares = itemShares(amount, splits)
    const splitNames = splits.map((split) => nameOf(split.user_id))
    const splitDetails = splits.map((split) => {
      const weight = number(split.weight)
      const extra = number(split.extra_amount)
      const paid = number(split.paid_amount)
      const share = shares?.get(split.user_id)
      const parts = [
        `${nameOf(split.user_id)}: ${share == null ? 'unknown' : share.toFixed(2)} ${expense.currency}`,
        `weight ${weight}`,
      ]
      const base = split.base_amount
      if (base != null) parts.push(`before charges ${number(base).toFixed(2)} ${expense.currency}`)
      if (extra > 0) parts.push(`extra ${extra.toFixed(2)} ${expense.currency}`)
      if (paid > 0) parts.push(`paid separately ${paid.toFixed(2)} ${expense.currency}`)
      return parts.join(', ')
    })
    const chargedRate = number(expense.charged_rate)
    const hasCharge = !!expense.charged_currency && chargedRate > 0

    return [
      trip?.name || expense.trip_id,
      expense.date || '',
      expense.title,
      // The label, not the stored slug: this file is read in a spreadsheet.
      expenseCategory(expense.category).label,
      amount,
      expense.currency,
      expense.paid_by ? nameOf(expense.paid_by) : 'Unassigned',
      splitNames.length ? splitNames.join('; ') : 'Unallocated',
      splitDetails.join('; '),
      expense.service_percent == null ? '' : number(expense.service_percent),
      expense.shared_charge == null ? '' : number(expense.shared_charge),
      hasCharge ? expense.charged_currency : '',
      hasCharge ? chargedRate : '',
      hasCharge ? amount * chargedRate : '',
      expense.created_by ? nameOf(expense.created_by) : '',
      isoDate(expense.created_at),
      expense.id,
    ]
  })

  return [HEADERS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}
