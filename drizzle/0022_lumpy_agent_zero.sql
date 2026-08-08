ALTER TABLE "booking_splits" ADD COLUMN "paid_amount" numeric DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_splits" ADD COLUMN "paid_amount" numeric DEFAULT 0 NOT NULL;