"use client";

import { useState } from 'react'
import {
  createTrip, updateTrip, deleteTrip,
  addTripMember, removeTripMember, setTripMemberRole,
  createParty, renameParty, deleteParty,
} from '@/lib/client-actions'
import { friendlyError } from '../lib/friendlyError'
import { useToast } from '../components/Toast'
import { Avatar, memberLabel, memberFirstName } from '../components/AssigneePicker'

const ROLES = [
  { value: 'owner', label: 'Owner', hint: 'Full control, including people and deleting the trip' },
  { value: 'editor', label: 'Editor', hint: 'Can add and change bookings, to-dos and notes' },
  { value: 'viewer', label: 'Viewer', hint: 'Read-only' },
]

const blankTrip = { name: '', start_date: '', end_date: '' }

export default function Settings({ trips: tripsProp, currentUserId }) {
  const trips = tripsProp ?? []
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [showNewTrip, setShowNewTrip] = useState(false)
  const [newTrip, setNewTrip] = useState(blankTrip)

  // Server actions revalidate the layout, so `trips` re-seeds from fresh props
  // after every mutation — no local list state to keep in sync.
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

  const handleCreateTrip = async (e) => {
    e.preventDefault()
    if (!newTrip.name.trim() || !newTrip.start_date || !newTrip.end_date) return
    const ok = await run(() => createTrip(newTrip), `${newTrip.name} created`)
    if (ok) {
      setNewTrip(blankTrip)
      setShowNewTrip(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto w-full max-w-3xl mx-auto pb-10">
      <h2 className="text-xl font-medium text-on-surface mb-1">Settings</h2>
      <p className="text-sm text-on-surface-variant mb-6">
        Manage your trips and who has access to them.
      </p>

      {/* Trips */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-on-surface">Trips</h3>
          <button
            onClick={() => setShowNewTrip((v) => !v)}
            className="mat-btn-outlined text-xs"
          >
            {showNewTrip ? 'Cancel' : '+ New trip'}
          </button>
        </div>

        {showNewTrip && (
          <form onSubmit={handleCreateTrip} className="mat-surface p-4 mb-3 space-y-3">
            <input
              type="text"
              placeholder="Trip name"
              value={newTrip.name}
              onChange={(e) => setNewTrip({ ...newTrip, name: e.target.value })}
              className="mat-input"
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-medium text-on-surface-variant uppercase tracking-wide block mb-1">Start</span>
                <input
                  type="date"
                  value={newTrip.start_date}
                  onChange={(e) => setNewTrip({ ...newTrip, start_date: e.target.value })}
                  className="mat-input"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-on-surface-variant uppercase tracking-wide block mb-1">End</span>
                <input
                  type="date"
                  value={newTrip.end_date}
                  onChange={(e) => setNewTrip({ ...newTrip, end_date: e.target.value })}
                  className="mat-input"
                />
              </label>
            </div>
            <button type="submit" disabled={busy} className="mat-btn-filled w-full justify-center disabled:opacity-40">
              {busy ? 'Creating…' : 'Create trip'}
            </button>
          </form>
        )}

        {trips.length === 0 ? (
          <p className="text-sm text-on-surface-variant py-6 text-center">
            No trips yet — create one to get started.
          </p>
        ) : (
          <div className="space-y-3">
            {trips.map((trip) => (
              <TripCard
                key={trip.id}
                trip={trip}
                currentUserId={currentUserId}
                busy={busy}
                run={run}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function TripCard({ trip, currentUserId, busy, run }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    name: trip.name,
    start_date: trip.start_date,
    end_date: trip.end_date,
  })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')

  const isOwner = trip.myRole === 'owner'
  const ownerCount = trip.members.filter((m) => m.role === 'owner').length
  const partyById = new Map((trip.parties || []).map((p) => [p.id, p]))

  const saveTrip = async (e) => {
    e.preventDefault()
    if (!draft.name.trim()) return
    const ok = await run(() => updateTrip(trip.id, draft), 'Trip updated')
    if (ok) setEditing(false)
  }

  const addPerson = async (e) => {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    const ok = await run(
      () => addTripMember({ trip_id: trip.id, email: trimmed, role }),
      `${trimmed} added`,
    )
    if (ok) setEmail('')
  }

  return (
    <div className="mat-surface p-4">
      {/* Trip header / edit form */}
      {editing ? (
        <form onSubmit={saveTrip} className="space-y-3 mb-4">
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="mat-input"
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium text-on-surface-variant uppercase tracking-wide block mb-1">Start</span>
              <input
                type="date"
                value={draft.start_date}
                onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
                className="mat-input"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-on-surface-variant uppercase tracking-wide block mb-1">End</span>
              <input
                type="date"
                value={draft.end_date}
                onChange={(e) => setDraft({ ...draft, end_date: e.target.value })}
                className="mat-input"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="mat-btn-outlined">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="mat-btn-filled disabled:opacity-40">
              Save
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h4 className="text-base font-medium text-on-surface truncate">{trip.name}</h4>
            <p className="text-xs text-on-surface-variant">
              {trip.start_date} → {trip.end_date}
              {trip.myRole && <span className="ml-2 uppercase tracking-wide">· {trip.myRole}</span>}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => { setDraft({ name: trip.name, start_date: trip.start_date, end_date: trip.end_date }); setEditing(true) }}
              className="mat-btn-outlined text-xs"
            >
              Edit
            </button>
            {isOwner && (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-on-surface-variant hover:text-red-500 p-2 rounded-full hover:bg-red-50 transition-colors"
                aria-label={`Delete ${trip.name}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200">
          <p className="text-xs text-red-700 mb-2">
            Delete <strong>{trip.name}</strong>? Everything on it is deleted too — bookings,
            to-dos, day notes and reminders. This can&apos;t be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(false)} className="mat-btn-outlined text-xs">
              Cancel
            </button>
            <button
              onClick={() => run(() => deleteTrip(trip.id), `${trip.name} deleted`)}
              disabled={busy}
              className="px-4 py-2 text-xs font-medium text-white bg-red-600 rounded-full hover:bg-red-700 disabled:opacity-40"
            >
              Delete trip
            </button>
          </div>
        </div>
      )}

      {/* People */}
      <div className="border-t border-outline/20 pt-3">
        <h5 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
          People ({trip.members.length})
        </h5>
        <ul className="space-y-1 mb-3">
          {trip.members.map((m) => {
            // Guard the UI against the same rule the server enforces, so the
            // control is visibly unavailable rather than failing on submit.
            const lastOwner = m.role === 'owner' && ownerCount <= 1
            return (
              <li key={m.id} className="flex items-center gap-2.5 py-1">
                <Avatar member={m} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-on-surface truncate">
                    {memberLabel(m)}
                    {m.id === currentUserId && <span className="text-on-surface-variant"> (you)</span>}
                  </span>
                  <span className="block text-[11px] text-on-surface-variant truncate">{m.email}</span>
                  {m.party_id && partyById.has(m.party_id) && (
                    <span className="inline-flex items-center gap-1 mt-0.5 max-w-full text-[10px] font-medium text-primary bg-primary-light px-1.5 py-0.5 rounded-full">
                      <span aria-hidden>👥</span>
                      <span className="truncate min-w-0">{partyById.get(m.party_id).name}</span>
                    </span>
                  )}
                </span>
                {isOwner ? (
                  <select
                    value={m.role}
                    disabled={busy || lastOwner}
                    title={lastOwner ? 'A trip needs at least one owner' : 'Change role'}
                    onChange={(e) =>
                      run(
                        () => setTripMemberRole({ trip_id: trip.id, user_id: m.id, role: e.target.value }),
                        `${memberLabel(m)} is now ${e.target.value}`,
                      )
                    }
                    className="mat-select text-xs shrink-0 disabled:opacity-50"
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[10px] uppercase tracking-wide text-on-surface-variant shrink-0">
                    {m.role}
                  </span>
                )}
                {isOwner && (
                  <button
                    onClick={() =>
                      run(
                        () => removeTripMember({ trip_id: trip.id, user_id: m.id }),
                        `${memberLabel(m)} removed`,
                      )
                    }
                    disabled={busy || lastOwner}
                    aria-label={`Remove ${memberLabel(m)}`}
                    title={lastOwner ? 'A trip needs at least one owner' : 'Remove from trip'}
                    className="text-on-surface-variant hover:text-red-500 p-1 rounded-full hover:bg-red-50 transition-colors disabled:opacity-30 disabled:hover:bg-transparent shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </li>
            )
          })}
        </ul>

        {isOwner && <PartyManager trip={trip} busy={busy} run={run} />}

        {isOwner ? (
          <form onSubmit={addPerson} className="space-y-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Add someone by email"
              className="mat-input"
            />
            <div className="flex gap-2">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                aria-label="Role for the new member"
                className="mat-select shrink-0"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={busy || !email.trim()}
                className="mat-btn-filled flex-1 justify-center disabled:opacity-40"
              >
                Add to trip
              </button>
            </div>
            <p className="text-[11px] text-on-surface-variant leading-relaxed">
              They can be assigned to-dos right away. To actually sign in, their email must
              also be on the app&apos;s allowlist.
            </p>
          </form>
        ) : (
          <p className="text-[11px] text-on-surface-variant">
            Only owners can add or remove people.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Owner-only party grouping: treat a couple/group as one settlement unit. Pick
 * 2+ ungrouped members → name (defaults to "A & B") → group. Existing groups can
 * be renamed or ungrouped (which detaches its members via the FK's set-null).
 */
function PartyManager({ trip, busy, run }) {
  const parties = trip.parties || []
  const [sel, setSel] = useState([])
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState(null) // party_id being renamed
  const [renameValue, setRenameValue] = useState('')

  const memberById = new Map(trip.members.map((m) => [m.id, m]))
  const ungrouped = trip.members.filter((m) => !m.party_id)

  const defaultName = (ids) =>
    ids.map((id) => memberFirstName(memberById.get(id))).filter(Boolean).join(' & ')

  const toggleSel = (id) => {
    setSel((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      // Keep the name in step with the selection unless the user has typed a
      // custom one that no longer matches any auto value.
      setName((cur) => (cur === '' || cur === defaultName(prev) ? defaultName(next) : cur))
      return next
    })
  }

  const create = async () => {
    if (sel.length < 2) return
    const ok = await run(
      () => createParty({ trip_id: trip.id, name: (name.trim() || defaultName(sel)), member_ids: sel }),
      'Group created',
    )
    if (ok) { setSel([]); setName('') }
  }

  const saveRename = async (party_id) => {
    if (!renameValue.trim()) return
    const ok = await run(
      () => renameParty({ trip_id: trip.id, party_id, name: renameValue.trim() }),
      'Group renamed',
    )
    if (ok) setRenaming(null)
  }

  return (
    <div className="border-t border-outline/20 pt-3 mb-3">
      <h5 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
        Couples &amp; groups
      </h5>
      <p className="text-[11px] text-on-surface-variant mb-2 leading-relaxed">
        Group people who settle together (a couple) so they show as one unit on Settle up.
      </p>

      {/* Existing groups */}
      {parties.length > 0 && (
        <ul className="space-y-2 mb-3">
          {parties.map((p) => {
            const groupMembers = trip.members.filter((m) => m.party_id === p.id)
            return (
              <li key={p.id} className="rounded-xl border border-outline/30 p-2.5">
                {renaming === p.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="mat-input flex-1"
                      aria-label="Group name"
                    />
                    <button onClick={() => saveRename(p.id)} disabled={busy} className="mat-btn-filled text-xs disabled:opacity-40">Save</button>
                    <button onClick={() => setRenaming(null)} className="mat-btn-outlined text-xs">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex -space-x-1.5 shrink-0">
                      {groupMembers.slice(0, 3).map((m) => <Avatar key={m.id} member={m} size="xs" />)}
                    </span>
                    <span className="text-sm text-on-surface font-medium truncate min-w-0 flex-1">{p.name}</span>
                    <button
                      onClick={() => { setRenaming(p.id); setRenameValue(p.name) }}
                      disabled={busy}
                      className="text-[11px] text-primary font-medium hover:underline disabled:opacity-40 shrink-0"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => run(() => deleteParty({ trip_id: trip.id, party_id: p.id }), 'Group removed')}
                      disabled={busy}
                      className="text-[11px] text-on-surface-variant hover:text-red-500 font-medium disabled:opacity-40 shrink-0"
                    >
                      Ungroup
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Group creator */}
      {ungrouped.length >= 2 ? (
        <div className="rounded-xl border border-dashed border-outline/40 p-2.5 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {ungrouped.map((m) => {
              const active = sel.includes(m.id)
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleSel(m.id)}
                  className={`inline-flex items-center gap-1.5 min-w-0 max-w-[10rem] pl-1 pr-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                    active
                      ? 'border-primary bg-primary-light text-primary'
                      : 'border-outline/30 bg-white text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  <Avatar member={m} size="xs" />
                  <span className="truncate min-w-0">{memberFirstName(m)}</span>
                </button>
              )
            })}
          </div>
          {sel.length >= 2 && (
            <div className="flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Group name"
                className="mat-input flex-1"
                aria-label="Group name"
              />
              <button onClick={create} disabled={busy} className="mat-btn-filled text-xs shrink-0 disabled:opacity-40">
                {busy ? 'Saving…' : 'Group as couple'}
              </button>
            </div>
          )}
        </div>
      ) : (
        parties.length === 0 && (
          <p className="text-[11px] text-on-surface-variant/70">
            Add at least two people to this trip to group them.
          </p>
        )
      )}
    </div>
  )
}
