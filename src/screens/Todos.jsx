"use client";

import { useState, useRef, useEffect } from 'react'
import {
  DndContext, DragOverlay, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTripContext } from '../lib/trip-context'
import { useTodoList } from '../hooks/useTodoList'
import { friendlyError } from '../lib/friendlyError'
import { useToast } from '../components/Toast'

// Lock drag movement to the vertical axis (a one-line modifier — no need for the
// @dnd-kit/modifiers package). Keeps rows from drifting sideways.
const restrictToVerticalAxis = ({ transform }) => ({ ...transform, x: 0 })

export default function Todos({ initialTodos }) {
  const { selectedTrip, tripMeta, trips } = useTripContext()
  const { toast } = useToast()
  const { todos, add, edit, reorder, toggle, remove } = useTodoList(initialTodos, {
    onError: (err) => toast.error(friendlyError(err)),
  })
  const [newTodo, setNewTodo] = useState('')
  const [newTodoDate, setNewTodoDate] = useState('')
  const [newTodoTrip, setNewTodoTrip] = useState(selectedTrip || '')
  const [editingId, setEditingId] = useState(null)
  const [activeId, setActiveId] = useState(null)

  // Manual order: sort by the persisted `position` (matches the server) so
  // dragged rows stay where the user dropped them. created_at breaks ties.
  const byPosition = (a, b) =>
    (a.position ?? 0) - (b.position ?? 0) ||
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  const incompleteTodos = todos.filter((t) => !t.completed).sort(byPosition)
  const completedTodos = todos.filter((t) => t.completed).sort(byPosition)
  const incompleteIds = incompleteTodos.map((t) => t.id)
  const activeTodo = activeId ? incompleteTodos.find((t) => t.id === activeId) : null

  // dnd-kit handles touch, keyboard, auto-scroll and hit-testing. A small
  // activation distance means a tap on the grip isn't mistaken for a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = ({ active, over }) => {
    setActiveId(null)
    if (!over || active.id === over.id) return
    const from = incompleteIds.indexOf(active.id)
    const to = incompleteIds.indexOf(over.id)
    if (from === -1 || to === -1) return
    // Persist the whole visible order (incomplete then completed) so positions
    // stay a clean 0..n.
    reorder([...arrayMove(incompleteIds, from, to), ...completedTodos.map((t) => t.id)])
  }

  const handleAdd = (e) => {
    e.preventDefault()
    if (!newTodo.trim()) return
    // Clear only on success so a failed add (offline / no permission) keeps the
    // typed text for a retry.
    add(
      { title: newTodo.trim(), trip_id: newTodoTrip || null, due_date: newTodoDate || null },
      { onSuccess: () => { setNewTodo(''); setNewTodoDate(''); toast.success('To-do added') } },
    )
  }

  const handleSaveEdit = (id, fields) => {
    if (!fields.title.trim()) return
    edit(
      id,
      { title: fields.title.trim(), trip_id: fields.trip_id || null, due_date: fields.due_date || null },
      { onSuccess: () => { setEditingId(null); toast.success('To-do updated') } },
    )
  }

  return (
    <div className="h-full flex flex-col w-full max-w-3xl mx-auto">
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
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            placeholder="What needs to be done?"
            className="mat-input sm:flex-1"
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={newTodoDate}
              onChange={(e) => setNewTodoDate(e.target.value)}
              className="mat-input text-sm sm:w-40"
            />
            <select
              value={newTodoTrip}
              onChange={(e) => setNewTodoTrip(e.target.value)}
              className="mat-select flex-1 sm:flex-none"
            >
              <option value="">No trip</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>{trip.name}</option>
              ))}
            </select>
            <button type="submit" className="mat-btn-filled shrink-0">
              Add
            </button>
          </div>
        </div>
      </form>

      {/* Todo list */}
      <div className="flex-1 overflow-y-auto">
        {todos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
            <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
              <svg className="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-sm font-medium">No to-dos yet</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={({ active }) => setActiveId(active.id)}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <div className="space-y-1.5">
              <SortableContext items={incompleteIds} strategy={verticalListSortingStrategy}>
                {incompleteTodos.map((todo) => (
                  <SortableTodoItem
                    key={todo.id}
                    todo={todo}
                    trips={trips}
                    editing={editingId === todo.id}
                    onStartEdit={() => setEditingId(todo.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={handleSaveEdit}
                    onToggle={toggle}
                    onRemove={remove}
                  />
                ))}
              </SortableContext>

              {completedTodos.length > 0 && (
                <>
                  <div className="pt-5 pb-2 px-1 text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
                    Completed ({completedTodos.length})
                  </div>
                  {completedTodos.map((todo) => (
                    <TodoItem
                      key={todo.id}
                      todo={todo}
                      trips={trips}
                      editing={editingId === todo.id}
                      onStartEdit={() => setEditingId(todo.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onSaveEdit={handleSaveEdit}
                      onToggle={toggle}
                      onRemove={remove}
                    />
                  ))}
                </>
              )}
            </div>

            {/* The lifted card that follows the pointer — the source row dims in place. */}
            <DragOverlay modifiers={[restrictToVerticalAxis]}>
              {activeTodo ? (
                <TodoItem todo={activeTodo} trips={trips} draggable overlay />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  )
}

// Wires a single row into dnd-kit's sortable list: the row is the movable node,
// the grip is the drag activator (so the checkbox/edit/delete stay clickable).
function SortableTodoItem(props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.todo.id, disabled: props.editing })
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <TodoItem
      {...props}
      draggable={!props.editing}
      sortableRef={setNodeRef}
      style={style}
      isDragging={isDragging}
      handleRef={setActivatorNodeRef}
      handleProps={{ ...attributes, ...listeners }}
    />
  )
}

function TodoItem({
  todo, trips, editing, onStartEdit, onCancelEdit, onSaveEdit, onToggle, onRemove,
  draggable = false, sortableRef, style, isDragging = false, overlay = false, handleRef, handleProps,
}) {
  const tripName = todo.trip || trips.find((t) => t.id === todo.trip_id)?.name

  if (editing) {
    return (
      <TodoEditForm
        todo={todo}
        trips={trips}
        onSave={onSaveEdit}
        onCancel={onCancelEdit}
      />
    )
  }

  return (
    <div
      ref={sortableRef}
      style={style}
      className={[
        'flex items-start gap-3 p-3.5 rounded-xl bg-white border group transition-shadow duration-150',
        overlay
          ? 'border-primary/50 shadow-2xl ring-1 ring-primary/20 scale-[1.02] cursor-grabbing'
          : 'border-outline/20 hover:shadow-elevation-1',
        // While dragging, the in-place row fades to a ghost; the DragOverlay copy
        // is the thing that visibly moves.
        isDragging ? 'opacity-30' : todo.completed ? 'opacity-50' : todo._pending ? 'opacity-60' : '',
      ].join(' ')}
    >
      {draggable && (
        <button
          type="button"
          ref={handleRef}
          {...handleProps}
          aria-label="Drag to reorder"
          className="mt-0.5 -ml-1 text-on-surface-variant/50 hover:text-on-surface-variant cursor-grab active:cursor-grabbing touch-none shrink-0"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM7 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM7 16a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 16a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
          </svg>
        </button>
      )}
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
          {tripName && (
            <span className="text-[11px] text-primary bg-primary-light px-2 py-0.5 rounded-full font-medium">
              {tripName}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onStartEdit}
          disabled={todo._pending}
          aria-label="Edit to-do"
          className="text-on-surface-variant hover:text-primary opacity-0 group-hover:opacity-100 transition-all duration-150 p-1 rounded-full hover:bg-primary-light disabled:opacity-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button
          onClick={() => onRemove(todo.id)}
          aria-label="Delete to-do"
          className="text-on-surface-variant hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all duration-150 p-1 rounded-full hover:bg-red-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function TodoEditForm({ todo, trips, onSave, onCancel }) {
  const [title, setTitle] = useState(todo.title)
  const [dueDate, setDueDate] = useState(todo.due_date || '')
  const [tripId, setTripId] = useState(todo.trip_id || '')
  const inputRef = useRef(null)

  // Focus the content field on open, matching the add form's primary field.
  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = (e) => {
    e.preventDefault()
    onSave(todo.id, { title, trip_id: tripId, due_date: dueDate })
  }

  return (
    <form onSubmit={submit} className="mat-surface p-4 border border-primary/40">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
          placeholder="What needs to be done?"
          className="mat-input sm:flex-1"
        />
        <div className="flex gap-2">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mat-input text-sm sm:w-40"
          />
          <select
            value={tripId}
            onChange={(e) => setTripId(e.target.value)}
            className="mat-select flex-1 sm:flex-none"
          >
            <option value="">No trip</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>{trip.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button type="button" onClick={onCancel} className="mat-btn-outlined shrink-0">
          Cancel
        </button>
        <button type="submit" className="mat-btn-filled shrink-0">
          Save
        </button>
      </div>
    </form>
  )
}
