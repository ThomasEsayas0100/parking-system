import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { handler, json, notFound } from "@/lib/api-handler";

// ---------------------------------------------------------------------------
// GET: list all allow list entries
// ---------------------------------------------------------------------------
export const GET = handler({}, async () => {
  await requireAdmin();
  const entries = await prisma.allowList.findMany({
    orderBy: { name: "asc" },
  });
  return json({ entries });
});

// ---------------------------------------------------------------------------
// POST: add a new entry
// ---------------------------------------------------------------------------
const AddSchema = z.object({
  phone: z.string().min(4).max(20),
  name: z.string().min(1).max(200),
  label: z.string().min(1).max(100).default("Employee"),
});

export const POST = handler({ body: AddSchema }, async ({ body }) => {
  await requireAdmin();
  const phone = body.phone.replace(/\D/g, "");
  const entry = await prisma.allowList.create({
    data: { phone, name: body.name, label: body.label },
  });
  return json({ entry }, { status: 201 });
});

// ---------------------------------------------------------------------------
// PUT: update an entry (toggle active, rename, change label)
// ---------------------------------------------------------------------------
const UpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  label: z.string().min(1).max(100).optional(),
  active: z.boolean().optional(),
});

export const PUT = handler({ body: UpdateSchema }, async ({ body }) => {
  await requireAdmin();
  const { id, ...data } = body;
  const existing = await prisma.allowList.findUnique({ where: { id } });
  if (!existing) throw notFound("Entry not found");
  const updated = await prisma.allowList.update({ where: { id }, data });
  return json({ entry: updated });
});

// ---------------------------------------------------------------------------
// DELETE: remove an entry
// ---------------------------------------------------------------------------
const DeleteSchema = z.object({ id: z.string().min(1) });

export const DELETE = handler({ body: DeleteSchema }, async ({ body }) => {
  await requireAdmin();
  const existing = await prisma.allowList.findUnique({ where: { id: body.id } });
  if (!existing) throw notFound("Entry not found");
  await prisma.allowList.delete({ where: { id: body.id } });
  return json({ success: true });
});
