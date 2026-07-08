# Itinerary App — Implementation Plan

## Status: ✅ All Phases Complete

All 6 implementation phases are done. The app is ready for Netlify deployment.

## Context

Build a personal travel itinerary app — a React SPA that displays bookings on a beautiful calendar (month/week/day views), with forms for manually adding events. AI parsing of booking documents happens offline (in this conversation), not in the app itself. Single user, no auth.

## Scope

- **Display**: Calendar with month, week, and day views — color-coded by booking type, filterable by trip tag
- **Forms**: Add/edit/delete bookings (flights, trains, cruises, hotels, activities) with type-specific fields
- **Persistence**: Supabase (Postgres, client-side access, no backend needed)
- **Initial data**: I parse your PDFs/emails here in conversation → output structured JSON → seed into DB
- **No AI in the app yet** — no API keys, no upload pipeline, no parsing logic — but architecture supports adding it later
- **Booking types**: Flights, trains, cruises, hotels, activities
- **Organization**: Single calendar, bookings tagged with trip name
- **Additional features built**: Costs page with currency conversion, To-dos with per-trip filtering

## Tech Stack

- **Frontend**: React 18 (Vite 5) + Tailwind CSS 3 + React Router 6
- **Database**: Supabase (Postgres, direct client-side access)
- **Calendar**: Custom-built with Tailwind (full design control)
- **Deployment**: Netlify (static SPA, `netlify.toml` configured)

## Data Model

```sql
CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  trip TEXT NOT NULL,              -- e.g. "Japan 2026"
  type TEXT NOT NULL,              -- flight | train | cruise | hotel | activity
  title TEXT NOT NULL,             -- e.g. "Tokyo → Osaka", "Hilton Shibuya"
  start_date TEXT NOT NULL,        -- ISO datetime
  end_date TEXT,                   -- ISO datetime (nullable for point-in-time events)
  confirmation_number TEXT,
  provider TEXT,                   -- airline, hotel chain, cruise line, etc.
  details TEXT,                    -- JSON string with type-specific fields
  cost_amount REAL,               -- booking cost
  cost_currency TEXT,             -- currency code (HKD, JPY, USD, etc.)
  cost_share REAL DEFAULT 1,     -- share of cost (e.g. 0.5 for split)
  source TEXT,                     -- 'manual' | 'parsed' (for future AI uploads)
  source_file TEXT,                -- reference to uploaded file (future use)
  raw_text TEXT,                   -- extracted text from source doc (future use)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE trips (
  name TEXT PRIMARY KEY,
  start_date TEXT,
  end_date TEXT
);

CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  trip TEXT,
  due_date TEXT,
  completed BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Type-specific `details` fields:
- **Flight**: departure_airport, arrival_airport, flight_number, seat, terminal, gate
- **Train**: departure_station, arrival_station, train_number, car, seat
- **Cruise**: ship_name, cabin, deck, departure_port, arrival_port, ports_of_call[]
- **Hotel**: address, check_in_time, check_out_time, room_type
- **Activity**: location, address, notes, duration

## Implementation Phases

### Phase 1: Project Scaffolding ✅
- Vite + React + Tailwind + React Router setup
- Supabase client setup (`@supabase/supabase-js`)
- Database schema (bookings, trips, todos tables)
- Basic app layout (header, sidebar with trip filter, main content area)

### Phase 2: Data Layer ✅
- Supabase client config (`src/lib/supabase.js`)
- CRUD hooks/functions for bookings, todos, trips
- Seed scripts (`scripts/seed.js`, `scripts/seed-trips.js`)
- Custom hooks: `useBookings`, `useBooking`, `useTrips`, `useTripMeta`, `useTodos`

### Phase 3: Calendar Views ✅
- Month view: desktop grid with colored booking chips (max 3 per day + overflow)
- Mobile month view: compact calendar + scrollable agenda
- Week view: 7-column layout with time-based booking chips
- Day view: 24-hour timeline with all-day section + todos
- Navigation (prev/next, today button, view switcher)
- Trip filter (sidebar) with date range highlighting
- Click day → switch to day view

### Phase 4: Booking Forms ✅
- Add booking modal with type selector
- "Upload Document" placeholder (coming soon) next to "Add Manually"
- Type-specific form fields (dynamic based on selection)
- Edit existing booking (pre-filled form)
- Delete with confirmation dialog
- Form validation (trip, title, dates required)
- Cost fields (amount, currency, share)

### Phase 5: Booking Cards & Styling ✅
- Type-specific card designs with icons and detail rendering
- ✈️ Flight: airports, flight number, times, terminal, gate, seat
- 🚂 Train: stations, train number, car, seat
- 🚢 Cruise: ship, cabin, deck, ports
- 🏨 Hotel: address, check-in/out times, room type, nights count
- 🎯 Activity: location, duration, notes
- Color coding by type (blue/green/purple/amber/pink)
- Responsive design (mobile-first with desktop enhancements)
- Compact chips for calendar grid, full cards for day/agenda views

### Phase 6: Polish & Deploy ✅
- Toast notification system (success/error/info with auto-dismiss)
- Animated loading spinners (replacing plain text)
- Error states with icons and descriptive messages
- Empty states with contextual icons and help text
- Netlify deployment config (`netlify.toml` + `public/_redirects`)

## Additional Features (Beyond Original Plan)

- **Costs page**: Total in HKD, currency breakdown, by-type breakdown with percentage bars
- **To-dos page**: Add/complete/delete todos, per-trip filtering, collapsible completed section
- **Trip metadata**: Start/end dates per trip, calendar highlights trip date ranges
- **Mobile-first**: MobileMonthView with agenda, responsive sidebar with overlay

## Architecture

```
src/
├── main.jsx              # Entry point (BrowserRouter + ToastProvider)
├── App.jsx               # Route definitions
├── components/
│   ├── Layout.jsx        # Shell: header + sidebar + outlet
│   ├── Header.jsx        # Top bar with add button
│   ├── Sidebar.jsx       # Trip filter + nav links
│   ├── BookingCard.jsx   # Full booking display with type-specific details
│   ├── BookingChip.jsx   # Compact booking display for calendar grids
│   ├── BookingForm.jsx   # Dynamic form with type-specific fields
│   ├── BookingModal.jsx  # Modal wrapper with save/delete/close
│   ├── MonthView.jsx     # Desktop month grid
│   ├── MobileMonthView.jsx # Mobile calendar + agenda
│   ├── WeekView.jsx      # 7-day columns
│   ├── DayView.jsx       # 24-hour timeline
│   ├── Spinner.jsx       # Animated loading indicator
│   └── Toast.jsx         # Toast notification system (context + provider)
├── hooks/
│   ├── useBookings.js    # useBookings, useBooking, useTrips, useTripMeta
│   └── useTodos.js       # useTodos
├── lib/
│   ├── supabase.js       # Supabase client init
│   ├── bookings.js       # Booking CRUD + trip queries
│   ├── todos.js          # Todo CRUD
│   ├── calendar.js       # Date utilities, TYPE_COLORS, TYPE_ICONS
│   ├── currencies.js     # Currency conversion (toHKD, formatCurrency)
│   └── airports.js       # Airport codes/names lookup
└── pages/
    ├── Calendar.jsx      # Main calendar with view switching
    ├── BookingsByType.jsx# Filtered list by booking type
    ├── Costs.jsx         # Cost breakdown and analysis
    └── Todos.jsx         # Todo management
