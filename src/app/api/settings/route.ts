import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { handler, json } from "@/lib/api-handler";
import { SettingsUpdateSchema } from "@/lib/schemas";
import { requireAdmin } from "@/lib/auth";

export const GET = handler({}, async () => {
  const settings = await getSettings();

  // Strip sensitive QB token fields — expose only connection status
  const { qbAccessToken, qbRefreshToken, ...safe } = settings;
  return json({
    settings: {
      ...safe,
      // Boolean flag for UI — "is QB connected?"
      qbConnected: !!(qbAccessToken && safe.qbRealmId),
    },
  });
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

    const { qbAccessToken, qbRefreshToken, ...safe } = settings;
    return json({
      settings: {
        ...safe,
        qbConnected: !!(qbAccessToken && safe.qbRealmId),
      },
    });
  },
);
