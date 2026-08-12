/**
 * What an ad-hoc shared cost was FOR. Bookings already carry a type, so this
 * list deliberately skips anything that is a booking (a hotel, a booked tour) —
 * `activities` here is the walk-up museum, the cable car, the boat ride nobody
 * reserved. Service charge and tips aren't categories either: they live on the
 * expense itself as service_percent / shared_charge.
 *
 * The column is plain text, not a PG enum, so retiring a value can never orphan
 * a row — `expenseCategory` falls back to Other for anything it doesn't know.
 */

export const DEFAULT_EXPENSE_CATEGORY = 'other'

// Held separately from the array so the fallback below is a definite object,
// not a Map lookup TypeScript has to be told can't miss.
const OTHER = { value: DEFAULT_EXPENSE_CATEGORY, label: 'Other', icon: '📌' }

// Display order, used verbatim by the picker and the By Type card.
export const EXPENSE_CATEGORIES = [
  { value: 'food', label: 'Food & drink', icon: '🍽️' },
  { value: 'groceries', label: 'Groceries', icon: '🛒' },
  { value: 'transport', label: 'Transport', icon: '🚕' },
  // Not the booking type's 🎯: both can appear as bars in Costs → By Type at
  // once, and a booked tour must be tellable from a paid-at-the-door one.
  { value: 'activities', label: 'Activities', icon: '🎟️' },
  { value: 'shopping', label: 'Shopping', icon: '🛍️' },
  OTHER,
]

export const EXPENSE_CATEGORY_VALUES = EXPENSE_CATEGORIES.map((c) => c.value)

const BY_VALUE = new Map(EXPENSE_CATEGORIES.map((c) => [c.value, c]))

/**
 * The entry for a stored value — never null, so no caller has to guard. Rows
 * written before the column existed read as null and land on Other.
 */
export function expenseCategory(value) {
  return BY_VALUE.get(value) || OTHER
}
