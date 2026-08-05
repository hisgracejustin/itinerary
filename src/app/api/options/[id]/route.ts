import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, dbReady, tables } from "@/db";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import { optionUpdateSchema } from "@/lib/schemas";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

async function tripIdForOption(optionId: string) {
  const [row] = await db
    .select({
      trip_id: tables.optionSets.trip_id,
      option_set_id: tables.options.option_set_id,
    })
    .from(tables.options)
    .innerJoin(tables.optionSets, eq(tables.options.option_set_id, tables.optionSets.id))
    .where(eq(tables.options.id, optionId))
    .limit(1);
  return row;
}

/** Update an option via JSON — see POST /api/options for why not a Server Action. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return json({ error: "Unauthorized" }, 401);
  await dbReady();

  const { id } = await params;
  const existing = await tripIdForOption(id);
  if (!existing) return json({ error: "Option not found" }, 404);

  try {
    await requireTripAccess(session.user.id, existing.trip_id, WRITE_ROLES);
  } catch {
    return json({ error: "Forbidden" }, 403);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 64 * 1024) return json({ error: "Request body too large" }, 413);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON" }, 400);
  }

  const parsed = optionUpdateSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return json({ error: `${first.path.join(".")}: ${first.message}` }, 400);
  }
  const updates = parsed.data;

  const [row] = await db
    .update(tables.options)
    .set({
      ...(updates.title !== undefined ? { title: updates.title } : {}),
      ...(updates.url !== undefined ? { url: updates.url ?? null } : {}),
      ...(updates.cost_amount !== undefined ? { cost_amount: updates.cost_amount ?? null } : {}),
      ...(updates.cost_currency !== undefined
        ? { cost_currency: updates.cost_currency ?? null }
        : {}),
      ...(updates.pros !== undefined ? { pros: updates.pros } : {}),
      ...(updates.cons !== undefined ? { cons: updates.cons } : {}),
      ...(updates.notes !== undefined ? { notes: updates.notes ?? null } : {}),
    })
    .where(eq(tables.options.id, id))
    .returning();

  return json(row, 200);
}
