"use client";

import { useEffect, useRef, useState } from 'react'

/** Display name for a member row (falls back to the email local-part). */
export function memberLabel(member) {
  if (!member) return 'Unassigned'
  return member.name || member.email?.split('@')[0] || 'Someone'
}

/**
 * First name only — for the compact chip on a to-do row, where the full name
 * eats the width the title needs. Menus and Settings still show the full name.
 */
export function memberFirstName(member) {
  return memberLabel(member).trim().split(/\s+/)[0]
}

/** Initials for the avatar bubble. */
function initials(member) {
  const label = memberLabel(member)
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return label.slice(0, 2).toUpperCase()
}

// Deterministic colour per user id so the same person keeps the same bubble
// colour everywhere, without storing a colour on the row.
const AVATAR_COLORS = [
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-teal-100 text-teal-700',
  'bg-fuchsia-100 text-fuchsia-700',
]
function colorFor(id) {
  if (!id) return 'bg-surface-container text-on-surface-variant'
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

/** Small round avatar — image when available, otherwise coloured initials. */
export function Avatar({ member, size = 'sm' }) {
  const dim = size === 'xs' ? 'w-5 h-5 text-[9px]' : 'w-6 h-6 text-[10px]'
  if (member?.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.image}
        alt=""
        className={`${dim} rounded-full object-cover shrink-0`}
      />
    )
  }
  return (
    <span
      className={`${dim} rounded-full flex items-center justify-center font-semibold shrink-0 ${colorFor(member?.id)}`}
      aria-hidden
    >
      {member ? initials(member) : '?'}
    </span>
  )
}

/**
 * Assignee control. Renders the current assignee (or an explicit "Unassigned"
 * state) and opens a menu to pick a member / clear the assignment.
 *
 * `value` is a user id or null; `members` is the assignable list. Purely
 * presentational — the parent owns persistence.
 */
export default function AssigneePicker({
  value,
  members = [],
  onChange,
  disabled = false,
  currentUserId = null,
  size = 'sm',
  align = 'left',
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selected = members.find((m) => m.id === value) ?? null
  // A to-do can carry an assignee who has since left the trip — still show
  // something meaningful rather than silently rendering as unassigned.
  const isUnassigned = !value

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (member) => {
    setOpen(false)
    onChange?.(member)
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={isUnassigned ? 'Unassigned — click to assign' : `Assigned to ${memberLabel(selected)}`}
        className={`inline-flex items-center gap-1.5 rounded-full border transition-colors disabled:opacity-50 ${
          size === 'xs' ? 'pl-0.5 pr-2 py-0.5 text-[10px]' : 'pl-1 pr-2.5 py-1 text-[11px]'
        } ${
          isUnassigned
            ? 'border-dashed border-outline/60 text-on-surface-variant hover:border-primary hover:text-primary'
            : 'border-transparent bg-surface-container text-on-surface hover:bg-surface-container/70'
        }`}
      >
        {isUnassigned ? (
          <>
            <span
              className={`${size === 'xs' ? 'w-5 h-5' : 'w-6 h-6'} rounded-full border border-dashed border-current/50 flex items-center justify-center shrink-0`}
              aria-hidden
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </span>
            <span className="font-medium">Unassigned</span>
          </>
        ) : (
          <>
            <Avatar member={selected ?? { id: value }} size={size} />
            <span className="font-medium truncate max-w-[8rem]">
              {selected ? memberFirstName(selected) : 'Former member'}
            </span>
          </>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute z-50 mt-1 min-w-[13rem] max-h-64 overflow-y-auto rounded-xl bg-white border border-outline/30 shadow-elevation-2 py-1 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {members.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-on-surface-variant">
              No one to assign yet — add people to this trip first.
            </p>
          )}
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={m.id === value}
              onClick={(e) => { e.stopPropagation(); pick(m) }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface-container transition-colors ${
                m.id === value ? 'bg-primary-light/50' : ''
              }`}
            >
              <Avatar member={m} />
              <span className="flex-1 min-w-0">
                <span className="block truncate text-on-surface">
                  {memberLabel(m)}
                  {m.id === currentUserId && (
                    <span className="text-on-surface-variant font-normal"> (you)</span>
                  )}
                </span>
                {m.email && (
                  <span className="block truncate text-[10px] text-on-surface-variant">{m.email}</span>
                )}
              </span>
              {m.id === value && (
                <svg className="w-3.5 h-3.5 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
          {!isUnassigned && (
            <>
              <div className="my-1 border-t border-outline/20" />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); pick(null) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-on-surface-variant hover:bg-surface-container transition-colors"
              >
                <span className="w-6 h-6 rounded-full border border-dashed border-current/50 flex items-center justify-center shrink-0" aria-hidden>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </span>
                Clear assignment
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
