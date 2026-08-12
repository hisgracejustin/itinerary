import { eq, inArray } from "drizzle-orm";
import { tables, type Db } from "@/db";
import { formatCurrency } from "./currencies";
import { expenseCategory } from "./expense-categories";
import type { AuditAction, AuditEntityType } from "@/db/schema";

/**
 * The write half of the audit trail (the read half is getAuditForTrip /
 * getAuditForEntity in lib/queries).
 *
 * Every function here takes the `client` doing the write and is called INSIDE
 * that write's transaction, so the log can never disagree with the row it
 * describes: if the booking update rolls back, so does the entry claiming it
 * happened, and if the audit insert fails the update it describes never lands.
 *
 * What is watched is deliberately narrow (see the field lists below). Seat, gate,
 * terminal, notes and room type change constantly and have never caused an
 * argument; cost, payer, splits, dates and which trip something is on have.
 */

/** A person as the log records them: the id AND their name at the time. */
export type Actor = { id: string; name?: string | null; email?: string | null };

/** What an audit row is about. `entity_label` freezes the subject's name. */
export type AuditSubject = {
  trip_id: string;
  entity_type: AuditEntityType;
  entity_id: string;
  entity_label: string;
};

type AuditRow = {
  /** Null for created/deleted — those describe the whole row, not one field. */
  field?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  /** User ids the old/new value points at, when it points at people. */
  old_refs?: string[] | null;
  new_refs?: string[] | null;
};

/** One watched field that actually moved. */
export type AuditChange = AuditRow & { field: string };

export type SplitRow = {
  user_id: string;
  weight: number;
  extra_amount?: number | null;
  paid_amount?: number | null;
};

export function personLabel(p: { name?: string | null; email?: string | null }) {
  return p.name?.trim() || p.email || "Someone";
}

/**
 * Display names for a set of user ids, resolved at WRITE time. These are the
 * names that survive the person being deleted, so they are stored alongside the
 * ids rather than instead of them.
 */
export async function userLabels(client: Db, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const rows = await client
    .select({ id: tables.users.id, name: tables.users.name, email: tables.users.email })
    .from(tables.users)
    .where(inArray(tables.users.id, unique));
  for (const r of rows) map.set(r.id, personLabel(r));
  return map;
}

async function tripNames(client: Db, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const rows = await client
    .select({ id: tables.trips.id, name: tables.trips.name })
    .from(tables.trips)
    .where(inArray(tables.trips.id, unique));
  for (const r of rows) map.set(r.id, r.name);
  return map;
}

/* ------------------------------- formatting ------------------------------- */

// null, undefined and "" all mean "not set"; without collapsing them first,
// every save that touches an empty field would log a change from nothing to
// nothing and bury the real edits.
const blank = (v: unknown) => v === null || v === undefined || v === "";
const text = (v: unknown) => (blank(v) ? null : String(v));
const differs = (a: unknown, b: unknown) => (blank(a) ? null : a) !== (blank(b) ? null : b);

/** Money reads like the UI does — same helper the screens format with. */
function money(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount == null) return null;
  return currency ? formatCurrency(amount, currency) : String(amount);
}

/**
 * One readable line for a whole split set — "Justin ×1 · Kate ×1 (+HK$50)". A
 * row per participant would drown the feed in noise every time a weight moves.
 */
export function splitSummary(
  splits: SplitRow[] | null | undefined,
  names: Map<string, string>,
  currency: string | null | undefined,
) {
  if (!splits || splits.length === 0) return null;
  return splits
    .map((s) => {
      const extra = s.extra_amount ? ` (+${money(s.extra_amount, currency)})` : "";
      const paid = s.paid_amount ? ` (paid ${money(s.paid_amount, currency)})` : "";
      return `${names.get(s.user_id) ?? "Someone"} ×${s.weight}${extra}${paid}`;
    })
    .join(" · ");
}

// Order-independent identity of a split set: the same people at the same weights
// in a different row order is not a change.
const splitKey = (splits: SplitRow[] | null | undefined) =>
  (splits ?? [])
    .map((s) => `${s.user_id}:${s.weight}:${s.extra_amount ?? 0}:${s.paid_amount ?? 0}`)
    .sort()
    .join("|");

const splitIds = (splits: SplitRow[] | null | undefined) => (splits ?? []).map((s) => s.user_id);

// A booking's cancellation policy is a nested tier ladder; a JSON diff of it is
// unreadable noise, so the log records THAT it changed and leaves the values
// null. Comparison is stringify-based, which is safe because every write passes
// through sanitizeCancellationPolicy and comes out with the same key order.
const policyKey = (details: Record<string, unknown> | null | undefined) =>
  JSON.stringify(details?.cancellation_policy ?? null);

