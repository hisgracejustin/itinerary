-- No DEFAULT, deliberately. If a row without a timezone somehow reaches this
-- point, the right outcome is that this fails and aborts the deploy: the
-- alternative is stamping a made-up zone onto a booking whose cancellation
-- deadline then reads hours off, silently and unrecoverably. Fill the row by
-- hand (scripts/infer-timezones.mjs shows what each one would get) and re-run.
ALTER TABLE "bookings" ALTER COLUMN "timezone" SET NOT NULL;
