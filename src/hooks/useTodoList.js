"use client";

import { useOptimistic, useTransition } from "react";
import { createTodoAction, updateTodoAction, deleteTodoAction } from "@/actions/todos";
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
    default:
      return state;
  }
}

export function useTodoList(initial, { onError } = {}) {
  const [isPending, startTransition] = useTransition();
  const [todos, applyOptimistic] = useOptimistic(initial, reducer);

  const add = ({ title, trip_id, due_date }, { onSuccess } = {}) => {
    startTransition(async () => {
      // Client-generated id, passed through to the action, so the optimistic row
      // and the persisted row share an id: reconciliation is seamless and a
      // later delete/toggle targets the right row.
      const id = crypto.randomUUID();
      applyOptimistic({
        type: "add",
        todo: {
          id,
          title,
          trip_id: trip_id ?? null,
          due_date: due_date ?? null,
          completed: false,
          _pending: true,
        },
      });
      try {
        await unwrap(await createTodoAction({ id, title, trip_id: trip_id ?? null, due_date: due_date ?? null }));
        onSuccess?.();
      } catch (err) {
        onError?.(err);
      }
    });
  };

  const edit = (id, { title, trip_id, due_date }, { onSuccess } = {}) => {
    const current = todos.find((t) => t.id === id);
    // Don't edit a row that is still being created — its DB row may not exist
    // yet, so the update would target nothing and the edit would be lost.
    if (!current || current._pending) return;
    const patch = { title, trip_id: trip_id ?? null, due_date: due_date ?? null };
    startTransition(async () => {
      applyOptimistic({ type: "update", id, patch });
      try {
        await unwrap(await updateTodoAction(id, patch));
        onSuccess?.();
      } catch (err) {
        onError?.(err);
      }
    });
  };

  const toggle = (id) => {
    const current = todos.find((t) => t.id === id);
    if (!current || current._pending) return;
    startTransition(async () => {
      applyOptimistic({ type: "update", id, patch: { completed: !current.completed } });
      try {
        await unwrap(await updateTodoAction(id, { completed: !current.completed }));
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

  return { todos, add, toggle, remove, isPending };
}
