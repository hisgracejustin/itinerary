"use client";

import { useState } from 'react'
import { useTripContext } from '../lib/trip-context'
import { useTodos } from '../hooks/useTodos'
import { useTrips } from '../hooks/useBookings'
import { friendlyError } from '../lib/friendlyError'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'

export default function Todos() {
  const { selectedTrip, tripMeta } = useTripContext()
  const { todos, loading, add, toggle, remove } = useTodos(selectedTrip)
  const { trips } = useTrips()
  const { toast } = useToast()
  const [newTodo, setNewTodo] = useState('')
  const [newTodoDate, setNewTodoDate] = useState('')
  const [newTodoTrip, setNewTodoTrip] = useState(selectedTrip || '')

  const incompleteTodos = todos.filter((t) => !t.completed)
  const completedTodos = todos.filter((t) => t.completed)

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!newTodo.trim()) return
    try {
      await add({
        title: newTodo.trim(),
        trip_id: newTodoTrip || null,
        due_date: newTodoDate || null,
      })
      setNewTodo('')
      setNewTodoDate('')
      toast.success('To-do added')
    } catch (err) {
      toast.error(friendlyError(err))
    }
  }

  return (
    <div className="h-full flex flex-col max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-medium text-on-surface">To-dos</h2>
        {tripMeta && (
          <span className="text-xs font-medium bg-primary-light text-primary px-3 py-1 rounded-full">
            {tripMeta.name}
          </span>
        )}
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="mat-surface p-4 mb-4 shrink-0">
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            placeholder="What needs to be done?"
            className="mat-input"
          />
          <button
            type="submit"
            className="mat-btn-filled shrink-0"
          >
            Add
          </button>
        </div>
        <div className="flex gap-2">
          <input
            type="date"
            value={newTodoDate}
            onChange={(e) => setNewTodoDate(e.target.value)}
            className="mat-input text-sm"
          />
          <select
            value={newTodoTrip}
            onChange={(e) => setNewTodoTrip(e.target.value)}
            className="mat-select"
          >
            <option value="">No trip</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>{trip.name}</option>
            ))}
          </select>
        </div>
      </form>

      {/* Todo list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Spinner />
            <span className="text-sm text-on-surface-variant">Loading to-dos...</span>
          </div>
        ) : todos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
            <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
              <svg className="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-sm font-medium">No to-dos yet</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {incompleteTodos.map((todo) => (
              <TodoItem key={todo.id} todo={todo} onToggle={toggle} onRemove={remove} />
            ))}

            {completedTodos.length > 0 && (
              <>
                <div className="pt-5 pb-2 px-1 text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
                  Completed ({completedTodos.length})
                </div>
                {completedTodos.map((todo) => (
                  <TodoItem key={todo.id} todo={todo} onToggle={toggle} onRemove={remove} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TodoItem({ todo, onToggle, onRemove }) {
  return (
    <div className={`flex items-start gap-3 p-3.5 rounded-xl bg-white border border-outline/20 hover:shadow-elevation-1 transition-all duration-150 group ${
      todo.completed ? 'opacity-50' : ''
    }`}>
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={() => onToggle(todo.id)}
        className="mt-0.5 w-[18px] h-[18px] rounded-md border-gray-300 text-primary focus:ring-primary/30 cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <span className={`text-sm block ${todo.completed ? 'line-through text-on-surface-variant' : 'text-on-surface'}`}>
          {todo.title}
        </span>
        <div className="flex items-center gap-2 mt-1">
          {todo.due_date && (
            <span className="text-[11px] text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-full">
              📅 {new Date(todo.due_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
          {todo.trip && (
            <span className="text-[11px] text-primary bg-primary-light px-2 py-0.5 rounded-full font-medium">
              {todo.trip}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={() => onRemove(todo.id)}
        className="text-on-surface-variant hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all duration-150 p-1 rounded-full hover:bg-red-50"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
