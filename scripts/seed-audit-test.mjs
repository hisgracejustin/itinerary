// Seeds a throwaway PGlite for the audit-trail verification: two people who
// share a display name (the "two Justins" case), an editor, and a second trip
// owned by someone else (the authz case). Run with PGLITE_DIR set.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const dir = process.env.PGLITE_DIR;
if (!dir) throw new Error("set PGLITE_DIR");

const client = new PGlite(dir);
const db = drizzle(client);
await migrate(db, { migrationsFolder: "./drizzle" });

const q = (sql, params = []) => client.query(sql, params);

const users = [
  ["u-justin-a", "Justin", "justin.a@example.com"],
  ["u-justin-b", "Justin", "justin.b@example.com"],
  ["u-kate", "Kate", "kate@example.com"],
  ["u-bob", "Bob", "bob@example.com"],
];
for (const [id, name, email] of users) {
  await q(`insert into users (id, name, email) values ($1,$2,$3)`, [id, name, email]);
}

const TRIP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
await q(`insert into trips (id, name, start_date, end_date) values ($1,$2,$3,$4)`, [
  TRIP, "Japan 2026", "2026-09-01", "2026-09-14",
]);
await q(`insert into trips (id, name, start_date, end_date) values ($1,$2,$3,$4)`, [
  OTHER, "Iceland 2026", "2026-11-01", "2026-11-10",
]);

const members = [
  [TRIP, "u-justin-a", "owner"],
  [TRIP, "u-justin-b", "editor"],
  [TRIP, "u-kate", "editor"],
  [OTHER, "u-bob", "owner"],
];
for (const [trip, user, role] of members) {
  await q(`insert into trip_members (trip_id, user_id, role) values ($1,$2,$3)`, [trip, user, role]);
}

console.log("Seeded", dir);
await client.close();
