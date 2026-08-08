CREATE OR REPLACE FUNCTION "ensure_expense_date"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."date" IS NULL THEN
    NEW."date" := CASE
      WHEN TG_OP = 'UPDATE' THEN OLD."date"
      ELSE to_char(CURRENT_DATE, 'YYYY-MM-DD')
    END;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "expenses_ensure_date"
BEFORE INSERT OR UPDATE OF "date" ON "expenses"
FOR EACH ROW EXECUTE FUNCTION "ensure_expense_date"();
--> statement-breakpoint
UPDATE "expenses"
SET "date" = to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD')
WHERE "date" IS NULL;
--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "date" SET NOT NULL;