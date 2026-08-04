CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_label" text NOT NULL,
	"action" text NOT NULL,
	"field" text,
	"old_value" text,
	"new_value" text,
	"old_refs" jsonb,
	"new_refs" jsonb,
	"changed_by" text,
	"changed_by_label" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "created_by" text;--> statement-breakpoint
CREATE INDEX "idx_audit_log_trip" ON "audit_log" USING btree ("trip_id","changed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_log_entity" ON "audit_log" USING btree ("entity_type","entity_id","changed_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;