import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db, dbReady, tables } from "@/db";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { optionInsertSchema } from "@/lib/schemas";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

/**
 * Create an option via JSON (not a Server Action). Server Actions hang behind
 * Cloudflare while waiting for the RSC refresh stream; this returns immediately.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return json({ error: "Unauthorized" }, 401);
  await dbReady();

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 64 * 1024) return json({ error: "Request body too large" }, 413);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON" }, 400);
  }

  const parsed = optionInsertSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return json({ error: `${first.path.join(".")}: ${first.message}` }, 400);
  }
  const data = parsed.data;
  const id = data.id || crypto.randomUUID();

  const [set] = await db
    .select({ trip_id: tables.optionSets.trip_id })
    .from(tables.optionSets)
    .where(eq(tables.optionSets.id, data.option_set_id))
    .limit(1);
  if (!set) return json({ error: "Decision not found" }, 404);

  try {
    await requireTripAccess(session.user.id, set.trip_id, WRITE_ROLES);
  } catch {
    return json({ error: "Forbidden" }, 403);
  }

  // A client-generated id makes retries safe when the insert committed but its
  // response was lost. A retry updates that same row rather than duplicating it.
  const [existing] = await db
    .select()
    .from(tables.options)
    .where(eq(tables.options.id, id))
    .limit(1);
  if (existing) {
    if (existing.option_set_id !== data.option_set_id) {
      return json({ error: "Option id already belongs to another decision" }, 409);
    }
    const [row] = await db
      .update(tables.options)
      .set({
        title: data.title,
        url: data.url ?? null,
        cost_amount: data.cost_amount ?? null,
        cost_currency: data.cost_currency ?? null,
        pros: data.pros ?? [],
        cons: data.cons ?? [],
        notes: data.notes ?? null,
      })
      .where(eq(tables.options.id, id))
      .returning();
    return json(row, 200);
  }

  const [{ next } = { next: 0 }] = await db
    .select({
      next: sql<number>`coalesce(max(${tables.options.sort_order}), -1) + 1`,
    })
    .from(tables.options)
    .where(eq(tables.options.option_set_id, data.option_set_id));

  const [row] = await db
    .insert(tables.options)
    .values({
      id,
      option_set_id: data.option_set_id,
      title: data.title,
      url: data.url ?? null,
      cost_amount: data.cost_amount ?? null,
      cost_currency: data.cost_currency ?? null,
      pros: data.pros ?? [],
      cons: data.cons ?? [],
      notes: data.notes ?? null,
      sort_order: next,
      is_pick: false,
    })
    .onConflictDoNothing({ target: tables.options.id })
    .returning();

  if (row) return json(row, 201);

  // Two identical retries can pass the initial existence check concurrently.
  // The primary key resolves that race; return/update the winner idempotently.
  const [winner] = await db
    .select()
    .from(tables.options)
    .where(eq(tables.options.id, id))
    .limit(1);
  if (!winner || winner.option_set_id !== data.option_set_id) {
    return json({ error: "Option id conflict" }, 409);
  }
  const [updated] = await db
    .update(tables.options)
    .set({
      title: data.title,
      url: data.url ?? null,
      cost_amount: data.cost_amount ?? null,
      cost_currency: data.cost_currency ?? null,
      pros: data.pros ?? [],
      cons: data.cons ?? [],
      notes: data.notes ?? null,
    })
    .where(eq(tables.options.id, id))
    .returning();
  return json(updated, 200);
}
