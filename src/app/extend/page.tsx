"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionId) return;

    const driverId = localStorage.getItem("driverId");
    if (!driverId) return;

    Promise.all([
      fetch(`/api/sessions?driverId=${driverId}`).then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]).then(([sessionData, settingsData]) => {
      if (sessionData.session) {
        setCurrentEnd(new Date(sessionData.session.expectedEnd));
        const rate =
          sessionData.session.vehicleType === "BOBTAIL"
            ? settingsData.settings.hourlyRateBobtail
            : settingsData.settings.hourlyRateTruck;
        setHourlyRate(rate);
      }
      setLoading(false);
    });
  }, [sessionId]);

  const totalAmount = hourlyRate * hours;
  const newEnd = currentEnd
    ? new Date(currentEnd.getTime() + hours * 60 * 60 * 1000)
    : null;

  async function handleExtend(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId) return;
    setSubmitting(true);
    setError("");

    try {
      // Create payment
      const payRes = await fetch("/api/payments/create-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: totalAmount,
          description: `Parking extension: ${hours}h`,
        }),
      });
      const { paymentIntentId } = await payRes.json();

      // Extend session
      const extendRes = await fetch("/api/sessions/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, hours, paymentId: paymentIntentId }),
      });
      const extendData = await extendRes.json();

      if (extendRes.ok) {
        router.replace(`/confirmation?sessionId=${sessionId}`);
      } else {
        setError(extendData.error || "Failed to extend.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p>Loading session info...</p>;
  }

  if (!currentEnd) {
    return <p>No active session found.</p>;
  }

  return (
    <div>
      <h1>Extend Parking</h1>

      <div>
        <p><strong>Current expiry:</strong> {currentEnd.toLocaleString()}</p>
        {newEnd && <p><strong>New expiry:</strong> {newEnd.toLocaleString()}</p>}
      </div>

      <form onSubmit={handleExtend}>
        <div>
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

        <p>Rate: ${hourlyRate}/hr &bull; Total: ${totalAmount.toFixed(2)}</p>

        {error && <p style={{ color: "red" }}>{error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Processing..." : `Pay $${totalAmount.toFixed(2)} & Extend`}
        </button>
      </form>
    </div>
  );
}
