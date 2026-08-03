/**
 * The booking form's rejectable fields — shared by the form itself and by the
 * modal that owns the Save button, since the error summary renders in the
 * footer, outside the <form>.
 */

/**
 * Document order, not alphabetical: the summary chip lists fields in the order
 * they appear on the form, and a failed save jumps to the first of them, which
 * has to be the topmost problem rather than whichever one validate() wrote last.
 */
export const FIELD_ORDER = [
  'title',
  'trip_id',
  'start_date',
  'end_date',
  'paid_by',
  'charged_rate',
  'timezone',
]

/** Chip labels — the field's own label, not its error text. */
export const FIELD_LABELS = {
  title: 'Title',
  trip_id: 'Trip',
  start_date: 'Start date',
  end_date: 'End date',
  paid_by: 'Split',
  charged_rate: 'Charged rate',
  timezone: 'Timezone',
}

/**
 * Bring a field on screen and put the caret in it.
 *
 * Addressed by `data-field` rather than one ref per field because which fields
 * exist depends on the booking type and on whether it has a cost — half of them
 * aren't mounted at any given time.
 */
export function focusFormField(formEl, field) {
  const root = formEl?.querySelector(`[data-field="${field}"]`)
  if (!root) return
  // The timezone picker lives inside a collapsed <details>; scrolling to a field
  // with no layout box does nothing at all. The row's onToggle syncs React state
  // back up, so opening it from here doesn't desync the controlled `open`.
  const wrapper = root.closest('details')
  if (wrapper && !wrapper.open) wrapper.open = true
  root.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const control = root.matches('input, select, textarea')
    ? root
    : root.querySelector('input, select, textarea, button')
  // preventScroll because the smooth scroll above is still running — focus()
  // would otherwise snap the container to the field instantly and cancel it.
  control?.focus({ preventScroll: true })
}

/**
 * A server rejection that names a form field, or null.
 *
 * runAction formats a ZodError as "path: message" ("timezone: Unknown
 * timezone", "splits.0.weight: ..."), so the first path segment is the field.
 * Anything else — a permission error, a driver failure, a ref id — has no field
 * to attach to and stays a toast.
 */
export function fieldFromServerMessage(message) {
  const text = String(message ?? '')
  const at = text.indexOf(':')
  if (at < 0) return null
  const field = text.slice(0, at).split('.')[0].trim()
  const detail = text.slice(at + 1).trim()
  if (!detail || !Object.prototype.hasOwnProperty.call(FIELD_LABELS, field)) return null
  return { field, message: detail }
}
