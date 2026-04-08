"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

import { loadDriver } from "@/lib/driver-store";
import { apiFetch, apiPost } from "@/lib/fetch";

export default function ExtendPage() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <ExtendContent />
    </Suspense>
  );
}

function ExtendContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get("sessionId");

  const [hours, setHours] = useState(1);
  const [hourlyRate, setHourlyRate] = useState(0);
  const [currentEnd, setCurrentEnd] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionId) {
      setLoadError("No session ID provided.");
      setLoading(false);
      return;
    }

    const saved = loadDriver();
    if (!saved) {
      setLoadError("Driver identity not found. Please check in again.");
      setLoading(false);
      return;
    }

    Promise.all([
      apiFetch<{ session: { id: string; status: string; expectedEnd: string; vehicle?: { type: string } } | null }>(
        `/api/sessions?driverId=${saved.id}`
      ),
      apiFetch<{ settings: { hourlyRateBobtail: number; hourlyRateTruck: number } }>(
        "/api/settings"
      ),
    ])
      .then(([sessionData, settingsData]) => {
        if (sessionData.session) {
          // Can't extend an overstay session — redirect to exit/payment flow
          if (sessionData.session.status === "OVERSTAY") {
            router.replace(`/exit?sessionId=${sessionData.session.id}`);
            return;
          }
          setCurrentEnd(new Date(sessionData.session.expectedEnd));
          const rate =
            sessionData.session.vehicle?.type === "BOBTAIL"
              ? settingsData.settings.hourlyRateBobtail
              : settingsData.settings.hourlyRateTruck;
          setHourlyRate(rate);
        } else {
          setLoadError("No active session found.");
        }
        setLoading(false);
      })
      .catch(() => {
        setLoadError("Could not load session details. Please try again.");
        setLoading(false);
      });
  }, [sessionId, router]);

  const totalAmount = hourlyRate * hours;
  const newEnd = currentEnd
    ? new Date(currentEnd.getTime() + hours * 60 * 60 * 1000)
    : null;

  async function handleExtend(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId || submitting) return;
    setSubmitting(true);
    setError("");

    try {
      // Create payment
      const payData = await apiPost<{ paymentIntentId: string }>(
        "/api/payments/create-intent",
        { amount: totalAmount, description: `Parking extension: ${hours}h` }
      );

      // Extend session
      await apiPost(
        "/api/sessions/extend",
        { sessionId, hours, paymentId: payData.paymentIntentId }
      );

      router.replace(`/confirmation?sessionId=${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p style={{ padding: 40, textAlign: "center" }}>Loading session info...</p>;
  }

  if (loadError) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p style={{ color: "var(--error)" }}>{loadError}</p>
        <div style={{ marginTop: 20, display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={() => window.location.reload()}
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

  if (!currentEnd) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p>No active session found.</p>
        <Link href="/scan" style={{ color: "var(--accent)", marginTop: 16, display: "inline-block" }}>
          Back to start
        </Link>
      </div>
    );
  }

  return (
    <div style={{ padding: 40, maxWidth: 480, margin: "0 auto" }}>
      <h1>Extend Parking</h1>

      <div style={{ marginTop: 16 }}>
        <p><strong>Current expiry:</strong> {currentEnd.toLocaleString()}</p>
        {newEnd && <p><strong>New expiry:</strong> {newEnd.toLocaleString()}</p>}
      </div>

      <form onSubmit={handleExtend}>
        <div style={{ marginTop: 16 }}>
          <label htmlFor="hours">Additional Hours</label>
          <input
            id="hours"
            type="number"
            min={1}
            max={72}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            required
          />
        </div>

        <p style={{ marginTop: 8 }}>Rate: ${hourlyRate}/hr &bull; Total: ${totalAmount.toFixed(2)}</p>

        {error && <p style={{ color: "var(--error)", marginTop: 8 }}>{error}</p>}

        <button type="submit" disabled={submitting} style={{ marginTop: 16 }}>
          {submitting ? "Processing..." : `Pay $${totalAmount.toFixed(2)} & Extend`}
        </button>
      </form>
    </div>
  );
}