/** How a booking is named in the feed — the type is half of "which booking". */
export const bookingLabel = (b: { type: string; title: string }) => `${b.type} ${b.title}`;

export const settlementLabel = (
  s: { amount: number; currency: string },
  fromName: string,
  toName: string,
) => `${formatCurrency(s.amount, s.currency)} ${fromName} → ${toName}`;

/* -------------------------------- writing --------------------------------- */

async function append(
  client: Db,
  actor: Actor,
  subject: AuditSubject,
  action: AuditAction,
  rows: AuditRow[],
) {
  if (rows.length === 0) return;
  await client.insert(tables.auditLog).values(
    rows.map((r) => ({
      ...subject,
      action,
      changed_by: actor.id,
      changed_by_label: personLabel(actor),
      field: r.field ?? null,
      old_value: r.old_value ?? null,
      new_value: r.new_value ?? null,
      old_refs: r.old_refs ?? null,
      new_refs: r.new_refs ?? null,
    })),
  );
}

/** `refs` carries the people the row is about (a settlement's two ends). */
export function recordCreated(client: Db, actor: Actor, subject: AuditSubject, refs?: string[]) {
  return append(client, actor, subject, "created", [{ new_refs: refs ?? null }]);
}

export function recordDeleted(client: Db, actor: Actor, subject: AuditSubject, refs?: string[]) {
  return append(client, actor, subject, "deleted", [{ old_refs: refs ?? null }]);
}

/** No changes ⇒ no rows: a save that moved no watched field must write nothing. */
export function recordChanges(
  client: Db,
  actor: Actor,
  subject: AuditSubject,
  changes: AuditChange[],
) {
  if (changes.length === 0) return Promise.resolve();
  return append(client, actor, subject, "updated", changes);
}

/* -------------------------------- diffing --------------------------------- */

export type BookingSnapshot = {
  trip_id: string;
  title: string;
  type: string;
  start_date: string;
  end_date: string | null;
  timezone: string;
  cost_amount: number | null;
  cost_currency: string | null;
  charged_currency: string | null;
  charged_rate: number | null;
  service_percent: number | null;
  shared_charge: number | null;
  paid_by: string | null;
  details: Record<string, unknown> | null;
  splits: SplitRow[];
};

/** Watched booking fields, in the order they read best in the feed. */
export async function bookingAuditChanges(
  client: Db,
  before: BookingSnapshot,
  after: BookingSnapshot,
): Promise<AuditChange[]> {
  const changes: AuditChange[] = [];
  const people = await userLabels(client, [
    before.paid_by,
    after.paid_by,
    ...splitIds(before.splits),
    ...splitIds(after.splits),
  ]);

  for (const f of ["title", "type", "start_date", "end_date", "timezone", "cost_currency", "charged_currency"] as const) {
    if (differs(before[f], after[f])) {
      changes.push({ field: f, old_value: text(before[f]), new_value: text(after[f]) });
    }
  }
  if (differs(before.cost_amount, after.cost_amount)) {
    changes.push({
      field: "cost_amount",
      old_value: money(before.cost_amount, before.cost_currency),
      new_value: money(after.cost_amount, after.cost_currency),
    });
  }
  if (differs(before.charged_rate, after.charged_rate)) {
    changes.push({
      field: "charged_rate",
      old_value: text(before.charged_rate),
      new_value: text(after.charged_rate),
    });
  }
  // Provenance for the split rows, but a changed service charge is exactly the
  // sort of edit people query later — same treatment as expenses.
  for (const f of ["service_percent", "shared_charge"] as const) {
    if (differs(before[f], after[f])) {
      changes.push({ field: f, old_value: text(before[f]), new_value: text(after[f]) });
    }
  }
  if (differs(before.paid_by, after.paid_by)) {
    changes.push(payerChange(before.paid_by, after.paid_by, people));
  }
  if (before.trip_id !== after.trip_id) {
    const trips = await tripNames(client, [before.trip_id, after.trip_id]);
    changes.push({
      field: "trip_id",
      old_value: trips.get(before.trip_id) ?? before.trip_id,
      new_value: trips.get(after.trip_id) ?? after.trip_id,
    });
  }
  if (splitKey(before.splits) !== splitKey(after.splits)) {
    changes.push(splitsChange(before, after, people));
  }
  if (policyKey(before.details) !== policyKey(after.details)) {
    changes.push({ field: "cancellation_policy" });
  }
  return changes;
}

export type ExpenseSnapshot = {
  trip_id: string;
  title: string;
  category: string;
  amount: number;
  currency: string;
  charged_currency: string | null;
  charged_rate: number | null;
  paid_by: string | null;
  date: string | null;
  service_percent: number | null;
  shared_charge: number | null;
  splits: SplitRow[];
};

