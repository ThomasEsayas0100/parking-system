import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { sendSMS, sendEmail } from "@/lib/notifications";
import { log as audit } from "@/lib/audit";
import { ceilHours } from "@/lib/rates";
import { getSessionSpotLabel } from "@/lib/sessions";

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
    // No sessionId in URL — /extend reads the driver's active session from localStorage.
    // Keeps the session token out of SMS/carrier logs.
    const extendUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/extend`;

    const spotLabel = getSessionSpotLabel(session);
    const message = `Your parking at spot ${spotLabel} expires at ${expiresAt}. Extend your time: ${extendUrl}`;

    await sendSMS(session.driver.phone, message);
    if (session.driver.email) {
      await sendEmail(session.driver.email, "Parking Expiry Reminder", message);
    }

    await prisma.session.update({
      where: { id: session.id },
      data: { reminderSent: true },
    });

    await audit({
      action: "REMINDER_SENT",
      sessionId: session.id,
      driverId: session.driverId,
      spotId: session.spotId,
      details: `Expiry reminder sent to ${session.driver.name} (${session.driver.phone}) — spot ${spotLabel}`,
    });
  }

  // 2. Flip ACTIVE → OVERSTAY for sessions past the grace period
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
          details: `Overstay began at spot ${getSessionSpotLabel(s)} — ${s.driver.name} (${s.driver.phone})`,
        })
      )
    );
  }

  // 3. Notify manager — only for sessions whose alert has NOT been sent yet.
  // This prevents duplicate alerts when the cron runs multiple times before
  // a driver exits.
  const unalertedOverstays = await prisma.session.findMany({
    where: {
      status: "OVERSTAY",
      overstayAlertSent: false,
    },
    include: { driver: true, spot: true },
  });

  if (unalertedOverstays.length > 0 && settings.managerEmail) {
    const lines = unalertedOverstays.map((s) => {
      const overHours = ceilHours(new Date(s.expectedEnd), now);
      return `- Spot ${getSessionSpotLabel(s)}: ${s.driver.name} (${s.driver.phone}) — ${overHours}h overstay`;
    });

    const body = `The following vehicles have overstayed:\n\n${lines.join("\n")}`;

    await sendEmail(settings.managerEmail, "Overstay Alert", body);

    if (settings.managerPhone) {
      await sendSMS(settings.managerPhone, `Overstay alert: ${unalertedOverstays.length} vehicle(s) past time. Check dashboard.`);
    }

    // Mark alerts as sent so we don't re-notify on next cron run
    await prisma.session.updateMany({
      where: { id: { in: unalertedOverstays.map((s) => s.id) } },
      data: { overstayAlertSent: true },
    });

    await audit({
      action: "OVERSTAY_ALERT",
      details: `Manager notified: ${unalertedOverstays.length} vehicle(s) overstayed — ${settings.managerEmail}`,
    });
  }

  return NextResponse.json({
    remindersSent: sessionsNeedingReminder.length,
    overstayAlerts: unalertedOverstays.length,
  });
}
