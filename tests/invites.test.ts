import test from "node:test";
import assert from "node:assert/strict";

// Invite links hand a member account to whoever opens the link, so every rule
// that keeps that safe is pinned here against a real (in-memory) Postgres.
process.env.PGLITE_DIR = "memory://";
process.env.ADMIN_EMAILS = "admin@test.dev";
delete process.env.DATABASE_URL;

const { db, dbReady, tables } = await import("../src/db");
const { eq } = await import("drizzle-orm");
const invites = await import("../src/lib/invites");
const { hashPin } = await import("../src/lib/pin");
await dbReady();

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
await db.insert(tables.users).values([
  { id: "alice", name: "Alice Chan", email: "alice@test.dev", password_hash: await hashPin("246810") },
  { id: "carol", name: "Carol Ng", email: "carol@test.dev", password_hash: await hashPin("135791") },
  { id: "admin", name: "Admin", email: "admin@test.dev" },
  { id: "bob", name: "Bob Lee", email: "bob@test.dev" }, // added by email, never signed in
  { id: "hong", name: "Hong Kiu", email: "hong-kiu-1a2b3c4d5e@no-email.invalid" }, // added by name
  { id: "kiu", name: "Kiu", email: "kiu-9f8e7d6c5b@no-email.invalid" },
  { id: "taken", name: "Taken", email: "taken@test.dev" }, // a real account with data
  { id: "hollow", name: "Hollow", email: "hollow@test.dev" }, // an empty leftover row
]);
await db.insert(tables.trips).values([
  { id: T1, name: "Canada & Alaska", start_date: "2026-11-10", end_date: "2026-11-24" },
  { id: T2, name: "Carol's trip", start_date: "2026-12-01", end_date: "2026-12-05" },
]);
await db.insert(tables.tripMembers).values([
  { trip_id: T1, user_id: "alice", role: "owner" },
  { trip_id: T1, user_id: "bob", role: "editor" },
  { trip_id: T1, user_id: "hong", role: "editor" },
  { trip_id: T1, user_id: "kiu", role: "viewer" },
  { trip_id: T2, user_id: "carol", role: "owner" },
  { trip_id: T2, user_id: "bob", role: "editor" },
  { trip_id: T2, user_id: "taken", role: "editor" },
]);
const alice = { id: "alice", email: "alice@test.dev" };
const admin = { id: "admin", email: "admin@test.dev" };
const userRow = async (id: string) => (await db.select().from(tables.users).where(eq(tables.users.id, id)))[0];

test("an owner gets a one-time link; only its hash is stored", async () => {
  const { token, expiresAt } = await invites.createInvite(alice, T1, "hong");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 6.99 && days <= 7, String(days));
  const rows = await db.select().from(tables.memberInvites).where(eq(tables.memberInvites.user_id, "hong"));
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token);
  assert.deepEqual(await invites.inspectInvite(token), {
    state: "ok", tripName: "Canada & Alaska", memberName: "Hong Kiu", inviterName: "Alice Chan", expiresAt: rows[0].expires_at,
  });
});