```

## Workflow for Adding Bookings

### Via the app (ongoing):
1. Click "Add Booking" → select type → fill form → save

### Via this conversation (initial load & bulk):
1. You paste/upload PDF or email text here
2. I parse it and output structured JSON
3. You paste that into a seed script or I add it directly to your DB

## Extensibility (Future AI Parsing)

The architecture is designed so adding AI-powered file uploads later requires minimal changes:

1. **API**: Add a Netlify Function `POST /api/parse` — accepts file, extracts text (pdf-parse / Claude Vision), calls AI, then feeds result into the existing `createBooking()` function
2. **Data model**: `source`, `source_file`, and `raw_text` columns already exist
3. **UI**: Add upload drop zone to the "Add Booking" modal — parsed results pre-fill the same form for user review before saving
4. **Dependencies to add later**: `pdf-parse`, `@anthropic-ai/sdk`, Supabase Storage for file uploads

No structural refactoring needed — just additive changes.

## Deployment

```bash
# Build
npm run build    # outputs to dist/

# Deploy (Netlify)
# Connect repo to Netlify or use `netlify deploy --prod`
# Environment variables needed:
#   VITE_SUPABASE_URL
#   VITE_SUPABASE_ANON_KEY
```

## Verification

1. ✅ Add a flight booking via form → appears on correct date in all 3 calendar views
2. ✅ Seed 10+ bookings across 2 trips → trip filter works
3. ✅ Edit a booking → changes persist after page reload
4. ✅ Delete a booking → removed with confirmation + toast
5. ✅ Test on mobile viewport → responsive layout works
6. ⬜ Deploy to Netlify → verify Supabase connection works from production
