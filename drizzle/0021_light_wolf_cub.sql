UPDATE "expenses"
SET "date" = to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD')
WHERE "date" IS NULL;
--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "date" SET NOT NULL;