"use client";

import { useOptimistic, useTransition } from "react";
import { createTodoAction, updateTodoAction, deleteTodoAction, moveTodoAction } from "@/actions/todos";
import { unwrap } from "@/lib/friendlyError";

// Optimistic to-do list layered over the server-provided list (`initial`). The
// checkbox toggle is the one interaction where instant feedback matters, so this
// uses useOptimistic rather than props-only. On success the mutating action
// revalidates and fresh props re-seed `initial`; on failure the optimistic edit
// auto-reverts when the transition ends (nothing persisted) and onError fires.
function reducer(state, action) {
  switch (action.type) {
    case "add":
      return [...state, action.todo];
    case "update":
      return state.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t));
    case "remove":
      return state.filter((t) => t.id !== action.id);
    case "move": {
      // `order`: destination column ids in their new order (each gets its index
      // as position). `id`/`status`: the moved card also switches columns. The
      // screen sorts each column by position, so this reflects the drop.
      const pos = new Map(action.order.map((id, i) => [id, i]));
      return state.map((t) => {
        const patch = pos.has(t.id) ? { position: pos.get(t.id) } : null;
        if (t.id === action.id) return { ...t, status: action.status, ...(patch ?? {}) };
        return patch ? { ...t, ...patch } : t;
      });
    }
    default:
      return state;
  }
}

export function useTodoList(initial, { onError } = {}) {
  const [isPending, startTransition] = useTransition();
  const [todos, applyOptimistic] = useOptimistic(initial, reducer);

  const add = ({ title, trip_id, due_date, assignee_id }, { onSuccess } = {}) => {
    startTransition(async () => {
      // Client-generated id, passed through to the action, so the optimistic row
      // and the persisted row share an id: reconciliation is seamless and a
      // later delete/toggle targets the right row.
      const id = crypto.randomUUID();
      // Append to the end of the list. Sending the position the server will use
      // keeps the optimistic row from jumping when the real row comes back.
      const position = todos.reduce((max, t) => Math.max(max, t.position ?? 0), -1) + 1;
      applyOptimistic({
        type: "add",
        todo: {
          id,
          title,
          trip_id: trip_id ?? null,
          due_date: due_date ?? null,
          status: "todo",
          assignee_id: assignee_id ?? null,
          position,
          _pending: true,
        },
      });
      try {
        await unwrap(await createTodoAction({ id, title, trip_id: trip_id ?? null, due_date: due_date ?? null, assignee_id: assignee_id ?? null, position }));
        onSuccess?.();
      } catch (err) {
        onError?.(err);
      }
    });
  };

  // The assignee's display fields are denormalized onto each row by the query,
  // so an optimistic assignment has to patch them too or the chip would show
  // stale text until the server round trip lands.
  const assigneePatch = (member) => ({
    assignee_id: member?.id ?? null,
    assignee_name: member?.name ?? null,
    assignee_email: member?.email ?? null,
    assignee_image: member?.image ?? null,
  });

  const edit = (id, { title, trip_id, due_date, assignee }, { onSuccess } = {}) => {
    const current = todos.find((t) => t.id === id);
    // Don't edit a row that is still being created — its DB row may not exist
    // yet, so the update would target nothing and the edit would be lost.
    if (!current || current._pending) return;
    const serverPatch = { title, trip_id: trip_id ?? null, due_date: due_date ?? null };
    let optimisticPatch = serverPatch;
    // `assignee === undefined` means "leave the assignment alone"; an explicit
    // null means "unassign".
    if (assignee !== undefined) {
      serverPatch.assignee_id = assignee?.id ?? null;
      optimisticPatch = { ...serverPatch, ...assigneePatch(assignee) };
    }
    startTransition(async () => {
      applyOptimistic({ type: "update", id, patch: optimisticPatch });
      try {
        await unwrap(await updateTodoAction(id, serverPatch));
        onSuccess?.();
      } catch (err) {
        onError?.(err);
      }
    });
  };

  /** Reassign in place (row dropdown) without opening the full edit form. */
  const assign = (id, member, { onSuccess } = {}) => {
    const current = todos.find((t) => t.id === id);
    if (!current || current._pending) return;
    if ((current.assignee_id ?? null) === (member?.id ?? null)) return;
    startTransition(async () => {
      applyOptimistic({ type: "update", id, patch: assigneePatch(member) });
      try {
        await unwrap(await updateTodoAction(id, { assignee_id: member?.id ?? null }));
        onSuccess?.();
      } catch (err) {
        onError?.(err);
      }
    });
  };

  // Drag/drop within or across a column. `orderedIds` is the full destination
  // column order after the drop (including `id`); the server rewrites those
  // positions and flips the moved row's status.
  const move = (id, status, orderedIds) => {
    // Skip if any target row is still being created — their DB rows may not
    // exist yet, so the position/status write would target nothing.
    if (orderedIds.some((x) => todos.find((t) => t.id === x)?._pending)) return;
    startTransition(async () => {
      applyOptimistic({ type: "move", id, status, order: orderedIds });
      try {
        await unwrap(await moveTodoAction({ id, status, orderedIds }));
      } catch (err) {
        onError?.(err);
      }
    });
  };

  // Move a card to a column without a precise slot (checkbox / chevron / while
  // filtered): the row lands at the end of its new column, matching where the
  // server appends it. Bump position optimistically so the card doesn't jump
  // when the persisted row comes back.
  const setStatus = (id, status) => {
    const current = todos.find((t) => t.id === id);
    if (!current || current._pending) return;
    if (current.status === status) return;
    const position = todos.reduce((max, t) => Math.max(max, t.position ?? 0), -1) + 1;
    startTransition(async () => {
      applyOptimistic({ type: "update", id, patch: { status, position } });
      try {
        await unwrap(await moveTodoAction({ id, status }));
      } catch (err) {
        onError?.(err);
      }
    });
  };

  const remove = (id) => {
    const current = todos.find((t) => t.id === id);
    // Don't act on a row that is still being created — its DB row may not exist
    // yet, so the delete would no-op and the row would reappear on revalidation.
    if (!current || current._pending) return;
    startTransition(async () => {
      applyOptimistic({ type: "remove", id });
      try {
        await unwrap(await deleteTodoAction(id));
      } catch (err) {
        onError?.(err);
      }
    });
  };

  return { todos, add, edit, assign, move, setStatus, remove, isPending };
}
