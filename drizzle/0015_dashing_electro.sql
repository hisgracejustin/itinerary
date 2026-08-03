-- Written by hand ahead of the index below, and it must stay ahead of it: any
-- database that already has two rows for one (trip_id, date) — the exact race
-- the unique index closes — would fail CREATE UNIQUE INDEX and abort the deploy
-- migrator. The newest row wins (highest created_at, id breaking a
-- same-timestamp tie); the losers are stale copies of a title the UI was
-- already flipping between.
DELETE FROM "day_notes" WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (
			PARTITION BY "trip_id", "date" ORDER BY "created_at" DESC, "id" DESC
		) AS rn
		FROM "day_notes"
	) ranked WHERE rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_day_notes_trip_date" ON "day_notes" USING btree ("trip_id","date");
