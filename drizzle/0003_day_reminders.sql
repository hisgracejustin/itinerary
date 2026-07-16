CREATE TABLE "day_reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"trip_id" uuid,
	"text" text NOT NULL,
	"time" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "day_reminders" ADD CONSTRAINT "day_reminders_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_day_reminders_date" ON "day_reminders" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_day_reminders_trip_id" ON "day_reminders" USING btree ("trip_id");