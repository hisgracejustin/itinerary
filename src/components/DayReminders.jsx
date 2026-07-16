"use client";

import { useState } from 'react'
import { useToast } from './Toast'
import { friendlyError } from '../lib/friendlyError'

// "HH:MM" (24h) → locale 12h label, e.g. "17:00" → "5:00 PM".
export function formatReminderTime(hhmm) {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Per-day reminders list with inline add / edit / delete. Rendered per day in the
 * day panel, calendar cells, the day view, and the mobile agenda — the `variant`
 * only tunes sizing. CRUD flows through the optimistic handlers in Calendar; this
 * component owns just the local add/edit UI state.
 */
export default function DayReminders({ reminders = [], date, tripId, onAdd, onEdit, onRemove, variant = 'panel' }) {
  const { toast } = useToast()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const compact = variant === 'cell'

  const submitAdd = async ({ text, time }) => {
    if (!text.trim()) { setAdding(false); return }
    try {
      await onAdd({ date, trip_id: tripId ?? null, text: text.trim(), time: time || null })
      setAdding(false)
    } catch (err) {
      toast.error(friendlyError(err))
    }
  }

  const submitEdit = async (id, { text, time }) => {
    if (!text.trim()) return submitRemove(id)
    try {
      await onEdit(id, { text: text.trim(), time: time || null })
      setEditingId(null)
    } catch (err) {
      toast.error(friendlyError(err))
    }
  }

  const submitRemove = async (id) => {
    setEditingId(null)
    try {
      await onRemove(id)
    } catch (err) {
      toast.error(friendlyError(err))
    }
  }

  const hasAny = reminders.length > 0

  return (
    <div className={compact ? 'space-y-0.5' : 'space-y-1'} onClick={(e) => e.stopPropagation()}>
      {!compact && (hasAny || adding) && (
        <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Notes</div>
      )}

      {reminders.map((r) =>
        editingId === r.id ? (
          <ReminderForm
            key={r.id}
            compact={compact}
            initial={r}
            onSubmit={(vals) => submitEdit(r.id, vals)}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <ReminderItem
            key={r.id}
            reminder={r}
            compact={compact}
            onEdit={() => !r._pending && setEditingId(r.id)}
            onRemove={() => !r._pending && submitRemove(r.id)}
          />
        ),
      )}

      {adding ? (
        <ReminderForm compact={compact} onSubmit={submitAdd} onCancel={() => setAdding(false)} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className={`inline-flex items-center gap-1 text-on-surface-variant/70 hover:text-primary transition-colors ${
            compact ? 'text-[10px] opacity-0 group-hover:opacity-100' : 'text-xs mt-0.5'
          }`}
        >
          <svg className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {compact ? 'Note' : 'Add note'}
        </button>
      )}
    </div>
  )
}

function ReminderItem({ reminder, compact, onEdit, onRemove }) {
  const time = formatReminderTime(reminder.time)
  return (
    <div
      className={`group/rem flex items-start gap-1.5 rounded-md ${reminder._pending ? 'opacity-60' : ''} ${
        compact ? 'px-1 py-0.5 hover:bg-primary-light/40' : 'px-1.5 py-1 hover:bg-surface-container'
      }`}
    >
      <span className={compact ? 'text-[10px] leading-4' : 'text-xs leading-5'} aria-hidden>📌</span>
      <button
        onClick={onEdit}
        className={`flex-1 min-w-0 text-left ${compact ? 'text-[10px] leading-4' : 'text-sm leading-5'}`}
        title="Edit note"
      >
        {time && (
          <span className={`font-medium text-primary ${compact ? 'mr-1' : 'mr-1.5'}`}>{time}</span>
        )}
        <span className={`text-on-surface ${compact ? 'break-words' : ''}`}>{reminder.text}</span>
      </button>
      <button
        onClick={onRemove}
        aria-label="Delete note"
        className={`shrink-0 text-on-surface-variant/50 hover:text-red-500 opacity-0 group-hover/rem:opacity-100 transition-opacity ${
          compact ? 'mt-0.5' : 'mt-0.5 p-0.5'
        }`}
      >
        <svg className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function ReminderForm({ initial, onSubmit, onCancel, compact }) {
  const [text, setText] = useState(initial?.text ?? '')
  const [time, setTime] = useState(initial?.time ?? '')

  const submit = (e) => {
    e.preventDefault()
    onSubmit({ text, time })
  }

  return (
    <form
      onClick={(e) => e.stopPropagation()}
      onSubmit={submit}
      className={`flex flex-col gap-1 ${compact ? '' : 'p-1.5 rounded-lg bg-surface-container/60'}`}
    >
      <input
        type="text"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
        placeholder="e.g. Be in Oakhurst by 5pm"
        className={`w-full bg-white border border-outline/40 rounded focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
          compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-sm'
        }`}
      />
      <div className="flex items-center gap-1.5">
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
          className={`bg-white border border-outline/40 rounded focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
            compact ? 'px-1 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
          }`}
        />
        <button
          type="submit"
          className={`rounded-full bg-primary text-white font-medium hover:bg-primary-dark transition-colors ${
            compact ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
          }`}
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`rounded-full text-on-surface-variant hover:bg-surface-container transition-colors ${
            compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
          }`}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
