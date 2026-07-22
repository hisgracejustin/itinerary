"use client";

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import {
  DndContext, DragOverlay, closestCenter, closestCorners, KeyboardSensor, PointerSensor,
  useDroppable, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTripContext } from '../lib/trip-context'
import { useTodoList } from '../hooks/useTodoList'
import { friendlyError } from '../lib/friendlyError'
import { useToast } from '../components/Toast'
import useMediaQuery from '../hooks/useMediaQuery'
import AssigneePicker, { Avatar, memberLabel } from '../components/AssigneePicker'

// The board's three columns, in board order. `status` values match the DB enum.
const COLUMNS = [
  { id: 'todo', title: 'To do' },
  { id: 'in_progress', title: 'In progress' },
  { id: 'done', title: 'Done' },
]
// Per-column empty-state copy so an idle column reads intentionally, not broken.
const EMPTY_COPY = {
  todo: 'Nothing to do',
  in_progress: 'Nothing in progress',
  done: 'Nothing done yet',
}

// Lock drag movement to the vertical axis (a one-line modifier — no need for the
// @dnd-kit/modifiers package). Used on mobile, where a column is a single stack.
// Desktop drags are 2-D (cards cross columns), so it's dropped there.
const restrictToVerticalAxis = ({ transform }) => ({ ...transform, x: 0 })

