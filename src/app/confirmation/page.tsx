"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type SessionData = {
  id: string;
  startedAt: string;
  expectedEnd: string;
  spot: { label: string; type: string };
  driver: { name: string };
  vehicle: { licensePlate: string; type: string; nickname: string | null };
  payments: { amount: number; type: string }[];
};

export default function ConfirmationPage() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <ConfirmationContent />
    </Suspense>
  );
}

function ConfirmationContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId");
  const gateOpened = searchParams.get("gateOpened");

  const [session, setSession] = useState<SessionData | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const driverId = localStorage.getItem("driverId");
    if (!driverId) return;

    fetch(`/api/sessions?driverId=${driverId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.session) setSession(d.session);
      });
  }, [sessionId]);

  if (!session) {
    return <p>Loading confirmation...</p>;
  }

  const expectedEnd = new Date(session.expectedEnd);
  const totalPaid = session.payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div>
      <h1>{gateOpened ? "Gate Opening" : "Checked In"}</h1>

      <div>
        <p><strong>Spot:</strong> {session.spot.label}</p>
        <p><strong>Vehicle:</strong> {session.vehicle.licensePlate} ({session.vehicle.type === "BOBTAIL" ? "Bobtail" : "Truck / Trailer"}){session.vehicle.nickname ? ` — ${session.vehicle.nickname}` : ""}</p>
        <p><strong>Paid:</strong> ${totalPaid.toFixed(2)}</p>
        <p><strong>Expires:</strong> {expectedEnd.toLocaleString()}</p>
      </div>

      {gateOpened && (
        <p>The gate is opening. Please proceed to spot {session.spot.label}.</p>
      )}
    </div>
  );
}
