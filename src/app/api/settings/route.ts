import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { handler, json } from "@/lib/api-handler";
import { SettingsUpdateSchema } from "@/lib/schemas";
import { requireAdmin } from "@/lib/auth";

export const GET = handler({}, async () => {
  const settings = await getSettings();
  return json({ settings });
});

export const PUT = handler(
  { body: SettingsUpdateSchema },
  async ({ body }) => {
    await requireAdmin();
    const settings = await prisma.settings.upsert({
      where: { id: "default" },
      update: body,
      create: { id: "default", ...body },
    });
    return json({ settings });
  },
);
