ALTER TABLE "todos" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "todos" t SET "position" = sub.rn FROM (
	SELECT "id", (row_number() OVER (ORDER BY "due_date" ASC NULLS LAST, "created_at" ASC)) - 1 AS rn
	FROM "todos"
) sub WHERE t."id" = sub."id";--> statement-breakpoint
CREATE INDEX "idx_todos_position" ON "todos" USING btree ("position");