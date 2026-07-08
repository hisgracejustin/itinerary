-- ============================================================
-- ITINERARY APP: Full Migration Script (IDEMPOTENT)
-- Run this in Supabase SQL Editor - safe to re-run
-- ============================================================

-- ============================================================
-- STEP 0: BACKUP (only creates if not already backed up)
-- ============================================================
CREATE TABLE IF NOT EXISTS _backup_trips AS SELECT * FROM trips;
CREATE TABLE IF NOT EXISTS _backup_bookings AS SELECT * FROM bookings;
CREATE TABLE IF NOT EXISTS _backup_todos AS SELECT * FROM todos;
CREATE TABLE IF NOT EXISTS _backup_day_notes AS SELECT * FROM day_notes;

-- ============================================================
-- STEP 1: ADD UUID TO TRIPS TABLE
-- ============================================================
ALTER TABLE trips ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
UPDATE trips SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE trips ALTER COLUMN id SET NOT NULL;

-- ============================================================
-- STEP 2: ADD trip_id UUID TO CHILD TABLES
-- ============================================================
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS trip_id UUID;
ALTER TABLE todos ADD COLUMN IF NOT EXISTS trip_id UUID;
ALTER TABLE day_notes ADD COLUMN IF NOT EXISTS trip_id UUID;

-- ============================================================
-- STEP 3: BACKFILL trip_id FROM trip name (only if old column exists)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'trip') THEN
    UPDATE bookings SET trip_id = t.id FROM trips t WHERE bookings.trip = t.name AND bookings.trip_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'todos' AND column_name = 'trip') THEN
    UPDATE todos SET trip_id = t.id FROM trips t WHERE todos.trip = t.name AND todos.trip_id IS NULL;
  END IF;
  -- day_notes never had a 'trip' column
END $$;

-- ============================================================
-- STEP 4: MAKE trip_id NOT NULL ON bookings
-- ============================================================
-- Check for orphans first: SELECT * FROM bookings WHERE trip_id IS NULL;
ALTER TABLE bookings ALTER COLUMN trip_id SET NOT NULL;

-- ============================================================
-- STEP 5: DROP OLD trip TEXT COLUMNS (IF THEY EXIST)
-- ============================================================
ALTER TABLE bookings DROP COLUMN IF EXISTS trip;
ALTER TABLE todos DROP COLUMN IF EXISTS trip;

-- ============================================================
-- STEP 6: CHANGE trips PRIMARY KEY FROM name TO id
-- ============================================================
DO $$
DECLARE
  pk_col text;
BEGIN
  SELECT a.attname INTO pk_col
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = 'trips'::regclass AND i.indisprimary;

  IF pk_col = 'name' THEN
    ALTER TABLE trips DROP CONSTRAINT trips_pkey;
    ALTER TABLE trips ADD PRIMARY KEY (id);
  ELSIF pk_col IS NULL THEN
    ALTER TABLE trips ADD PRIMARY KEY (id);
  END IF;
  -- If pk_col = 'id', PK already correct, do nothing
END $$;

-- ============================================================
-- STEP 7: ADD FOREIGN KEYS (skip if already exist)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bookings_trip') THEN
    ALTER TABLE bookings ADD CONSTRAINT fk_bookings_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_todos_trip') THEN
    ALTER TABLE todos ADD CONSTRAINT fk_todos_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_day_notes_trip') THEN
    ALTER TABLE day_notes ADD CONSTRAINT fk_day_notes_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- STEP 8: INDEXES
-- ============================================================
DROP INDEX IF EXISTS idx_bookings_trip;
DROP INDEX IF EXISTS idx_todos_trip;
DROP INDEX IF EXISTS idx_day_notes_trip;
CREATE INDEX IF NOT EXISTS idx_bookings_trip_id ON bookings(trip_id);
CREATE INDEX IF NOT EXISTS idx_todos_trip_id ON todos(trip_id);
CREATE INDEX IF NOT EXISTS idx_day_notes_trip_id ON day_notes(trip_id);

