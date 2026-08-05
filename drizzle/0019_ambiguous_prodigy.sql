CREATE TYPE "public"."option_set_status" AS ENUM('open', 'decided', 'dropped');--> statement-breakpoint
CREATE TABLE "option_images" (
	"id" text PRIMARY KEY NOT NULL,
	"option_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"title" text NOT NULL,
	"start_date" text,
	"end_date" text,
	"type" "booking_type" NOT NULL,
	"status" "option_set_status" DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "options" (
	"id" text PRIMARY KEY NOT NULL,
	"option_set_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"cost_amount" numeric,
	"cost_currency" text,
	"pros" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_pick" boolean DEFAULT false NOT NULL,
	"converted_booking_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "option_images" ADD CONSTRAINT "option_images_option_id_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_images" ADD CONSTRAINT "option_images_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_sets" ADD CONSTRAINT "option_sets_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_sets" ADD CONSTRAINT "option_sets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_option_set_id_option_sets_id_fk" FOREIGN KEY ("option_set_id") REFERENCES "public"."option_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_converted_booking_id_bookings_id_fk" FOREIGN KEY ("converted_booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_option_images_option_id" ON "option_images" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "idx_option_sets_trip_id" ON "option_sets" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "idx_option_sets_status" ON "option_sets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_options_option_set_id" ON "options" USING btree ("option_set_id");--> statement-breakpoint
CREATE INDEX "idx_options_sort_order" ON "options" USING btree ("sort_order");