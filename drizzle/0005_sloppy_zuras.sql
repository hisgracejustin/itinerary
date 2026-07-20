ALTER TABLE "todos" ADD COLUMN "assignee_id" text;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_todos_assignee_id" ON "todos" USING btree ("assignee_id");