import { supabase } from './supabase'

export async function getBookings(tripId) {
  let query = supabase
    .from('bookings')
    .select('*')
    .order('start_date', { ascending: true })

  if (tripId) {
    query = query.eq('trip_id', tripId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getBooking(id) {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createBooking(booking) {
  const record = {
    id: booking.id || crypto.randomUUID(),
    trip_id: booking.trip_id,
    type: booking.type,
    title: booking.title,
    start_date: booking.start_date,
    end_date: booking.end_date || null,
    confirmation_number: booking.confirmation_number || null,
    provider: booking.provider || null,
    details: booking.details || null,
    cost_amount: booking.cost_amount || null,
    cost_currency: booking.cost_currency || null,
    cost_share: booking.cost_share != null ? booking.cost_share : null,
    source: booking.source || 'manual',
    source_file: booking.source_file || null,
    raw_text: booking.raw_text || null,
  }

  const { data, error } = await supabase
    .from('bookings')
    .insert(record)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateBooking(id, updates) {
  const { data, error } = await supabase
    .from('bookings')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteBooking(id) {
  const { error } = await supabase
    .from('bookings')
    .delete()
    .eq('id', id)

  if (error) throw error
}

/**
 * Get all trips the current user has access to (RLS handles filtering).
 * Returns array of trip objects: { id, name, start_date, end_date }
 */
export async function getTrips() {
  const { data, error } = await supabase
    .from('trips')
    .select('id, name, start_date, end_date')
    .order('start_date', { ascending: true })

  if (error) throw error
  return data || []
}

/**
 * Get trip metadata by ID.
 */
export async function getTripMeta(tripId) {
  if (!tripId) return null
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single()

  if (error) return null
  return data
}

/**
 * Create a new trip and auto-assign the current user as owner.
 */
export async function createTrip({ name, start_date, end_date }) {
  const { data, error } = await supabase
    .from('trips')
    .insert({ name, start_date, end_date })
    .select()
    .single()

  if (error) throw error

  // Auto-assign creator as owner
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await supabase.from('trip_members').insert({
      trip_id: data.id,
      user_id: user.id,
      role: 'owner',
    })
  }

  return data
}