export async function expenseAuditChanges(
  client: Db,
  before: ExpenseSnapshot,
  after: ExpenseSnapshot,
): Promise<AuditChange[]> {
  const changes: AuditChange[] = [];
  const people = await userLabels(client, [
    before.paid_by,
    after.paid_by,
    ...splitIds(before.splits),
    ...splitIds(after.splits),
  ]);

  for (const f of ["title", "currency", "charged_currency", "date"] as const) {
    if (differs(before[f], after[f])) {
      changes.push({ field: f, old_value: text(before[f]), new_value: text(after[f]) });
    }
  }
  if (differs(before.amount, after.amount)) {
    changes.push({
      field: "amount",
      old_value: money(before.amount, before.currency),
      new_value: money(after.amount, after.currency),
    });
  }
  if (differs(before.charged_rate, after.charged_rate)) {
    changes.push({
      field: "charged_rate",
      old_value: text(before.charged_rate),
      new_value: text(after.charged_rate),
    });
  }
  // Logged as the label, not the slug: history is read by people, and "Food &
  // drink → Transport" is the sentence they'd have said.
  if (differs(before.category, after.category)) {
    changes.push({
      field: "category",
      old_value: expenseCategory(before.category).label,
      new_value: expenseCategory(after.category).label,
    });
  }
  // The charge inputs are only provenance for the split rows, but a changed tip
  // is exactly the sort of edit people query later, so it belongs in the history.
  for (const f of ["service_percent", "shared_charge"] as const) {
    if (differs(before[f], after[f])) {
      changes.push({ field: f, old_value: text(before[f]), new_value: text(after[f]) });
    }
  }
  if (differs(before.paid_by, after.paid_by)) {
    changes.push(payerChange(before.paid_by, after.paid_by, people));
  }
  if (before.trip_id !== after.trip_id) {
    const trips = await tripNames(client, [before.trip_id, after.trip_id]);
    changes.push({
      field: "trip_id",
      old_value: trips.get(before.trip_id) ?? before.trip_id,
      new_value: trips.get(after.trip_id) ?? after.trip_id,
    });
  }
  if (splitKey(before.splits) !== splitKey(after.splits)) {
    changes.push(splitsChange(
      { ...before, cost_currency: before.currency },
      { ...after, cost_currency: after.currency },
      people,
    ));
  }
  return changes;
}

// The name goes in the value and the id in the refs, always both: the name is
// what stays readable after the account is deleted, the id is what tells two
// people called Justin apart.
function payerChange(
  oldId: string | null,
  newId: string | null,
  people: Map<string, string>,
): AuditChange {
  return {
    field: "paid_by",
    old_value: oldId ? (people.get(oldId) ?? "Someone") : null,
    new_value: newId ? (people.get(newId) ?? "Someone") : null,
    old_refs: oldId ? [oldId] : null,
    new_refs: newId ? [newId] : null,
  };
}

function splitsChange(
  before: { splits: SplitRow[]; cost_currency: string | null },
  after: { splits: SplitRow[]; cost_currency: string | null },
  people: Map<string, string>,
): AuditChange {
  return {
    field: "splits",
    old_value: splitSummary(before.splits, people, before.cost_currency),
    new_value: splitSummary(after.splits, people, after.cost_currency),
    old_refs: before.splits.length ? splitIds(before.splits) : null,
    new_refs: after.splits.length ? splitIds(after.splits) : null,
  };
}

/**
 * A party's membership, as one readable line plus the ids behind it — the same
 * shape as a split set, for the same reason (a row per member is noise).
 */
export async function partyMembersChange(
  client: Db,
  beforeIds: string[],
  afterIds: string[],
): Promise<AuditChange[]> {
  if ([...beforeIds].sort().join("|") === [...afterIds].sort().join("|")) return [];
  const people = await userLabels(client, [...beforeIds, ...afterIds]);
  const line = (ids: string[]) =>
    ids.length ? ids.map((id) => people.get(id) ?? "Someone").join(" · ") : null;
  return [
    {
      field: "members",
      old_value: line(beforeIds),
      new_value: line(afterIds),
      old_refs: beforeIds.length ? beforeIds : null,
      new_refs: afterIds.length ? afterIds : null,
    },
  ];
}

/** Everyone currently in a party — the before/after halves of a membership move. */
export async function partyMemberIds(client: Db, partyId: string) {
  const rows = await client
    .select({ user_id: tables.tripMembers.user_id })
    .from(tables.tripMembers)
    .where(eq(tables.tripMembers.party_id, partyId));
  return rows.map((r) => r.user_id);
}
