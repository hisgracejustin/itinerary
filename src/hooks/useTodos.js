"use client"

import { useState, useEffect, useCallback } from 'react'
import {
  getTodosAction,
  createTodoAction,
  updateTodoAction,
  deleteTodoAction,
} from '@/actions/todos'
import { unwrap } from '@/lib/friendlyError'

const getTodos = async (tripId) => unwrap(await getTodosAction(tripId ?? null))
const createTodo = async (todo) => unwrap(await createTodoAction(todo))
const updateTodo = async (id, updates) => unwrap(await updateTodoAction(id, updates))
const deleteTodo = async (id) => unwrap(await deleteTodoAction(id))

export function useTodos(tripId) {
  const [todos, setTodos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getTodos(tripId)
      setTodos(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [tripId])

  useEffect(() => { fetch() }, [fetch])

  const add = async (todo) => {
    const created = await createTodo(todo)
    setTodos((prev) => [...prev, created])
    return created
  }

  const update = async (id, updates) => {
    const updated = await updateTodo(id, updates)
    setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)))
    return updated
  }

  const toggle = async (id) => {
    const todo = todos.find((t) => t.id === id)
    if (!todo) return
    return update(id, { completed: !todo.completed })
  }

  const remove = async (id) => {
    await deleteTodo(id)
    setTodos((prev) => prev.filter((t) => t.id !== id))
  }

  return { todos, loading, error, refetch: fetch, add, update, toggle, remove }
}