// Defaults are applied in the body rather than the signature: TS infers this
// JSX component's prop types from the signature, and `members = []` would
// narrow the prop to never[] at the .tsx call site.
export default function Todos({ initialTodos, members: membersProp, currentUserId }) {
  const members = membersProp ?? []
  const { selectedTrip, tripMeta, trips } = useTripContext()
  const { toast } = useToast()
  const { todos, add, edit, assign, move, setStatus, remove } = useTodoList(initialTodos, {
    onError: (err) => toast.error(friendlyError(err)),
  })
  const [newTodo, setNewTodo] = useState('')
  const [newTodoDate, setNewTodoDate] = useState('')
  const [newTodoTrip, setNewTodoTrip] = useState(selectedTrip || '')
  const [newTodoAssignee, setNewTodoAssignee] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [activeId, setActiveId] = useState(null)
  // Which column the pointer is over mid-drag — a purely visual highlight
  // (never mutate list state in onDragOver; that's the classic multi-container
  // dnd-kit footgun).
  const [overColumn, setOverColumn] = useState(null)
  // 'all' | 'unassigned' | <userId>
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  // Mobile shows one column at a time behind segmented tabs.
  const [mobileColumn, setMobileColumn] = useState('todo')

  // Only render one variant: desktop grid and mobile single-column each own a
  // DndContext, and mounting both would collide on ids. false on the server /
  // first paint (hook is SSR-safe) → mobile-first render, then it syncs.
  const isDesktop = useMediaQuery('(min-width: 640px)')

  const matchesFilter = (t) => {
    if (assigneeFilter === 'all') return true
    if (assigneeFilter === 'unassigned') return !t.assignee_id
    return t.assignee_id === assigneeFilter
  }
  // Reordering writes positions for the whole destination column, so a filtered
  // view would clobber the positions of rows it can't see — drag is disabled
  // while a filter is active. Checkbox/chevron moves stay safe (they append).
  const filterActive = assigneeFilter !== 'all'
  const unassignedCount = todos.filter((t) => t.status !== 'done' && !t.assignee_id).length

  // Manual order: sort by the persisted `position` (matches the server) so
  // dragged rows stay where the user dropped them. created_at breaks ties.
  const byPosition = (a, b) =>
    (a.position ?? 0) - (b.position ?? 0) ||
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  const visible = todos.filter(matchesFilter)
  // Bucket the filtered todos into their columns, each sorted by position.
  const byStatus = {
    todo: visible.filter((t) => t.status === 'todo').sort(byPosition),
    in_progress: visible.filter((t) => t.status === 'in_progress').sort(byPosition),
    done: visible.filter((t) => t.status === 'done').sort(byPosition),
  }
  const activeTodo = activeId ? todos.find((t) => t.id === activeId) : null

  // dnd-kit handles touch, keyboard, auto-scroll and hit-testing. A small
  // activation distance means a tap on the grip isn't mistaken for a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Which column an over-target belongs to: `over.id` is either a column id
  // (dropped on the empty body) or a card id (find its column).
  const columnOf = (overId) => {
    if (COLUMNS.some((c) => c.id === overId)) return overId
    return COLUMNS.find((c) => byStatus[c.id].some((t) => t.id === overId))?.id ?? null
  }

  // Desktop: 2-D drag, cards cross columns. Resolve the destination order and
  // hand it to the hook — same-slot drops are a no-op.
  const handleDesktopDragEnd = ({ active, over }) => {
    setActiveId(null)
    setOverColumn(null)
    if (!over) return
    const activeStatus = todos.find((t) => t.id === active.id)?.status
    const destStatus = columnOf(over.id)
    if (!activeStatus || !destStatus) return
    const destIds = byStatus[destStatus].map((t) => t.id)
    if (activeStatus === destStatus) {
      // Reorder within the column.
      const from = destIds.indexOf(active.id)
      const to = over.id === destStatus ? destIds.length - 1 : destIds.indexOf(over.id)
      if (from === -1 || to === -1 || from === to) return
      move(active.id, destStatus, arrayMove(destIds, from, to))
    } else {
      // Cross-column: insert the card at the target slot (append if dropped on
      // the column body). The source column needs no rewrite — removing a row
      // preserves the relative order of what's left.
      const at = over.id === destStatus ? destIds.length : destIds.indexOf(over.id)
      const insertAt = at === -1 ? destIds.length : at
      move(active.id, destStatus, [...destIds.slice(0, insertAt), active.id, ...destIds.slice(insertAt)])
    }
  }

  // Mobile: single visible column, vertical reorder only.
  const handleMobileDragEnd = ({ active, over }) => {
    setActiveId(null)
    if (!over || active.id === over.id) return
    const columnIds = byStatus[mobileColumn].map((t) => t.id)
    const from = columnIds.indexOf(active.id)
    const to = columnIds.indexOf(over.id)
    if (from === -1 || to === -1) return
    move(active.id, mobileColumn, arrayMove(columnIds, from, to))
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

  // Shared per-card props (everything except drag wiring, which differs).
  const cardProps = (todo) => ({
    todo,
    trips,
    members,
    currentUserId,
    onAssign: handleAssign,
    editing: editingId === todo.id,
    onStartEdit: () => setEditingId(todo.id),
    onCancelEdit: () => setEditingId(null),
    onSaveEdit: handleSaveEdit,
    onSetStatus: setStatus,
    onRemove: remove,
  })

  return (
    <div className="h-full flex flex-col w-full max-w-6xl mx-auto">
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
            const count = todos.filter((t) => t.status !== 'done' && t.assignee_id === m.id).length
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
          Drag-to-reorder is off while filtered. Use the checkbox or arrows to move cards.
        </p>
      )}

      {/* Board */}
      {isDesktop ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={({ active }) => setActiveId(active.id)}
          onDragOver={({ over }) => setOverColumn(over ? columnOf(over.id) : null)}
          onDragEnd={handleDesktopDragEnd}
          onDragCancel={() => { setActiveId(null); setOverColumn(null) }}
        >
          <div className="flex-1 min-h-0 grid grid-cols-3 gap-3">
            {COLUMNS.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                count={byStatus[column.id].length}
                highlighted={overColumn === column.id && activeId != null}
              >
                <SortableContext
                  items={byStatus[column.id].map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {byStatus[column.id].length === 0 ? (
                    <ColumnEmpty
                      status={column.id}
                      filterActive={filterActive}
                      onReset={() => setAssigneeFilter('all')}
                    />
                  ) : (
                    byStatus[column.id].map((todo) => {
                      const Row = filterActive ? TodoItem : SortableTodoItem
                      return <Row key={todo.id} {...cardProps(todo)} />
                    })
                  )}
                </SortableContext>
              </BoardColumn>
            ))}
          </div>

          {/* The lifted card that follows the pointer (2-D on desktop). */}
          <DragOverlay>
            {activeTodo ? <TodoItem todo={activeTodo} trips={trips} draggable overlay /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Segmented status tabs — a 3-segment control with per-column counts. */}
          <div className="grid grid-cols-3 gap-1 mb-3 shrink-0 p-1 bg-surface-container rounded-xl">
            {COLUMNS.map((column) => {
              const active = mobileColumn === column.id
              return (
                <button
                  key={column.id}
                  onClick={() => setMobileColumn(column.id)}
                  className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    active ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="truncate">{column.title}</span>
                  <span className={active ? 'opacity-70' : 'opacity-50'}>{byStatus[column.id].length}</span>
                </button>
              )
            })}
          </div>

          <div className="flex-1 overflow-y-auto">
            {byStatus[mobileColumn].length === 0 ? (
              <ColumnEmpty
                status={mobileColumn}
                filterActive={filterActive}
                onReset={() => setAssigneeFilter('all')}
              />
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis]}
                onDragStart={({ active }) => setActiveId(active.id)}
                onDragEnd={handleMobileDragEnd}
                onDragCancel={() => setActiveId(null)}
              >
                <div className="space-y-1.5">
                  <SortableContext
                    items={byStatus[mobileColumn].map((t) => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {byStatus[mobileColumn].map((todo) => {
                      const Row = filterActive ? TodoItem : SortableTodoItem
                      return <Row key={todo.id} {...cardProps(todo)} stepper />
                    })}
                  </SortableContext>
                </div>

                <DragOverlay modifiers={[restrictToVerticalAxis]}>
                  {activeTodo ? <TodoItem todo={activeTodo} trips={trips} draggable overlay stepper /> : null}
                </DragOverlay>
              </DndContext>
            )}
          </div>
        </div>
      )}
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

