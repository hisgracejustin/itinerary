"use client"

import { useState, useEffect, useCallback } from 'react'
import {
  getDayNotesAction,
  upsertDayNoteAction,
  deleteDayNoteAction,
} from '@/actions/dayNotes'
import { unwrap } from '@/lib/friendlyError'

const getDayNotes = async (tripId) => unwrap(await getDayNotesAction(tripId ?? null))
const upsertDayNote = async (input) => unwrap(await upsertDayNoteAction(input))
const deleteDayNote = async (id) => unwrap(await deleteDayNoteAction(id))

export function useDayNotes(tripId) {
  const [dayNotes, setDayNotes] = useState([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getDayNotes(tripId)
      setDayNotes(data)
    } catch (err) {
      console.error('Failed to load day notes:', err)
    } finally {
      setLoading(false)
    }
  }, [tripId])

  useEffect(() => { fetch() }, [fetch])

  const upsert = async ({ date, title, trip_id }) => {
    const result = await upsertDayNote({ date, title, trip_id: trip_id || tripId || null })
    if (result) {
      setDayNotes((prev) => {
        const existing = prev.findIndex((n) => n.date === date)
        if (existing >= 0) {
          const updated = [...prev]
          updated[existing] = result
          return updated
        }
        return [...prev, result]
      })
    } else {
      setDayNotes((prev) => prev.filter((n) => n.date !== date))
    }
    return result
  }

  const remove = async (id) => {
    await deleteDayNote(id)
    setDayNotes((prev) => prev.filter((n) => n.id !== id))
  }

  const getNoteForDate = (dateStr) => {
    return dayNotes.find((n) => n.date === dateStr)
  }

  return { dayNotes, loading, upsert, remove, getNoteForDate, refetch: fetch }
}
