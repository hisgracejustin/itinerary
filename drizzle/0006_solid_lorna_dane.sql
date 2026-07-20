-- Re-home stragglers before SET NOT NULL.
--
-- The production audit found zero tripless rows, so these are no-ops today. They
-- exist because migrations run on every cold start via dbReady(): the previously
-- deployed build can still create trip_id = NULL rows right up until the new one
-- goes live, and a single straggler would make SET NOT NULL throw — which would
-- fail the migration on EVERY request and take the whole app down. Re-homing to
-- the oldest trip is recoverable (the row is visible and can be re-filed); a
-- failed boot is not.
UPDATE "todos" SET "trip_id" = (SELECT "id" FROM "trips" ORDER BY "created_at" LIMIT 1)
  WHERE "trip_id" IS NULL AND EXISTS (SELECT 1 FROM "trips");--> statement-breakpoint
UPDATE "day_notes" SET "trip_id" = (SELECT "id" FROM "trips" ORDER BY "created_at" LIMIT 1)
  WHERE "trip_id" IS NULL AND EXISTS (SELECT 1 FROM "trips");--> statement-breakpoint
UPDATE "day_reminders" SET "trip_id" = (SELECT "id" FROM "trips" ORDER BY "created_at" LIMIT 1)
  WHERE "trip_id" IS NULL AND EXISTS (SELECT 1 FROM "trips");--> statement-breakpoint
-- Only reachable if there are no trips at all, in which case there is nowhere to
-- put them and NOT NULL is otherwise impossible.
DELETE FROM "todos" WHERE "trip_id" IS NULL;--> statement-breakpoint
DELETE FROM "day_notes" WHERE "trip_id" IS NULL;--> statement-breakpoint
DELETE FROM "day_reminders" WHERE "trip_id" IS NULL;--> statement-breakpoint
ALTER TABLE "day_notes" DROP CONSTRAINT "day_notes_trip_id_trips_id_fk";
--> statement-breakpoint
ALTER TABLE "day_reminders" DROP CONSTRAINT "day_reminders_trip_id_trips_id_fk";
--> statement-breakpoint
ALTER TABLE "todos" DROP CONSTRAINT "todos_trip_id_trips_id_fk";
--> statement-breakpoint
ALTER TABLE "day_notes" ALTER COLUMN "trip_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "day_reminders" ALTER COLUMN "trip_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "todos" ALTER COLUMN "trip_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "day_notes" ADD CONSTRAINT "day_notes_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_reminders" ADD CONSTRAINT "day_reminders_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;