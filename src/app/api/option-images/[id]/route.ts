import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, dbReady, tables } from "@/db";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

function contentDisposition(filename: string, download: boolean): string {
  const type = download ? "attachment" : "inline";
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function loadImage(id: string) {
  const [row] = await db
    .select({
      id: tables.optionImages.id,
      filename: tables.optionImages.filename,
      mime_type: tables.optionImages.mime_type,
      size_bytes: tables.optionImages.size_bytes,
      content: tables.optionImages.content,
      trip_id: tables.optionSets.trip_id,
    })
    .from(tables.optionImages)
    .innerJoin(tables.options, eq(tables.optionImages.option_id, tables.options.id))
    .innerJoin(tables.optionSets, eq(tables.options.option_set_id, tables.optionSets.id))
    .where(eq(tables.optionImages.id, id))
    .limit(1);
  return row;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return json({ error: "Unauthorized" }, 401);
  await dbReady();

  const { id } = await params;
  const row = await loadImage(id);
  if (!row) return json({ error: "Not found" }, 404);

  try {
    await requireTripAccess(session.user.id, row.trip_id);
  } catch {
    return json({ error: "Forbidden" }, 403);
  }

  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(row.content as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": row.mime_type || "application/octet-stream",
      "Content-Length": String(row.size_bytes),
      "Content-Disposition": contentDisposition(row.filename, download),
      // Membership and deletion changes must take effect immediately. A cached
      // authenticated image must not survive an account switch in the browser.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox allow-downloads",
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return json({ error: "Unauthorized" }, 401);
  await dbReady();

  const { id } = await params;
  const row = await loadImage(id);
  if (!row) return json({ error: "Not found" }, 404);

  try {
    await requireTripAccess(session.user.id, row.trip_id, WRITE_ROLES);
  } catch {
    return json({ error: "Forbidden" }, 403);
  }

  await db.delete(tables.optionImages).where(eq(tables.optionImages.id, id));
  return json({ ok: true }, 200);
}