test("who may send one", async () => {
  await assert.rejects(invites.createInvite({ id: "bob", email: "bob@test.dev" }, T1, "hong"), /Only this trip's owners/);
  await assert.rejects(invites.createInvite(alice, T1, "carol"), /not on this trip/);
  await assert.rejects(invites.createInvite(alice, T1, "alice"), /already sign in/);
  // Bob is also on Carol's trip: Alice can't hand his account out, an admin can.
  await assert.rejects(invites.createInvite(alice, T1, "bob"), /trip you don't own/);
  await invites.createInvite(admin, T1, "bob");
  assert.equal(await invites.inspectInvite("x".repeat(43)).then((v) => v.state), "invalid");
  assert.equal(await invites.inspectInvite("not-a-token").then((v) => v.state), "invalid");
});

test("a new link replaces the old one, and links can be cancelled", async () => {
  const first = await invites.createInvite(alice, T1, "kiu");
  const second = await invites.createInvite(alice, T1, "kiu");
  assert.equal((await invites.inspectInvite(first.token)).state, "invalid");
  assert.equal((await invites.inspectInvite(second.token)).state, "ok");
  await invites.cancelInvite(alice, T1, "kiu");
  assert.equal((await invites.inspectInvite(second.token)).state, "invalid");
});

test("an expired link shows as expired and can't be used", async () => {
  const { token } = await invites.createInvite(alice, T1, "kiu");
  await db
    .update(tables.memberInvites)
    .set({ expires_at: new Date(Date.now() - 1000) })
    .where(eq(tables.memberInvites.user_id, "kiu"));
  assert.equal((await invites.inspectInvite(token)).state, "expired");
  await assert.rejects(invites.redeemInvite(token, { email: "kiu@real.dev", verified: false, pinHash: "x" }), /expired or was already used/);
});

test("redeeming with a PIN: their email and PIN, marked unverified; the link is then spent", async () => {
  const { token } = await invites.createInvite(alice, T1, "hong");
  // Someone else's address is refused, and the link survives the refusal.
  await assert.rejects(invites.redeemInvite(token, { email: "taken@test.dev", verified: false, pinHash: "h" }), /already has an account/);
  // A typed-in address never takes over even an empty leftover account.
  await assert.rejects(invites.redeemInvite(token, { email: "hollow@test.dev", verified: false, pinHash: "h" }), /already has an account/);
  await assert.rejects(invites.redeemInvite(token, { email: "x@no-email.invalid", verified: false, pinHash: "h" }), /your own email/);
  assert.equal((await invites.inspectInvite(token)).state, "ok");

  const pinHash = await hashPin("777777");
  // Two tabs racing the same link: exactly one wins.
  const results = await Promise.allSettled([
    invites.redeemInvite(token, { email: "Hong.Kiu@Example.com ", verified: false, pinHash }),
    invites.redeemInvite(token, { email: "hong.kiu@example.com", verified: false, pinHash }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  const hong = await userRow("hong");
  assert.equal(hong.email, "hong.kiu@example.com");
  assert.equal(hong.email_unverified, true);
  assert.equal(hong.password_hash, pinHash);
  assert.equal((await invites.inspectInvite(token)).state, "used");
  // And now they sign in themselves, so no new link can be made for them.
  await assert.rejects(invites.createInvite(alice, T1, "hong"), /already sign in/);
});

test("Google may not sign in to an address someone only typed in", async () => {
  assert.equal(await invites.googleMaySignIn("hong.kiu@example.com", "g-stranger"), false);
  assert.equal(await invites.googleMaySignIn("bob@test.dev", "g-bob"), true); // added by an owner, as before
  assert.equal(await invites.googleMaySignIn("nobody@test.dev", "g-nobody"), false);
});

test("redeeming with Google: verified, may absorb an empty leftover account, never a linked one", async () => {
  // Kiu's Google address has an empty leftover row that already signed in once.
  await db.insert(tables.authAccounts).values({ userId: "hollow", type: "oidc", provider: "google", providerAccountId: "g-hollow" });
  const { token } = await invites.createInvite(alice, T1, "kiu");
  await invites.redeemInvite(token, { email: "hollow@test.dev", verified: true, googleAccountId: "g-hollow" });
  const kiu = await userRow("kiu");
  assert.equal(kiu.email, "hollow@test.dev");
  assert.equal(kiu.email_unverified, false);
  assert.ok(kiu.emailVerified);
  assert.equal(await userRow("hollow"), undefined);
  const links = await db.select().from(tables.authAccounts).where(eq(tables.authAccounts.providerAccountId, "g-hollow"));
  assert.equal(links[0].userId, "kiu");
  assert.equal(await invites.googleMaySignIn("hollow@test.dev", "g-hollow"), true);

  // A Google account that already belongs to someone with data is refused.
  await db.insert(tables.authAccounts).values({ userId: "taken", type: "oidc", provider: "google", providerAccountId: "g-taken" });
  const bobLink = await invites.createInvite(admin, T1, "bob");
  await assert.rejects(
    invites.redeemInvite(bobLink.token, { email: "bob.real@test.dev", verified: true, googleAccountId: "g-taken" }),
    /Google account already has an account/,
  );
  assert.equal((await invites.inspectInvite(bobLink.token)).state, "ok");
});

test("a link stops working if its sender no longer covers every trip the member is on", async () => {
  await db.insert(tables.users).values({ id: "mei", name: "Mei", email: "mei-0a0b0c0d0e@no-email.invalid" });
  await db.insert(tables.tripMembers).values({ trip_id: T1, user_id: "mei", role: "editor" });
  const { token } = await invites.createInvite(alice, T1, "mei");
  assert.equal((await invites.inspectInvite(token)).state, "ok");
  // Carol adds Mei to her trip after Alice made the link: Alice's link must
  // not become a way into Carol's trip.
  await db.insert(tables.tripMembers).values({ trip_id: T2, user_id: "mei", role: "viewer" });
  assert.equal((await invites.inspectInvite(token)).state, "invalid");
  await assert.rejects(invites.redeemInvite(token, { email: "mei@real.dev", verified: false, pinHash: "h" }), /isn't valid/);
  // Back to only Alice's trips: the link works again (the refusal didn't spend it).
  const { and: andOp } = await import("drizzle-orm");
  await db.delete(tables.tripMembers).where(andOp(eq(tables.tripMembers.trip_id, T2), eq(tables.tripMembers.user_id, "mei")));
  assert.equal((await invites.inspectInvite(token)).state, "ok");
  // Removed from the trip the link was sent from: no longer valid.
  await db.delete(tables.tripMembers).where(andOp(eq(tables.tripMembers.trip_id, T1), eq(tables.tripMembers.user_id, "mei")));
  assert.equal((await invites.inspectInvite(token)).state, "invalid");
});
