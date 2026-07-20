"use client";

import { useState } from 'react'
import { addTripMember, removeTripMember } from '@/lib/client-actions'
import { friendlyError } from '../lib/friendlyError'
import { useToast } from './Toast'
import { Avatar, memberLabel } from './AssigneePicker'

/**
 * Manage who's on a trip. Members are real accounts — adding someone by email
 * creates/links their user row so they can be assigned to-dos, but they still
 * need to be on the app's sign-in allowlist to actually log in.
 *
 * Only trip owners can add/remove, matching the server-side check.
 */
export default function TripPeopleModal({ tripId, tripName, members, currentUserId, onClose }) {
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')
  const [busy, setBusy] = useState(false)

  const handleAdd = async (e) => {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await addTripMember({ trip_id: tripId, email: trimmed, role })
      setEmail('')
      toast.success(`${trimmed} added to ${tripName}`)
    } catch (err) {
      toast.error(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (member) => {
    setBusy(true)
    try {
      await removeTripMember({ trip_id: tripId, user_id: member.id })
      toast.success(`${memberLabel(member)} removed`)
    } catch (err) {
      toast.error(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-elevation-3 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline/20 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-medium text-on-surface">People</h3>
            <p className="text-xs text-on-surface-variant truncate">{tripName}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="mat-icon-btn">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <ul className="space-y-1 mb-5">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2.5 py-1.5">
                <Avatar member={m} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-on-surface truncate">
                    {memberLabel(m)}
                    {m.id === currentUserId && (
                      <span className="text-on-surface-variant"> (you)</span>
                    )}
                  </span>
                  <span className="block text-[11px] text-on-surface-variant truncate">{m.email}</span>
                </span>
                {m.role && (
                  <span className="text-[10px] uppercase tracking-wide text-on-surface-variant shrink-0">
                    {m.role}
                  </span>
                )}
                <button
                  onClick={() => handleRemove(m)}
                  disabled={busy}
                  aria-label={`Remove ${memberLabel(m)}`}
                  className="text-on-surface-variant hover:text-red-500 p-1 rounded-full hover:bg-red-50 transition-colors disabled:opacity-40 shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>

          <form onSubmit={handleAdd} className="space-y-2 border-t border-outline/20 pt-4">
            <label htmlFor="add-member-email" className="block text-xs font-medium text-on-surface-variant">
              Add someone by email
            </label>
            <input
              id="add-member-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="mat-input"
            />
            <div className="flex gap-2">
              {/* mat-select (not mat-input) — mat-input is w-full and would
                  starve the button on this row. */}
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                aria-label="Role"
                className="mat-select shrink-0"
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
                <option value="owner">Owner</option>
              </select>
              <button
                type="submit"
                disabled={busy || !email.trim()}
                className="mat-btn-filled flex-1 justify-center disabled:opacity-40"
              >
                {busy ? 'Working…' : 'Add to trip'}
              </button>
            </div>
            <p className="text-[11px] text-on-surface-variant leading-relaxed">
              They can be assigned to-dos right away. To actually sign in, their
              email must also be on the app&apos;s allowlist.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
