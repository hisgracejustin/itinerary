import { supabase } from './supabase'

export async function getDayNotes(tripId) {
  let query = supabase.from('day_notes').select('*').order('date')

  if (tripId) {
    query = query.eq('trip_id', tripId)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

export async function upsertDayNote({ date, title, trip_id }) {
  let query = supabase.from('day_notes').select('*').eq('date', date)
  if (trip_id) query = query.eq('trip_id', trip_id)

  const { data: existing } = await query

  // If title is empty, delete the note
  if (!title.trim()) {
    if (existing && existing.length > 0) {
      const { error } = await supabase.from('day_notes').delete().eq('id', existing[0].id)
      if (error) throw new Error(error.message)
    }
    return null
  }

  if (existing && existing.length > 0) {
    // Update
    const { data, error } = await supabase
      .from('day_notes')
      .update({ title: title.trim() })
      .eq('id', existing[0].id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  } else {
    // Insert
    const { data, error } = await supabase
      .from('day_notes')
      .insert({ id: crypto.randomUUID(), date, title: title.trim(), trip_id: trip_id || null })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  }
}

export async function deleteDayNote(id) {
  const { error } = await supabase.from('day_notes').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
