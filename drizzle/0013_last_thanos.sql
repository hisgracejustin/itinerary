ALTER TABLE "bookings" ADD COLUMN "charged_currency" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "charged_rate" numeric;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "charged_currency" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "charged_rate" numeric;