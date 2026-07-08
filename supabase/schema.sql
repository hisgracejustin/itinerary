-- Itinerary App Schema (with Auth + RLS)
-- This represents the final schema state after migration.

-- ============================================================
-- TRIPS
-- ============================================================
CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TRIP MEMBERS (per-user access control)
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
-- BOOKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('flight', 'train', 'bus', 'cruise', 'hotel', 'activity')),
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  confirmation_number TEXT,
  provider TEXT,
  details JSONB,
  cost_amount NUMERIC,
  cost_currency TEXT,
  cost_share NUMERIC DEFAULT 1,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'parsed')),
  source_file TEXT,
  raw_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_trip_id ON bookings(trip_id);
CREATE INDEX IF NOT EXISTS idx_bookings_start_date ON bookings(start_date);
CREATE INDEX IF NOT EXISTS idx_bookings_type ON bookings(type);

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TODOS
-- ============================================================
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  due_date TEXT,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_todos_trip_id ON todos(trip_id);
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);

ALTER TABLE todos ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- DAY NOTES
-- ============================================================
CREATE TABLE IF NOT EXISTS day_notes (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_day_notes_date ON day_notes(date);
CREATE INDEX IF NOT EXISTS idx_day_notes_trip_id ON day_notes(trip_id);

ALTER TABLE day_notes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
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
