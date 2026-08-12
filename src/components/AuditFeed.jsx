"use client";

// Reverse-chronological history, shared by the per-booking section and the
// per-trip History card. Entries come from getAuditForEntity/getAuditForTrip,
// which have already resolved every stored user id against the current roster —
// so a name here is the live one where the account still exists, and the name
// frozen at write time where it doesn't.

// Only watched fields ever reach the log, so this map is the whole vocabulary.
const FIELD_LABELS = {
  title: 'Title',
  type: 'Type',
  category: 'Category',
  start_date: 'Start',
  end_date: 'End',
  timezone: 'Timezone',
  cost_amount: 'Cost',
  cost_currency: 'Currency',
  amount: 'Amount',
  currency: 'Currency',
  charged_currency: 'Charged currency',
  charged_rate: 'Charged rate',
  paid_by: 'Paid by',
  splits: 'Split',
  trip_id: 'Trip',
  date: 'Date',
  name: 'Name',
  members: 'Members',
  cancellation_policy: 'Cancellation policy',
}

// A booking's label already starts with its type ("flight HKG → YVR"), so it
// needs no noun in front of it; the others do.
const ENTITY_NOUNS = {
  booking: '',
  expense: 'expense',
  settlement: 'settlement',
  party: 'group',
}

const subjectOf = (e) => [ENTITY_NOUNS[e.entity_type] ?? e.entity_type, e.entity_label].filter(Boolean).join(' ')

function formatWhen(value) {
  const d = new Date(value)
  if (isNaN(d)) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** The sentence, minus the actor's name (rendered separately, in bold). */
function describe(entry, scope) {
  if (entry.action === 'created') {
    return scope === 'entity' ? `added this ${entry.entity_type}` : `added ${subjectOf(entry)}`
  }
  if (entry.action === 'deleted') {
    return scope === 'entity' ? `deleted this ${entry.entity_type}` : `deleted ${subjectOf(entry)}`
  }
  const field = FIELD_LABELS[entry.field] ?? entry.field
  const { old_value: from, new_value: to } = entry
  if (from && to) return `changed ${field} from ${from} to ${to}`
  if (to) return `set ${field} to ${to}`
  // A cleared value still names what it was — "cleared Paid by" alone loses the
  // one fact worth keeping.
  if (from) return `cleared ${field} (was ${from})`
  return `changed ${field}`
}

export default function AuditFeed({ entries, scope = 'trip', truncated = false, empty = 'Nothing recorded yet.' }) {
  if (!entries || entries.length === 0) {
    return <p className="text-[11px] text-on-surface-variant/70 py-1">{empty}</p>
  }
  return (
    <div>
      <ul className="space-y-1.5">
        {entries.map((e) => (
          <li key={e.id} className="text-[11px] leading-relaxed text-on-surface-variant min-w-0">
            <span className="text-on-surface font-medium">{e.by.label}</span>{' '}
            <span className="break-words">{describe(e, scope)}</span>
            <span className="block text-on-surface-variant/70 truncate">
              {scope === 'trip' && e.action === 'updated' && `${subjectOf(e)} · `}
              {formatWhen(e.changed_at)}
            </span>
          </li>
        ))}
      </ul>
      {truncated && (
        <p className="text-[10px] text-on-surface-variant/70 mt-2">
          Showing the {entries.length} most recent changes — older ones aren&apos;t listed here.
        </p>
      )}
    </div>
  )
}
