-- Replace the `completed` boolean with a three-state board column.
--
-- Backfill order matters: add `status` (defaulting every existing row to
-- 'todo'), promote the previously-completed rows to 'done', THEN drop the old
-- column. Doing the UPDATE while both columns exist is what preserves the data —
-- drop first and the true/false signal is gone.
--
-- Deploy note: migrations run on every cold start via dbReady(). Once the new
-- build applies this, a still-warm old instance that writes `completed` will
-- error until it recycles. That's acceptable here — a failed to-do write is
-- recoverable (the user retries), unlike 0006's care about failed *boots*.
CREATE TYPE "public"."todo_status" AS ENUM('todo', 'in_progress', 'done');--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "status" "todo_status" DEFAULT 'todo' NOT NULL;--> statement-breakpoint
UPDATE "todos" SET "status" = 'done' WHERE "completed" = true;--> statement-breakpoint
ALTER TABLE "todos" DROP COLUMN "completed";--> statement-breakpoint
CREATE INDEX "idx_todos_status" ON "todos" USING btree ("status");
