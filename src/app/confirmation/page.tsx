"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import type { ApiSession, ApiSpot, ApiVehicle, ApiPayment } from "@/types/domain";
import { loadDriver } from "@/lib/driver-store";
import { apiFetch } from "@/lib/fetch";

type SessionData = Pick<ApiSession, "id" | "startedAt" | "expectedEnd"> & {
  spot: Pick<ApiSpot, "label" | "type">;
  driver: { name: string };
  vehicle: Pick<ApiVehicle, "licensePlate" | "type" | "nickname">;
  payments: Pick<ApiPayment, "amount" | "type">[];
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
  const [error, setError] = useState("");
  const [driverId, setDriverId] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError("No session ID provided.");
      return;
    }

    const saved = loadDriver();
    if (!saved) {
      setError("Driver identity not found. Please check in again.");
      return;
    }
    setDriverId(saved.id);

    apiFetch<{ session: SessionData | null }>(`/api/sessions?driverId=${saved.id}`)
      .then((d) => {
        if (d.session) {
          setSession(d.session);
        } else {
          setError("Session not found.");
        }
      })
      .catch(() => {
        setError("Could not load session details.");
      });
  }, [sessionId]);

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <h1>Something went wrong</h1>
        <p style={{ color: "var(--error)", marginTop: 12 }}>{error}</p>
        <div style={{ marginTop: 24, display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={() => { setError(""); window.location.reload(); }}
            style={{ padding: "10px 20px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
          >
            Retry
          </button>
          <Link
            href="/scan"
            style={{ padding: "10px 20px", background: "var(--input-bg)", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 8, textDecoration: "none" }}
          >
            Back to start
          </Link>
        </div>
      </div>
    );
  }

  if (!session) {
    return <p style={{ padding: 40, textAlign: "center" }}>Loading confirmation...</p>;
  }

  const expectedEnd = new Date(session.expectedEnd);
  const totalPaid = session.payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div style={{ padding: 40, maxWidth: 480, margin: "0 auto" }}>
      <h1>{gateOpened ? "Gate Opening" : "Checked In"}</h1>

      <div style={{ marginTop: 16 }}>
        <p><strong>Spot:</strong> {session.spot.label}</p>
        <p><strong>Vehicle:</strong> {session.vehicle.licensePlate} ({session.vehicle.type === "BOBTAIL" ? "Bobtail" : "Truck / Trailer"}){session.vehicle.nickname ? ` — ${session.vehicle.nickname}` : ""}</p>
        <p><strong>Paid:</strong> ${totalPaid.toFixed(2)}</p>
        <p><strong>Expires:</strong> {expectedEnd.toLocaleString()}</p>
      </div>

      {gateOpened && (
        <p style={{ marginTop: 16 }}>The gate is opening. Please proceed to spot {session.spot.label}.</p>
      )}

      {/* Flow continuation — link to session hub */}
      {driverId && (
        <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 10 }}>
          <Link
            href={`/welcome?driverId=${driverId}`}
            style={{
              display: "block",
              padding: "14px 20px",
              background: "var(--accent)",
              color: "#fff",
              borderRadius: 10,
              textAlign: "center",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            View your sessions
          </Link>
          <Link
            href="/scan"
            style={{
              display: "block",
              padding: "12px 20px",
              textAlign: "center",
              color: "var(--fg-muted)",
              textDecoration: "underline",
              fontSize: 14,
            }}
          >
            Return to start
          </Link>
        </div>
      )}
    </div>
  );
}
