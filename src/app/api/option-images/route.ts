import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db, dbReady, tables } from "@/db";
import { requireTripAccess, WRITE_ROLES } from "@/lib/authz";
import {
  hasValidOptionImageSignature,
  isAllowedOptionImageType,
  OPTION_IMAGE_MAX_COUNT,
  OPTION_IMAGE_MAX_LABEL,
  OPTION_IMAGE_MAX_SIZE,
  OPTION_IMAGE_MAX_TOTAL_SIZE,
} from "@/lib/option-images";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

/**
 * Upload a photo for an option. Multipart fields: `file`, `option_id`.
 * Same size ceiling as booking attachments (Vercel body limit).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return json({ error: "Unauthorized" }, 401);
  await dbReady();

  const rawContentLength = req.headers.get("content-length");
  if (!rawContentLength) {
    return json({ error: "Content-Length is required" }, 411);
  }
  const contentLength = Number(rawContentLength);
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return json({ error: "Invalid Content-Length" }, 400);
  }
  if (contentLength > OPTION_IMAGE_MAX_SIZE + 1024 * 1024) {
    return json({ error: `File too large. Maximum size is ${OPTION_IMAGE_MAX_LABEL}.` }, 413);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Expected multipart/form-data" }, 400);
  }

  const optionId = form.get("option_id");
  const imageId = form.get("image_id");
  const file = form.get("file");

  if (typeof optionId !== "string" || !optionId) {
    return json({ error: "Missing option_id" }, 400);
  }
  if (
    typeof imageId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      imageId,
    )
  ) {
    return json({ error: "Missing or invalid image_id" }, 400);
  }
  if (!(file instanceof File)) {
    return json({ error: "Missing file" }, 400);
  }
  if (!isAllowedOptionImageType(file.type)) {
    return json({ error: `Unsupported file type: ${file.type || "unknown"}` }, 400);
  }
  if (file.size > OPTION_IMAGE_MAX_SIZE) {
    return json({ error: `File too large. Maximum size is ${OPTION_IMAGE_MAX_LABEL}.` }, 413);
  }
  if (file.size === 0) {
    return json({ error: "File is empty." }, 400);
  }

  const [option] = await db
    .select({ trip_id: tables.optionSets.trip_id })
    .from(tables.options)
    .innerJoin(tables.optionSets, eq(tables.options.option_set_id, tables.optionSets.id))
    .where(eq(tables.options.id, optionId))
    .limit(1);
  if (!option) return json({ error: "Option not found" }, 404);

  try {
    await requireTripAccess(session.user.id, option.trip_id, WRITE_ROLES);
  } catch {
    return json({ error: "Forbidden" }, 403);
  }

  // Image ids are generated when a file is staged. If an upload committed but
  // its response was lost, retrying returns the existing image, not a duplicate.
  const [existingImage] = await db
    .select({
      id: tables.optionImages.id,
      option_id: tables.optionImages.option_id,
      filename: tables.optionImages.filename,
      mime_type: tables.optionImages.mime_type,
      size_bytes: tables.optionImages.size_bytes,
      sort_order: tables.optionImages.sort_order,
      created_at: tables.optionImages.created_at,
    })
    .from(tables.optionImages)
    .where(eq(tables.optionImages.id, imageId))
    .limit(1);
  if (existingImage) {
    if (existingImage.option_id !== optionId) {
      return json({ error: "Image id already belongs to another option" }, 409);
    }
    return json(existingImage, 200);
  }

  const [{ count, total } = { count: 0, total: 0 }] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${tables.optionImages.size_bytes}), 0)::int`,
    })
    .from(tables.optionImages)
    .where(eq(tables.optionImages.option_id, optionId));
  const imageCount = Number(count);
  const totalBytes = Number(total);
  if (imageCount >= OPTION_IMAGE_MAX_COUNT) {
    return json({ error: `Maximum ${OPTION_IMAGE_MAX_COUNT} photos per option` }, 409);
  }
  if (totalBytes + file.size > OPTION_IMAGE_MAX_TOTAL_SIZE) {
    return json({ error: "Photo storage limit reached for this option" }, 413);
  }

  const content = Buffer.from(await file.arrayBuffer());
  if (!hasValidOptionImageSignature(content, file.type)) {
    return json({ error: "File contents do not match the selected image type" }, 400);
  }

  const [{ next } = { next: 0 }] = await db
    .select({
      next: sql<number>`coalesce(max(${tables.optionImages.sort_order}), -1) + 1`,
    })
    .from(tables.optionImages)
    .where(eq(tables.optionImages.option_id, optionId));
  const [row] = await db
    .insert(tables.optionImages)
    .values({
      id: imageId,
      option_id: optionId,
      filename: (file.name || "photo").slice(0, 255),
      mime_type: file.type,
      size_bytes: file.size,
      content,
      sort_order: next,
      uploaded_by: session.user.id,
    })
    .returning();

  return json(
    {
      id: row.id,
      option_id: row.option_id,
      filename: row.filename,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      sort_order: row.sort_order,
      created_at: row.created_at,
    },
    201,
  );
}
