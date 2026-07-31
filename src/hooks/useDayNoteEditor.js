"use client"

import { useRef, useState } from 'react'
import { friendlyError } from '../lib/friendlyError'

/**
 * Inline day-title ("day note") editor state, shared by the desktop month grid,
 * the journey rail and the mobile month view so all three behave identically.
 *
 * `onUpsertDayNote` is Calendar's handler — an empty title deletes server-side.
 * `onError` receives a friendly message when a save is rejected; failures keep
 * the editor open rather than reading as "Enter does nothing".
 */
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

  // `title` is explicit (not always noteText) so the delete can pass ''.
  const saveNote = async (dateStr, title, tripId) => {
    try {
      await onUpsertDayNote?.({ date: dateStr, title, trip_id: tripId })
      setEditingNoteDate(null)
    } catch (err) {
      onError?.(friendlyError(err))
    }
  }

  const deleteNote = (dateStr, tripId) => {
    if (deletingRef.current === dateStr) return
    deletingRef.current = dateStr
    saveNote(dateStr, '', tripId).finally(() => { deletingRef.current = null })
  }

  /** Spread onto the trash button — the delete runs before any blur can. */
  const deleteButtonProps = (dateStr, tripId) => ({
    type: 'button',
    onMouseDown: (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      deleteNote(dateStr, tripId)
    },
    // Keyboard activation (and any engine that skips mousedown) still lands here.
    onClick: () => deleteNote(dateStr, tripId),
  })

  /** Blur-save, skipped when a delete owns the gesture or focus stayed in the form. */
  const blurSave = (e, dateStr, title, tripId) => {
    if (deletingRef.current) return
    if (e.relatedTarget && e.currentTarget.form?.contains(e.relatedTarget)) return
    saveNote(dateStr, title, tripId)
  }

  return {
    editingNoteDate,
    setEditingNoteDate,
    noteText,
    setNoteText,
    saveNote,
    blurSave,
    deleteButtonProps,
  }
}
