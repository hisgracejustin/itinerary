ALTER TABLE "booking_splits" ADD COLUMN "base_amount" numeric;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "service_percent" numeric;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "shared_charge" numeric;