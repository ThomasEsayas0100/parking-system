"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

type OverstayInfo = {
  overstayHours: number;
  overstayAmount: number;
  overstayRate: number;
  sessionId: string;
};

export default function ExitPage() {
  return (
    <Suspense fallback={<p>Processing...</p>}>
      <ExitContent />
    </Suspense>
  );
}

function ExitContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get("sessionId");

  const [overstayInfo, setOverstayInfo] = useState<OverstayInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionId) return;

    // Try to exit — if overstayed, API returns payment info
    fetch("/api/sessions/exit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          // No overstay — gate opened, session ended
          router.replace(`/confirmation?sessionId=${sessionId}&gateOpened=true`);
        } else if (data.requiresPayment) {
          setOverstayInfo(data);
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to process exit.");
        setLoading(false);
      });
  }, [sessionId, router]);

  async function handlePayOverstay() {
    if (!overstayInfo) return;
    setPaying(true);
    setError("");

    try {
      // Create payment intent for overstay
      const payRes = await fetch("/api/payments/create-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: overstayInfo.overstayAmount,
          description: `Overstay charge: ${overstayInfo.overstayHours}h`,
        }),
      });
      const { paymentIntentId } = await payRes.json();

      // TODO: In production, confirm payment with Stripe Elements
      // For MVP, proceed with payment intent as proof

      // Complete exit with overstay payment
      const exitRes = await fetch("/api/sessions/exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: overstayInfo.sessionId,
          overstayPaymentId: paymentIntentId,
        }),
      });
      const exitData = await exitRes.json();

      if (exitData.success) {
        router.replace(`/confirmation?sessionId=${sessionId}&gateOpened=true`);
      } else {
        setError("Failed to process exit.");
      }
    } catch {
      setError("Payment failed. Please try again.");
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return <p>Processing exit...</p>;
  }

  if (!overstayInfo) {
    return <p>No overstay information found.</p>;
  }

  return (
    <div>
      <h1>Overstay Payment Required</h1>

      <div>
        <p>Your parking time has expired.</p>
        <p><strong>Overstay duration:</strong> {overstayInfo.overstayHours} hour(s)</p>
        <p><strong>Rate:</strong> ${overstayInfo.overstayRate}/hr (premium)</p>
        <p><strong>Amount due:</strong> ${overstayInfo.overstayAmount.toFixed(2)}</p>
      </div>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <button onClick={handlePayOverstay} disabled={paying}>
        {paying ? "Processing..." : `Pay $${overstayInfo.overstayAmount.toFixed(2)} & Exit`}
      </button>
    </div>
  );
}
