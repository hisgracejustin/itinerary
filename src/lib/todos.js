import { supabase } from './supabase'

export async function getTodos(tripId) {
  let query = supabase
    .from('todos')
    .select('*')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (tripId) {
    query = query.eq('trip_id', tripId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function createTodo(todo) {
  const record = {
    id: todo.id || crypto.randomUUID(),
    trip_id: todo.trip_id || null,
    title: todo.title,
    due_date: todo.due_date || null,
    completed: todo.completed || false,
  }

  const { data, error } = await supabase
    .from('todos')
    .insert(record)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateTodo(id, updates) {
  const { data, error } = await supabase
    .from('todos')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteTodo(id) {
  const { error } = await supabase
    .from('todos')
    .delete()
    .eq('id', id)

  if (error) throw error
}
