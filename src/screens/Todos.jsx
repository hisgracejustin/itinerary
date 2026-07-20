"use client";

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
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
import AssigneePicker, { Avatar, memberLabel } from '../components/AssigneePicker'

// Lock drag movement to the vertical axis (a one-line modifier — no need for the
// @dnd-kit/modifiers package). Keeps rows from drifting sideways.
const restrictToVerticalAxis = ({ transform }) => ({ ...transform, x: 0 })

// Defaults are applied in the body rather than the signature: TS infers this
// JSX component's prop types from the signature, and `members = []` would
// narrow the prop to never[] at the .tsx call site.
export default function Todos({ initialTodos, members: membersProp, currentUserId }) {
  const members = membersProp ?? []
  const { selectedTrip, tripMeta, trips } = useTripContext()
  const { toast } = useToast()
  const { todos, add, edit, assign, reorder, toggle, remove } = useTodoList(initialTodos, {
    onError: (err) => toast.error(friendlyError(err)),
  })
  const [newTodo, setNewTodo] = useState('')
  const [newTodoDate, setNewTodoDate] = useState('')
  const [newTodoTrip, setNewTodoTrip] = useState(selectedTrip || '')
  const [newTodoAssignee, setNewTodoAssignee] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [activeId, setActiveId] = useState(null)
  // 'all' | 'unassigned' | <userId>
  const [assigneeFilter, setAssigneeFilter] = useState('all')

  const matchesFilter = (t) => {
    if (assigneeFilter === 'all') return true
    if (assigneeFilter === 'unassigned') return !t.assignee_id
    return t.assignee_id === assigneeFilter
  }
  // Reordering writes positions for the whole visible list, so a filtered view
  // would clobber the positions of rows it can't see — drag is disabled while a
  // filter is active.
  const filterActive = assigneeFilter !== 'all'
  const unassignedCount = todos.filter((t) => !t.completed && !t.assignee_id).length

  // Manual order: sort by the persisted `position` (matches the server) so
  // dragged rows stay where the user dropped them. created_at breaks ties.
  const byPosition = (a, b) =>
    (a.position ?? 0) - (b.position ?? 0) ||
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  const visible = todos.filter(matchesFilter)
  const incompleteTodos = visible.filter((t) => !t.completed).sort(byPosition)
  const completedTodos = visible.filter((t) => t.completed).sort(byPosition)
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
    if (!newTodoTrip) return
    add(
      {
        title: newTodo.trim(),
        trip_id: newTodoTrip,
        due_date: newTodoDate || null,
        assignee_id: newTodoAssignee?.id ?? null,
      },
      { onSuccess: () => { setNewTodo(''); setNewTodoDate(''); toast.success('To-do added') } },
    )
  }

  const handleSaveEdit = (id, fields) => {
    if (!fields.title.trim() || !fields.trip_id) return
    edit(
      id,
      {
        title: fields.title.trim(),
        trip_id: fields.trip_id,
        due_date: fields.due_date || null,
        assignee: fields.assignee ?? null,
      },
      { onSuccess: () => { setEditingId(null); toast.success('To-do updated') } },
    )
  }

  const handleAssign = (id, member) => {
    assign(id, member, {
      onSuccess: () =>
        toast.success(member ? `Assigned to ${memberLabel(member)}` : 'Assignment cleared'),
    })
  }

  return (
    <div className="h-full flex flex-col w-full max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5 gap-3">
        <h2 className="text-xl font-medium text-on-surface">To-dos</h2>
        <div className="flex items-center gap-2 shrink-0">
          {tripMeta && (
            <span className="text-xs font-medium bg-primary-light text-primary px-3 py-1 rounded-full">
              {tripMeta.name}
            </span>
          )}
        </div>
      </div>

      {/* Add form — needs at least one trip to attach a to-do to. */}
      {trips.length === 0 ? (
        <div className="mat-surface p-5 mb-4 shrink-0 text-center">
          <p className="text-sm text-on-surface mb-1">No trips yet</p>
          <p className="text-xs text-on-surface-variant mb-3">
            Every to-do belongs to a trip, so create one first.
          </p>
          <Link href="/settings" className="mat-btn-filled inline-flex">
            Go to Settings
          </Link>
        </div>
      ) : (
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
            {/* Every to-do belongs to a trip — that's what scopes it to its
                members. There is no "no trip" option any more. */}
            <select
              value={newTodoTrip}
              onChange={(e) => setNewTodoTrip(e.target.value)}
              required
              className="mat-select flex-1 sm:flex-none"
            >
              <option value="" disabled>Pick a trip…</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>{trip.name}</option>
              ))}
            </select>
            <button type="submit" disabled={!newTodoTrip} className="mat-btn-filled shrink-0 disabled:opacity-40">
              Add
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[11px] text-on-surface-variant">Assign to</span>
          <AssigneePicker
            value={newTodoAssignee?.id ?? null}
            members={members}
            currentUserId={currentUserId}
            onChange={setNewTodoAssignee}
          />
        </div>
      </form>
      )}

      {/* Assignee filter */}
      {(members.length > 0 || unassignedCount > 0) && (
        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1 shrink-0">
          <FilterChip
            active={assigneeFilter === 'all'}
            onClick={() => setAssigneeFilter('all')}
            label="Everyone"
          />
          <FilterChip
            active={assigneeFilter === 'unassigned'}
            onClick={() => setAssigneeFilter('unassigned')}
            label="Unassigned"
            count={unassignedCount}
            warn
          />
          {members.map((m) => {
            const count = todos.filter((t) => !t.completed && t.assignee_id === m.id).length
            return (
              <FilterChip
                key={m.id}
                active={assigneeFilter === m.id}
                onClick={() => setAssigneeFilter(m.id)}
                label={m.id === currentUserId ? 'Me' : memberLabel(m)}
                count={count}
                avatar={<Avatar member={m} size="xs" />}
              />
            )
          })}
        </div>
      )}

      {filterActive && (
        <p className="text-[11px] text-on-surface-variant mb-2 shrink-0">
          Drag-to-reorder is off while filtered.
        </p>
      )}

      {/* Todo list */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
            <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
              <svg className="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-sm font-medium">
              {filterActive ? 'Nothing matches this filter' : 'No to-dos yet'}
            </p>
            {filterActive && (
              <button
                onClick={() => setAssigneeFilter('all')}
                className="text-xs text-primary font-medium mt-2 hover:underline"
              >
                Show everyone
              </button>
            )}
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
                {incompleteTodos.map((todo) => {
                  const Row = filterActive ? TodoItem : SortableTodoItem
                  return (
                    <Row
                      key={todo.id}
                      todo={todo}
                      trips={trips}
                      members={members}
                      currentUserId={currentUserId}
                      onAssign={handleAssign}
                      editing={editingId === todo.id}
                      onStartEdit={() => setEditingId(todo.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onSaveEdit={handleSaveEdit}
                      onToggle={toggle}
                      onRemove={remove}
                    />
                  )
                })}
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
                      members={members}
                      currentUserId={currentUserId}
                      onAssign={handleAssign}
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

function FilterChip({ active, onClick, label, count, avatar, warn = false }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap transition-colors shrink-0 ${
        active
          ? 'bg-primary text-white border-primary'
          : warn && count > 0
          ? 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
          : 'bg-white text-on-surface-variant border-outline/30 hover:bg-surface-container'
      }`}
    >
      {avatar}
      {label}
      {count > 0 && (
        <span className={active ? 'opacity-80' : 'opacity-60'}>{count}</span>
      )}
    </button>
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
  todo, trips, members = [], currentUserId = null, onAssign,
  editing, onStartEdit, onCancelEdit, onSaveEdit, onToggle, onRemove,
  draggable = false, sortableRef, style, isDragging = false, overlay = false, handleRef, handleProps,
}) {
  const tripName = todo.trip || trips.find((t) => t.id === todo.trip_id)?.name

  if (editing) {
    return (
      <TodoEditForm
        todo={todo}
        trips={trips}
        members={members}
        currentUserId={currentUserId}
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
        // Open + nobody owns it — a quiet left accent so it stands out in a long list.
        !overlay && !todo.completed && !todo.assignee_id ? 'border-l-2 border-l-amber-400' : '',
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
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {/* Reassign in place. Read-only in the drag overlay, which is a copy. */}
          <AssigneePicker
            value={todo.assignee_id ?? null}
            members={
              // Fall back to the row's denormalized assignee so a name still
              // renders when the assignee isn't in the current trip's list.
              todo.assignee_id && !members.some((m) => m.id === todo.assignee_id)
                ? [...members, {
                    id: todo.assignee_id,
                    name: todo.assignee_name,
                    email: todo.assignee_email,
                    image: todo.assignee_image,
                  }]
                : members
            }
            currentUserId={currentUserId}
            disabled={overlay || todo._pending}
            size="xs"
            onChange={(m) => onAssign?.(todo.id, m)}
          />
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
          className="text-on-surface-variant hover:text-primary opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-all duration-150 p-1 rounded-full hover:bg-primary-light disabled:opacity-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button
          onClick={() => onRemove(todo.id)}
          aria-label="Delete to-do"
          className="text-on-surface-variant hover:text-red-500 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-all duration-150 p-1 rounded-full hover:bg-red-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function TodoEditForm({ todo, trips, members = [], currentUserId = null, onSave, onCancel }) {
  const [title, setTitle] = useState(todo.title)
  const [dueDate, setDueDate] = useState(todo.due_date || '')
  const [tripId, setTripId] = useState(todo.trip_id || '')
  const [assignee, setAssignee] = useState(
    () =>
      members.find((m) => m.id === todo.assignee_id) ??
      (todo.assignee_id
        ? { id: todo.assignee_id, name: todo.assignee_name, email: todo.assignee_email, image: todo.assignee_image }
        : null),
  )
  const inputRef = useRef(null)

  // Focus the content field on open, matching the add form's primary field.
  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = (e) => {
    e.preventDefault()
    onSave(todo.id, { title, trip_id: tripId, due_date: dueDate, assignee })
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
            required
            className="mat-select flex-1 sm:flex-none"
          >
            <option value="" disabled>Pick a trip…</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>{trip.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[11px] text-on-surface-variant">Assign to</span>
        <AssigneePicker
          value={assignee?.id ?? null}
          members={members}
          currentUserId={currentUserId}
          onChange={setAssignee}
        />
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