-- ============================================================
-- STEP 9: CREATE trip_members TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS trip_members (
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_members_user ON trip_members(user_id);
ALTER TABLE trip_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 10: DROP OLD RLS POLICIES (safe if they don't exist)
-- ============================================================
DROP POLICY IF EXISTS "Allow all access" ON trips;
DROP POLICY IF EXISTS "Allow all access" ON bookings;
DROP POLICY IF EXISTS "Allow all access" ON todos;
DROP POLICY IF EXISTS "Allow all access" ON day_notes;

-- Also drop new policies in case re-running
DROP POLICY IF EXISTS "trip_select" ON trips;
DROP POLICY IF EXISTS "trip_insert" ON trips;
DROP POLICY IF EXISTS "trip_update" ON trips;
DROP POLICY IF EXISTS "trip_delete" ON trips;
DROP POLICY IF EXISTS "booking_select" ON bookings;
DROP POLICY IF EXISTS "booking_insert" ON bookings;
DROP POLICY IF EXISTS "booking_update" ON bookings;
DROP POLICY IF EXISTS "booking_delete" ON bookings;
DROP POLICY IF EXISTS "todo_select" ON todos;
DROP POLICY IF EXISTS "todo_insert" ON todos;
DROP POLICY IF EXISTS "todo_update" ON todos;
DROP POLICY IF EXISTS "todo_delete" ON todos;
DROP POLICY IF EXISTS "day_note_select" ON day_notes;
DROP POLICY IF EXISTS "day_note_insert" ON day_notes;
DROP POLICY IF EXISTS "day_note_update" ON day_notes;
DROP POLICY IF EXISTS "day_note_delete" ON day_notes;
DROP POLICY IF EXISTS "trip_members_select" ON trip_members;
DROP POLICY IF EXISTS "trip_members_insert" ON trip_members;
DROP POLICY IF EXISTS "trip_members_delete" ON trip_members;

-- ============================================================
-- STEP 11: CREATE NEW RLS POLICIES
-- ============================================================

-- trips
CREATE POLICY "trip_select" ON trips FOR SELECT
  USING (EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = trips.id AND tm.user_id = auth.uid()));
CREATE POLICY "trip_insert" ON trips FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "trip_update" ON trips FOR UPDATE
  USING (EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = trips.id AND tm.user_id = auth.uid()));
CREATE POLICY "trip_delete" ON trips FOR DELETE
  USING (EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = trips.id AND tm.user_id = auth.uid() AND tm.role = 'owner'));

-- bookings
CREATE POLICY "booking_select" ON bookings FOR SELECT
  USING (EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = bookings.trip_id AND tm.user_id = auth.uid()));
CREATE POLICY "booking_insert" ON bookings FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = bookings.trip_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'editor')));
CREATE POLICY "booking_update" ON bookings FOR UPDATE
  USING (EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = bookings.trip_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'editor')));
CREATE POLICY "booking_delete" ON bookings FOR DELETE
  USING (EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = bookings.trip_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'editor')));

-- todos
CREATE POLICY "todo_select" ON todos FOR SELECT
  USING (trip_id IS NULL OR EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = todos.trip_id AND tm.user_id = auth.uid()));
CREATE POLICY "todo_insert" ON todos FOR INSERT
  WITH CHECK (trip_id IS NULL OR EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = todos.trip_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'editor')));
CREATE POLICY "todo_update" ON todos FOR UPDATE
  USING (trip_id IS NULL OR EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = todos.trip_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'editor')));
CREATE POLICY "todo_delete" ON todos FOR DELETE
  USING (trip_id IS NULL OR EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = todos.trip_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'editor')));

-- day_notes
CREATE POLICY "day_note_select" ON day_notes FOR SELECT
  USING (trip_id IS NULL OR EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = day_notes.trip_id AND tm.user_id = auth.uid()));
CREATE POLICY "day_note_insert" ON day_notes FOR INSERT
  WITH CHECK (trip_id IS NULL OR EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = day_notes.trip_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'editor')));
CREATE POLICY "day_note_update" ON day_notes FOR UPDATE
  USING (trip_id IS NULL OR EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = day_notes.trip_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'editor')));
CREATE POLICY "day_note_delete" ON day_notes FOR DELETE
  USING (trip_id IS NULL OR EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = day_notes.trip_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'editor')));

-- trip_members
CREATE POLICY "trip_members_select" ON trip_members FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "trip_members_insert" ON trip_members FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = trip_members.trip_id AND tm.user_id = auth.uid() AND tm.role = 'owner')
    OR NOT EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = trip_members.trip_id)
  );
CREATE POLICY "trip_members_delete" ON trip_members FOR DELETE
  USING (EXISTS (SELECT 1 FROM trip_members tm WHERE tm.trip_id = trip_members.trip_id AND tm.user_id = auth.uid() AND tm.role = 'owner'));

-- ============================================================
-- STEP 12: SEED trip_members FOR EXISTING TRIPS
-- Replace 'YOUR_USER_UUID' with your actual user ID from auth.users
-- ============================================================
-- INSERT INTO trip_members (trip_id, user_id, role)
-- SELECT id, 'YOUR_USER_UUID'::uuid, 'owner' FROM trips
-- ON CONFLICT DO NOTHING;

-- ============================================================
-- DONE! Verify:
-- SELECT * FROM trips;
-- SELECT * FROM bookings LIMIT 5;
-- SELECT * FROM trip_members;
-- ============================================================
