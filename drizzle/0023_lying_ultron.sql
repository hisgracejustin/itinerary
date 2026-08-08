CREATE TABLE "expense_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"expense_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_splits" ADD COLUMN "base_amount" numeric;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "service_percent" numeric;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "shared_charge" numeric;--> statement-breakpoint
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_expense_attachments_expense_id" ON "expense_attachments" USING btree ("expense_id");