ALTER TABLE "settlements" ADD COLUMN "group_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_settlements_group_id" ON "settlements" USING btree ("group_id");