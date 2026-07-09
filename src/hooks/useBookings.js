"use client"

import { useState, useEffect, useCallback } from 'react'
import {
  getBookingsAction,
  getBookingAction,
  createBookingAction,
  updateBookingAction,
  deleteBookingAction,
  getTripsAction,
  getTripMetaAction,
} from '@/actions/bookings'
import { unwrap } from '@/lib/friendlyError'

// Client wrappers over the Server Actions (return data / throw on error) — the
// client → "use server" import establishes the RPC boundary so the DB layer
// never enters the browser bundle.
const getBookings = async (tripId) => unwrap(await getBookingsAction(tripId ?? null))
const getBooking = async (id) => unwrap(await getBookingAction(id))
const createBooking = async (booking) => unwrap(await createBookingAction(booking))
const updateBooking = async (id, updates) => unwrap(await updateBookingAction(id, updates))
const deleteBooking = async (id) => unwrap(await deleteBookingAction(id))
const getTrips = async () => unwrap(await getTripsAction())
const getTripMeta = async (tripId) => unwrap(await getTripMetaAction(tripId ?? null))

export function useBookings(tripId) {
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getBookings(tripId)
      setBookings(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [tripId])

  useEffect(() => { fetch() }, [fetch])

  const add = async (booking) => {
    const created = await createBooking(booking)
    setBookings((prev) => [...prev, created].sort((a, b) => a.start_date.localeCompare(b.start_date)))
    return created
  }

  const update = async (id, updates) => {
    const updated = await updateBooking(id, updates)
    setBookings((prev) =>
      prev.map((b) => (b.id === id ? updated : b)).sort((a, b) => a.start_date.localeCompare(b.start_date))
    )
    return updated
  }

  const remove = async (id) => {
    await deleteBooking(id)
    setBookings((prev) => prev.filter((b) => b.id !== id))
  }

  return { bookings, loading, error, refetch: fetch, add, update, remove }
}

export function useBooking(id) {
  const [booking, setBooking] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    getBooking(id)
      .then(setBooking)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  return { booking, loading, error }
}

/**
 * Returns trip objects: [{ id, name, start_date, end_date }, ...]
 */
export function useTrips() {
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getTrips()
      setTrips(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { trips, loading, error, refetch: fetch }
}

export function useTripMeta(tripId) {
  const [tripMeta, setTripMeta] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!tripId) { setTripMeta(null); return }
    setLoading(true)
    getTripMeta(tripId)
      .then(setTripMeta)
      .catch(() => setTripMeta(null))
      .finally(() => setLoading(false))
  }, [tripId])

  return { tripMeta, loading }
}
