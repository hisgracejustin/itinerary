"use client";

import { useState } from 'react'
import {
  createTrip, updateTrip, deleteTrip,
  addTripMember, removeTripMember, setTripMemberRole, updateMemberProfile, setMemberPin, setMyAvatar, setMemberAvatar, deleteUser,
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

// `allPeople` is the admin-only full account list (null for everyone else).
export default function Settings({ trips: tripsProp, currentUserId, isAdmin = false, allPeople: adminPeople }) {
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

  // Union of everyone across the viewer's trips, deduped by user id. Name,
  // email, image, has_account and has_pin are user-level, so the first
  // occurrence is as good as any; role/party_id are trip-scoped and ignored here.
  const peopleById = new Map()
  for (const trip of trips) {
    for (const m of trip.members) {
      if (!peopleById.has(m.id)) {
        peopleById.set(m.id, { ...m, trips: [] })
      }
      peopleById.get(m.id).trips.push(trip.name)
    }
  }
  // Admins see every account instead — the trip-derived roster silently omits
  // anyone who signed in but was never added to a trip, and those strays are
  // exactly who an admin needs to find. The server list already carries each
  // person's trips (across ALL trips, not just the viewer's).
  const rosterPeople = [...peopleById.values()]
  const allPeople = (isAdmin && adminPeople ? adminPeople : rosterPeople)
    .map((p) => ({ ...p, trips: p.trips ?? [] }))
    .sort((a, b) => {
      if (a.id === currentUserId) return -1
      if (b.id === currentUserId) return 1
      // Strays sink to the bottom of the list, together.
      if ((a.trips.length > 0) !== (b.trips.length > 0)) return a.trips.length > 0 ? -1 : 1
      return memberLabel(a).localeCompare(memberLabel(b))
    })
  const tripless = allPeople.filter((p) => p.trips.length === 0).length

  // Trip cards are long; collapsing them turns the page into a list you can
  // scan. Everything starts expanded (the shape this screen has always had) and
  // collapse is per-card, so "collapse all" then opening the one you're editing
  // is two taps. Kept in memory only — a fresh visit is expanded again.
  const [collapsedTrips, setCollapsedTrips] = useState(() => new Set())
  const allCollapsed = trips.length > 0 && trips.every((t) => collapsedTrips.has(t.id))
  const toggleTrip = (id) =>
    setCollapsedTrips((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAllTrips = () =>
    setCollapsedTrips(allCollapsed ? new Set() : new Set(trips.map((t) => t.id)))

  return (
    <div className="w-full max-w-3xl lg:max-w-4xl mx-auto pb-10">
      <p className="text-sm text-on-surface-variant mb-6">
        Manage your trips and who has access to them.
      </p>

      {/* People — person-level stuff (name, email, PIN, avatar), shared across trips */}
      {allPeople.length > 0 && (
        <PeopleSection
          people={allPeople}
          trips={trips}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          showsEveryone={isAdmin && !!adminPeople}
          tripless={tripless}
          busy={busy}
          run={run}
        />
      )}

      {/* Trips */}
      <section className="mb-8">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-on-surface">Trips</h3>
          <div className="flex items-center gap-1 shrink-0">
            {trips.length > 0 && (
              <button
                onClick={toggleAllTrips}
                aria-label={allCollapsed ? 'Expand all trips' : 'Collapse all trips'}
                title={allCollapsed ? 'Expand all trips' : 'Collapse all trips'}
                className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary p-2 rounded-full hover:bg-primary-light transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {allCollapsed ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 13l-7 7-7-7m14-8l-7 7-7-7" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 11l7-7 7 7M5 19l7-7 7 7" />
                  )}
                </svg>
                <span className="hidden sm:inline">{allCollapsed ? 'Expand all' : 'Collapse all'}</span>
              </button>
            )}
            <button
              onClick={() => setShowNewTrip((v) => !v)}
              className="mat-btn-outlined text-xs"
            >
              {showNewTrip ? 'Cancel' : '+ New trip'}
            </button>
          </div>
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
                allPeople={allPeople}
                currentUserId={currentUserId}
                collapsed={collapsedTrips.has(trip.id)}
                onToggleCollapse={() => toggleTrip(trip.id)}
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

/**
 * Global People card: everyone across the viewer's trips, deduped — or, for an
 * admin, every account on the instance (`showsEveryone`), so people who signed
 * in but were never added to a trip are visible instead of silently missing.
 * Person-level management lives here — rename/email (pencil), sign-in PIN (key),
 * and the viewer's own avatar. Those writes are admin-gated server-side; a
 * trip-scoped edit passes a trip where the viewer is owner and the person is a
 * member, and an admin editing someone on no such trip passes none at all.
 */
function PeopleSection({ people, trips, currentUserId, isAdmin, showsEveryone, tripless, busy, run }) {
  const ownerTripIdFor = (personId) =>
    trips.find((t) => t.myRole === 'owner' && t.members.some((m) => m.id === personId))?.id ?? null

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-on-surface">People</h3>
        <span className="text-[11px] text-on-surface-variant">({people.length})</span>
        {showsEveryone && (
          <span className="text-[10px] uppercase tracking-wide text-primary bg-primary-light px-2 py-0.5 rounded-full">
            All accounts
          </span>
        )}
      </div>
      <div className="mat-surface p-4">
        <ul className="space-y-1">
          {people.map((p) => (
            <PersonRow
              key={p.id}
              p={p}
              ownerTripId={ownerTripIdFor(p.id)}
              isSelf={p.id === currentUserId}
              isAdmin={isAdmin}
              showTrips={showsEveryone}
              busy={busy}
              run={run}
            />
          ))}
        </ul>
        <p className="text-[11px] text-on-surface-variant leading-relaxed mt-2">
          {showsEveryone ? (
            <>
              Every account on this instance, not just your trips
              {tripless > 0 && ` — ${tripless} ${tripless === 1 ? 'person is' : 'people are'} on no trip yet`}
              . Someone on no trip and with nothing to their name can be deleted here;
              anyone else has to be taken off their trips first. Who&apos;s on which trip
              — and their role — is managed on each trip card below.
            </>
          ) : (
            <>
              Everyone across your trips. Who&apos;s on which trip — and their role — is
              managed on each trip card below.
            </>
          )}
        </p>
      </div>
    </section>
  )
}

const AVATAR_ICONS = Array.from({ length: 16 }, (_, i) => `icon${i + 1}.png`)

/**
 * One person in the global People card. Admins get the pencil (name/email) and
 * key (PIN) controls; the viewer's own row always gets the avatar picker.
 * Changing an email always unlinks their old login (and may absorb an unused
 * account on the new address), so we confirm first.
 *
 * `tripArgs` is spread into every person-level write: a trip that authorizes the
 * edit when there is one, and nothing at all for someone on no trip of the
 * viewer's — which the server accepts from an admin (the real gate) alone.
 */
function PersonRow({ p, ownerTripId, isSelf, isAdmin, showTrips, busy, run }) {
  // 'edit' | 'pin' | 'avatar' | null — which inline panel is open.
  const [mode, setMode] = useState(null)
  const [draft, setDraft] = useState({ name: p.name || '', email: p.email || '' })
  const [pinDraft, setPinDraft] = useState('')

  // Admin, not trip owner: every write behind these controls is `requireAdmin`
  // server-side (trip ownership is self-granted, so it must never confer the
  // right to rewrite someone's login identity). Gating the buttons on ownership
  // instead just showed a trip owner three controls that always failed with a
  // misleading "no permission to change this trip".
  const canManage = isAdmin
  const tripArgs = ownerTripId ? { trip_id: ownerTripId } : {}
  const close = () => { setMode(null); setPinDraft('') }

  // Safe delete: an admin, someone else, and on no trip at all.
  const canDelete = canManage && !isSelf && (p.trips?.length ?? 0) === 0
  const deleteAccount = async () => {
    const ok = window.confirm(
      `Delete ${memberLabel(p)} (${p.email})? Their account and any sign-in are removed for good. Only possible while they're on no trip and have no costs, splits or to-dos — otherwise this refuses and nothing changes.`,
    )
    if (!ok) return
    await run(() => deleteUser({ user_id: p.id }), `${memberLabel(p)} deleted`)
  }

  if (mode === 'edit') {
    const save = async (e) => {
      e.preventDefault()
      const name = draft.name.trim()
      const email = draft.email.trim()
      if (!name || !email) return
      const emailChanged = email.toLowerCase() !== (p.email || '').toLowerCase()
      if (emailChanged) {
        // One confirm covering both outcomes: the old sign-in is always dropped,
        // and if the new address already has an unused account it gets absorbed.
        const ok = window.confirm(
          `Change ${memberLabel(p)}'s email to ${email}? If ${email} belongs to an unused account, its login is absorbed into this person. Their PIN and old logins are cleared — they'll sign in with the new address.`,
        )
        if (!ok) return
      }
      const done = await run(
        () => updateMemberProfile({ ...tripArgs, user_id: p.id, name, email }),
        `${name} updated`,
      )
      if (done) close()
    }
    return (
      <li className="py-1.5">
        <form onSubmit={save} className="space-y-2">
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Name"
            aria-label="Name"
            className="mat-input"
          />
          <input
            type="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            placeholder="Email"
            aria-label="Email"
            className="mat-input"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="mat-btn-outlined text-xs">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !draft.name.trim() || !draft.email.trim()}
              className="mat-btn-filled text-xs disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </form>
      </li>
    )
  }

  if (mode === 'pin') {
    const savePin = async (e) => {
      e.preventDefault()
      const pin = pinDraft.trim()
      if (pin.length < 6) return
      const done = await run(
        () => setMemberPin({ ...tripArgs, user_id: p.id, pin }),
        `PIN set for ${memberLabel(p)} — share it with them`,
      )
      if (done) close()
    }
    const clearPin = async () => {
      const done = await run(
        () => setMemberPin({ ...tripArgs, user_id: p.id, pin: null }),
        `PIN removed for ${memberLabel(p)}`,
      )
      if (done) close()
    }
    return (
      <li className="py-1.5">
        <form onSubmit={savePin} className="space-y-2">
          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            {p.has_pin
              ? `${memberFirstName(p)} has a PIN — saving replaces it.`
              : `Lets ${memberFirstName(p)} sign in with their email and this PIN (no Google needed).`}
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={pinDraft}
              onChange={(e) => setPinDraft(e.target.value)}
              placeholder="PIN (6+ characters)"
              aria-label={`PIN for ${memberLabel(p)}`}
              minLength={6}
              autoComplete="off"
              className="mat-input flex-1"
            />
            <button
              type="button"
              onClick={() => setPinDraft(String(Math.floor(100000 + Math.random() * 900000)))}
              className="mat-btn-outlined text-xs shrink-0"
            >
              Generate
            </button>
          </div>
          <div className="flex items-center gap-2">
            {p.has_pin && (
              <button
                type="button"
                onClick={clearPin}
                disabled={busy}
                className="text-xs text-red-500 hover:underline disabled:opacity-40 mr-auto"
              >
                Remove PIN
              </button>
            )}
            <button type="button" onClick={close} className="mat-btn-outlined text-xs ml-auto">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || pinDraft.trim().length < 6}
              className="mat-btn-filled text-xs disabled:opacity-40"
            >
              Save PIN
            </button>
          </div>
        </form>
      </li>
    )
  }

  if (mode === 'avatar') {
    const pickIcon = async (icon) => {
      const done = await run(
        () =>
          isSelf
            ? setMyAvatar({ icon })
            : setMemberAvatar({ ...tripArgs, user_id: p.id, icon }),
        'Avatar updated',
      )
      if (done) close()
    }
    return (
      <li className="py-1.5">
        <p className="text-[11px] text-on-surface-variant leading-relaxed mb-2">
          {isSelf
            ? 'Pick your avatar — it shows next to your name on every trip.'
            : `Pick ${memberFirstName(p)}'s avatar — it shows next to their name on every trip.`}
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          {AVATAR_ICONS.map((icon) => {
            const src = `/icons/${icon}`
            const active = p.image === src
            return (
              <button
                key={icon}
                type="button"
                onClick={() => pickIcon(icon)}
                disabled={busy}
                aria-label={icon.replace('.png', '')}
                className={`rounded-full p-0.5 transition-shadow disabled:opacity-40 ${
                  active ? 'ring-2 ring-primary' : 'hover:ring-2 hover:ring-outline/40'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="w-10 h-10 rounded-full object-cover" />
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => pickIcon(null)}
            disabled={busy || !p.image}
            className="text-xs text-on-surface-variant hover:text-primary hover:underline disabled:opacity-40 mr-auto"
          >
            Use initials
          </button>
          <button type="button" onClick={close} className="mat-btn-outlined text-xs">
            Cancel
          </button>
        </div>
      </li>
    )
  }

  const badges = [p.has_account && 'verified', p.has_pin && 'PIN'].filter(Boolean)

  return (
    <li className="flex items-center gap-2.5 py-1">
      <Avatar member={p} />
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-on-surface truncate">
          {memberLabel(p)}
          {isSelf && <span className="text-on-surface-variant"> (you)</span>}
        </span>
        <span className="block text-[11px] text-on-surface-variant truncate">{p.email}</span>
        {/* Admin view only: which trips they're on, or a flag when the answer is
            "none" — the whole point of listing every account. Truncates rather
            than wrapping, so a long trip list can't blow up the row on mobile. */}
        {showTrips && (
          <span
            className={`block text-[10px] truncate ${p.trips.length === 0 ? 'text-amber-600' : 'text-on-surface-variant/70'}`}
            title={p.trips.length > 0 ? p.trips.join(' · ') : undefined}
          >
            {p.trips.length > 0 ? p.trips.join(' · ') : 'Not on any trip'}
          </span>
        )}
      </span>
      {badges.length > 0 && (
        <span className="text-[10px] uppercase tracking-wide text-on-surface-variant shrink-0">
          {badges.join(' · ')}
        </span>
      )}
      {(isSelf || canManage) && (
        <button
          onClick={() => setMode('avatar')}
          disabled={busy}
          aria-label={isSelf ? 'Change avatar' : `Change ${memberLabel(p)}'s avatar`}
          title="Change avatar"
          className="text-on-surface-variant hover:text-primary p-1 rounded-full hover:bg-primary-light transition-colors disabled:opacity-30 disabled:hover:bg-transparent shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      )}
      {canManage && (
        <button
          onClick={() => { setDraft({ name: p.name || '', email: p.email || '' }); setMode('edit') }}
          disabled={busy}
          aria-label={`Edit ${memberLabel(p)}`}
          title="Edit name and email"
          className="text-on-surface-variant hover:text-primary p-1 rounded-full hover:bg-primary-light transition-colors disabled:opacity-30 disabled:hover:bg-transparent shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      )}
      {canManage && (
        <button
          onClick={() => { setPinDraft(''); setMode('pin') }}
          disabled={busy}
          aria-label={`Set PIN for ${memberLabel(p)}`}
          title={p.has_pin ? 'PIN set — change or remove' : 'Set a sign-in PIN'}
          className={`${p.has_pin ? 'text-primary' : 'text-on-surface-variant'} hover:text-primary p-1 rounded-full hover:bg-primary-light transition-colors disabled:opacity-30 disabled:hover:bg-transparent shrink-0`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
        </button>
      )}
      {/* Delete only shows for someone on no trip — the necessary condition, and
          the only case an admin can act on from here. The server still re-checks
          the full footprint (splits, payments, to-dos, attachments) and refuses
          by name, so this is never a promise the row can't keep. */}
      {canDelete && (
        <button
          onClick={deleteAccount}
          disabled={busy}
          aria-label={`Delete ${memberLabel(p)}'s account`}
          title="Delete this account"
          className="text-on-surface-variant hover:text-red-500 p-1 rounded-full hover:bg-red-50 transition-colors disabled:opacity-30 disabled:hover:bg-transparent shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </li>
  )
}

/**
 * One trip: header (name/dates/role + edit/delete) above a roster, party manager
 * and add-person form. `collapsed` hides everything below the header — the
 * header itself, including the delete confirmation, always stays visible so a
 * collapsed card can still be renamed or deleted.
 */
function TripCard({ trip, allPeople, currentUserId, collapsed = false, onToggleCollapse, busy, run }) {
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
  // People the viewer already knows (from any trip) who aren't on this one —
  // one pick away instead of retyping their email.
  const memberIds = new Set(trip.members.map((m) => m.id))
  const addable = allPeople.filter((p) => !memberIds.has(p.id) && p.email)

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
        <div className={`flex items-start justify-between gap-3 ${collapsed ? '' : 'mb-4'}`}>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${trip.name}`}
            className="flex items-start gap-2 min-w-0 flex-1 text-left group"
          >
            <svg
              className={`w-4 h-4 mt-0.5 shrink-0 text-on-surface-variant group-hover:text-primary transition-transform ${collapsed ? '' : 'rotate-90'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="min-w-0">
              <span className="block text-base font-medium text-on-surface truncate">{trip.name}</span>
              <span className="block text-xs text-on-surface-variant">
                {trip.start_date} → {trip.end_date}
                {trip.myRole && <span className="ml-2 uppercase tracking-wide">· {trip.myRole}</span>}
                {/* Collapsed, the roster is hidden — keep its size in view. */}
                {collapsed && (
                  <span className="ml-2">
                    · {trip.members.length} {trip.members.length === 1 ? 'person' : 'people'}
                  </span>
                )}
              </span>
            </span>
          </button>
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
        <div className={`mb-4 p-3 rounded-xl bg-red-50 border border-red-200 ${collapsed ? 'mt-3' : ''}`}>
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
      <div className={`border-t border-outline/20 pt-3 ${collapsed ? 'hidden' : ''}`}>
        <h5 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
          People ({trip.members.length})
        </h5>
        <ul className="space-y-1 mb-3">
          {trip.members.map((m) => (
            <MemberRow
              key={m.id}
              m={m}
              trip={trip}
              currentUserId={currentUserId}
              isOwner={isOwner}
              lastOwner={m.role === 'owner' && ownerCount <= 1}
              partyById={partyById}
              busy={busy}
              run={run}
            />
          ))}
        </ul>

        {isOwner && <PartyManager trip={trip} busy={busy} run={run} />}

        {isOwner ? (
          <form onSubmit={addPerson} className="space-y-2">
            {addable.length > 0 && (
              <>
                <select
                  value=""
                  disabled={busy}
                  aria-label="Add someone you know"
                  onChange={(e) => {
                    const personEmail = e.target.value
                    if (!personEmail) return
                    run(
                      () => addTripMember({ trip_id: trip.id, email: personEmail, role }),
                      `${personEmail} added`,
                    )
                  }}
                  className="mat-select w-full disabled:opacity-50"
                >
                  <option value="">Add someone you know…</option>
                  {addable.map((p) => (
                    <option key={p.id} value={p.email}>
                      {memberLabel(p)} ({p.email})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-on-surface-variant text-center" aria-hidden>
                  — or add by email —
                </p>
              </>
            )}
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
              They can be assigned to-dos and splits right away. When they sign in with
              this email, they get this account automatically.
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
 * One person in a trip card's People list — trip-scoped concerns only: role
 * select and remove (owners), plus the party badge. Person-level editing
 * (name/email/PIN/avatar) lives in the global People card up top.
 */
function MemberRow({ m, trip, currentUserId, isOwner, lastOwner, partyById, busy, run }) {
  return (
    <li className="flex items-center gap-2.5 py-1">
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