// A desktop board column: header (title + count) over a scrollable card stack
// that is itself a droppable, so empty columns still accept a drop. The tint
// highlights the column the pointer is currently over.
function BoardColumn({ column, count, highlighted, children }) {
  const { setNodeRef } = useDroppable({ id: column.id })
  return (
    // min-h-0: a grid item's automatic minimum height is its content height
    // (overflow is visible here), which would let a tall column push past the
    // viewport instead of letting the card stack scroll.
    <div className="flex flex-col min-w-0 min-h-0">
      <div className="flex items-center justify-between px-1 pb-2 shrink-0">
        <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
          {column.title}
        </span>
        <span className="text-[11px] font-medium text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-full">
          {count}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto rounded-xl p-1.5 space-y-1.5 transition-colors ${
          highlighted ? 'bg-primary/5 ring-1 ring-primary/30' : 'bg-surface-container/40'
        }`}
      >
        {children}
      </div>
    </div>
  )
}

// Empty-column placeholder. Offers a filter reset when a filter is what hid the
// cards, matching the old flat-list empty state's "Show everyone".
function ColumnEmpty({ status, filterActive, onReset }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant text-center">
      <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-3">
        <svg className="w-6 h-6 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      </div>
      <p className="text-xs font-medium">{EMPTY_COPY[status]}</p>
      {filterActive && (
        <button
          onClick={onReset}
          className="text-[11px] text-primary font-medium mt-1.5 hover:underline"
        >
          Show everyone
        </button>
      )}
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
  todo, trips, members = [], currentUserId = null, onAssign,
  editing, onStartEdit, onCancelEdit, onSaveEdit, onSetStatus, onRemove,
  draggable = false, sortableRef, style, isDragging = false, overlay = false, handleRef, handleProps,
  stepper = false,
}) {
  const tripName = todo.trip || trips.find((t) => t.id === todo.trip_id)?.name
  const done = todo.status === 'done'
  const colIndex = COLUMNS.findIndex((c) => c.id === todo.status)

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
        !overlay && !done && !todo.assignee_id ? 'border-l-2 border-l-amber-400' : '',
        // While dragging, the in-place row fades to a ghost; the DragOverlay copy
        // is the thing that visibly moves.
        isDragging ? 'opacity-30' : done ? 'opacity-50' : todo._pending ? 'opacity-60' : '',
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
        checked={done}
        onChange={() => onSetStatus?.(todo.id, done ? 'todo' : 'done')}
        className="mt-0.5 w-[18px] h-[18px] rounded-md border-gray-300 text-primary focus:ring-primary/30 cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <span className={`text-sm block ${done ? 'line-through text-on-surface-variant' : 'text-on-surface'}`}>
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
        {/* Mobile: step the card to the adjacent column without a cross-column
            drag. Hidden at the ends of the board. */}
        {stepper && !overlay && colIndex > 0 && (
          <button
            onClick={() => onSetStatus?.(todo.id, COLUMNS[colIndex - 1].id)}
            disabled={todo._pending}
            aria-label={`Move to ${COLUMNS[colIndex - 1].title}`}
            className="text-on-surface-variant hover:text-primary p-1.5 rounded-full hover:bg-primary-light disabled:opacity-40"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        {stepper && !overlay && colIndex < COLUMNS.length - 1 && (
          <button
            onClick={() => onSetStatus?.(todo.id, COLUMNS[colIndex + 1].id)}
            disabled={todo._pending}
            aria-label={`Move to ${COLUMNS[colIndex + 1].title}`}
            className="text-on-surface-variant hover:text-primary p-1.5 rounded-full hover:bg-primary-light disabled:opacity-40"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
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
