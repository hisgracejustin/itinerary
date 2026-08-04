"use client"

import { useRef, useState } from 'react'
import ConfirmDanger from '../components/ConfirmDanger'
import { friendlyError } from '../lib/friendlyError'

/**
 * Inline day-title ("day note") editor state, shared by the desktop month grid,
 * the journey rail and the mobile month view so all three behave identically.
 *
 * `onUpsertDayNote` is Calendar's handler — an empty title deletes server-side.
 * `onError` receives a friendly message when a save is rejected; failures keep
 * the editor open rather than reading as "Enter does nothing".
 */
/**
 * The trip a day-note write must target.
 *
 * A note is unique per (date, trip_id) and the server matches on that exact
 * pair, so an EXISTING note owns its trip — it is never safe to re-derive one
 * from the date. Every surface used to guess ("the selected trip, else the
 * first trip whose range covers this day"), which silently wrote to a
 * different slot whenever the guess disagreed with the note's real owner —
 * i.e. on any day two trips cover (a split journey's handover day) and under
 * "All Trips". The save then INSERTED a duplicate under the guessed trip
 * instead of updating, and the delete matched nothing and deleted nothing:
 * the note the user clicked stayed on screen, so the trash "did nothing".
 *
 * Only a brand-new note has no owner yet — that is the one case the
 * date-derived `fallbackTripId` is for.
 */
export function noteTripId(dayNote, fallbackTripId) {
  return dayNote?.trip_id ?? fallbackTripId ?? null
}

export default function useDayNoteEditor(onUpsertDayNote, onError) {
  const [editingNoteDate, setEditingNoteDate] = useState(null)
  const [noteText, setNoteText] = useState('')
  // The trash button races the input's blur-save. Chromium honours
  // preventDefault on mousedown and keeps focus in the input, but Safari blurs
  // regardless: the blur-save then re-persists the OLD title, closes the editor
  // and unmounts the button before its click can dispatch — the delete never
  // ran. So the delete fires on mousedown and claims the gesture here; the
  // blur-save and the trailing click both no-op while this holds a date.
  const deletingRef = useRef(null)
  // Pending trash confirm — holds { dateStr, tripId } while the danger dialog
  // is open. deletingRef stays set the whole time so a blur during the dialog
  // can't re-save the title underneath.
  const [pendingDelete, setPendingDelete] = useState(null)

  // `title` is explicit (not always noteText) so the delete can pass ''.
  const saveNote = async (dateStr, title, tripId) => {
    try {
      await onUpsertDayNote?.({ date: dateStr, title, trip_id: tripId })
      setEditingNoteDate(null)
    } catch (err) {
      onError?.(friendlyError(err))
    }
  }

  const requestDelete = (dateStr, tripId) => {
    if (deletingRef.current === dateStr) return
    deletingRef.current = dateStr
    setPendingDelete({ dateStr, tripId })
  }

  const confirmDelete = () => {
    const pending = pendingDelete
    setPendingDelete(null)
    if (!pending) {
      deletingRef.current = null
      return
    }
    saveNote(pending.dateStr, '', pending.tripId).finally(() => {
      deletingRef.current = null
    })
  }

  const cancelDelete = () => {
    setPendingDelete(null)
    deletingRef.current = null
  }

  /** Spread onto the trash button — the confirm opens before any blur can. */
  const deleteButtonProps = (dateStr, tripId) => ({
    type: 'button',
    onMouseDown: (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      requestDelete(dateStr, tripId)
    },
    // Keyboard activation (and any engine that skips mousedown) still lands here.
    onClick: () => requestDelete(dateStr, tripId),
  })

  /** Blur-save, skipped when a delete owns the gesture or focus stayed in the form. */
  const blurSave = (e, dateStr, title, tripId) => {
    if (deletingRef.current) return
    if (e.relatedTarget && e.currentTarget.form?.contains(e.relatedTarget)) return
    saveNote(dateStr, title, tripId)
  }

  const confirmDialog = pendingDelete ? (
    <ConfirmDanger
      title="Delete this day title?"
      message="The title for this day will be permanently removed. This cannot be undone."
      confirmLabel="Delete"
      onCancel={cancelDelete}
      onConfirm={confirmDelete}
    />
  ) : null

  return {
    editingNoteDate,
    setEditingNoteDate,
    noteText,
    setNoteText,
    saveNote,
    blurSave,
    deleteButtonProps,
    confirmDialog,
  }
}
