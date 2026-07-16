ALTER TABLE "day_reminders" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "day_reminders" t SET "position" = sub.rn FROM (
	SELECT "id", (row_number() OVER (PARTITION BY "date", "trip_id" ORDER BY "time" ASC NULLS LAST, "created_at" ASC)) - 1 AS rn
	FROM "day_reminders"
) sub WHERE t."id" = sub."id";