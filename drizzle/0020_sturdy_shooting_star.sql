WITH "ranked_picks" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "option_set_id"
			ORDER BY "sort_order", "created_at", "id"
		) AS "pick_rank"
	FROM "options"
	WHERE "is_pick" = true
)
UPDATE "options"
SET "is_pick" = false
FROM "ranked_picks"
WHERE "options"."id" = "ranked_picks"."id"
	AND "ranked_picks"."pick_rank" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_options_one_pick_per_set" ON "options" USING btree ("option_set_id") WHERE "options"."is_pick" = true;