CREATE TABLE "booking_splits" (
	"booking_id" text NOT NULL,
	"user_id" text NOT NULL,
	"weight" numeric DEFAULT 1 NOT NULL,
	CONSTRAINT "booking_splits_booking_id_user_id_pk" PRIMARY KEY("booking_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "expense_splits" (
	"expense_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"weight" numeric DEFAULT 1 NOT NULL,
	CONSTRAINT "expense_splits_expense_id_user_id_pk" PRIMARY KEY("expense_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"title" text NOT NULL,
	"amount" numeric NOT NULL,
	"currency" text NOT NULL,
	"paid_by" text,
	"date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"from_user" text NOT NULL,
	"to_user" text NOT NULL,
	"amount" numeric NOT NULL,
	"currency" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "paid_by" text;--> statement-breakpoint
ALTER TABLE "trip_members" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_splits" ADD CONSTRAINT "booking_splits_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_splits" ADD CONSTRAINT "booking_splits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_from_user_users_id_fk" FOREIGN KEY ("from_user") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_to_user_users_id_fk" FOREIGN KEY ("to_user") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_parties" ADD CONSTRAINT "trip_parties_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_expenses_trip_id" ON "expenses" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "idx_settlements_trip_id" ON "settlements" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "idx_trip_parties_trip_id" ON "trip_parties" USING btree ("trip_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_party_id_trip_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."trip_parties"("id") ON DELETE set null ON UPDATE no action;