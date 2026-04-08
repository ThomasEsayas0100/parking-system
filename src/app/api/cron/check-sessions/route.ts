import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { sendSMS, sendEmail } from "@/lib/notifications";
import { log as audit } from "@/lib/audit";
import { ceilHours } from "@/lib/rates";

// This endpoint should be called periodically (e.g., every 5 minutes via Vercel Cron or external cron)
export async function GET() {
  const settings = await getSettings();
  const now = new Date();

  // 1. Send expiry reminders to drivers
  const reminderThreshold = new Date(
    now.getTime() + settings.reminderMinutesBefore * 60 * 1000
  );

  const sessionsNeedingReminder = await prisma.session.findMany({
    where: {
      status: "ACTIVE",
      reminderSent: false,
      expectedEnd: { lte: reminderThreshold },
    },
    include: { driver: true, spot: true },
  });

  for (const session of sessionsNeedingReminder) {
    const expiresAt = new Date(session.expectedEnd).toLocaleString();
    const extendUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/extend?sessionId=${session.id}`;

    const message = `Your parking at spot ${session.spot.label} expires at ${expiresAt}. Extend your time here: ${extendUrl}`;

    await sendSMS(session.driver.phone, message);
    await sendEmail(session.driver.email, "Parking Expiry Reminder", message);

    await prisma.session.update({
      where: { id: session.id },
      data: { reminderSent: true },
    });

    await audit({
      action: "REMINDER_SENT",
      sessionId: session.id,
      driverId: session.driverId,
      spotId: session.spotId,
      details: `Expiry reminder sent to ${session.driver.name} (${session.driver.phone}) — spot ${session.spot.label}`,
    });
  }

  // 2. Notify manager about overstayed vehicles
  const graceThreshold = new Date(
    now.getTime() - settings.gracePeriodMinutes * 60 * 1000
  );

  const overstayedSessions = await prisma.session.findMany({
    where: {
      status: "ACTIVE",
      expectedEnd: { lte: graceThreshold },
    },
    include: { driver: true, spot: true },
  });

  // Mark overstayed sessions — ACTIVE → OVERSTAY so the spot stays
  // occupied on the map but shows as overdue until the driver exits
  if (overstayedSessions.length > 0) {
    await prisma.session.updateMany({
      where: { id: { in: overstayedSessions.map((s) => s.id) }, status: "ACTIVE" },
      data: { status: "OVERSTAY" },
    });

    await Promise.all(
      overstayedSessions.map((s) =>
        audit({
          action: "OVERSTAY_START",
          sessionId: s.id,
          driverId: s.driverId,
          spotId: s.spotId,
          details: `Overstay began at spot ${s.spot.label} — ${s.driver.name} (${s.driver.phone})`,
        })
      )
    );
  }

  if (overstayedSessions.length > 0 && settings.managerEmail) {
    const lines = overstayedSessions.map((s) => {
      const overHours = ceilHours(new Date(s.expectedEnd), now);
      return `- Spot ${s.spot.label}: ${s.driver.name} (${s.driver.phone}) — ${overHours}h overstay`;
    });

    const body = `The following vehicles have overstayed:\n\n${lines.join("\n")}`;

    await sendEmail(settings.managerEmail, "Overstay Alert", body);

    if (settings.managerPhone) {
      await sendSMS(settings.managerPhone, `Overstay alert: ${overstayedSessions.length} vehicle(s) past time. Check dashboard.`);
    }

    await audit({
      action: "OVERSTAY_ALERT",
      details: `Manager notified: ${overstayedSessions.length} vehicle(s) overstayed — ${settings.managerEmail}`,
    });
  }

  return NextResponse.json({
    remindersSent: sessionsNeedingReminder.length,
    overstayAlerts: overstayedSessions.length,
  });
}
