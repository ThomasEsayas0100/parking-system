"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/fetch";

/**
 * Payment completion callback page.
 *
 * After the driver pays on QuickBooks' hosted checkout, they return here.
 * This page:
 * 1. Reads the pending session data from sessionStorage
 * 2. Polls the QB invoice to verify payment completed
 * 3. Creates the parking session once payment is confirmed
 * 4. Redirects to the confirmation page
 */

type PendingSession = {
  driverId: string;
  vehicleId: string;
  durationType: "HOURLY" | "MONTHLY";
  hours?: number;
  months?: number;
  invoiceId: string;
  termsVersion: string;
  overstayAuthorized: boolean;
};

export default function PaymentCompletePage() {
  const router = useRouter();
  const [status, setStatus] = useState<"waiting" | "checking" | "creating" | "done" | "voided" | "partial" | "error">("waiting");
  const [error, setError] = useState("");
  const pendingRef = useRef<PendingSession | null>(null);
  const pollCount = useRef(0);
  const maxPolls = 20; // 20 x 2s = 40 seconds

  useEffect(() => {
    const raw = sessionStorage.getItem("pending_session");
    if (!raw) {
      setError("No pending session found. Please check in again.");
      setStatus("error");
      return;
    }
    try {
      const pending = JSON.parse(raw) as PendingSession;
      if (!pending.invoiceId) throw new Error("missing invoiceId");
      pendingRef.current = pending;
    } catch {
      setError("Invalid session data. Please check in again.");
      setStatus("error");
    }
  }, []);

  const confirmPayment = async () => {
    const pending = pendingRef.current;
    if (!pending) return;

    pollCount.current = 0;
    setStatus("checking");
    setError("");

    const poll = async () => {
      pollCount.current++;
      try {
        const data = await apiFetch<{
          paid: boolean;
          voided: boolean;
          partial: boolean;
          balance: number;
          totalAmount: number;
          amountPaid: number;
        }>(`/api/payments/status?invoiceId=${pending.invoiceId}`);

        if (data.voided) {
          sessionStorage.removeItem("pending_session");
          setError("This payment was cancelled. Please check in again to start a new session.");
          setStatus("voided");
          return;
        }

        if (data.partial) {
          setError(`Partial payment received ($${data.amountPaid.toFixed(2)} of $${data.totalAmount.toFixed(2)}). Please contact the manager.`);
          setStatus("partial");
          return;
        }

        if (data.paid) {
          setStatus("creating");
          const sessionRes = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              driverId: pending.driverId,
              vehicleId: pending.vehicleId,
              durationType: pending.durationType,
              ...(pending.durationType === "HOURLY" ? { hours: pending.hours } : { months: pending.months }),
              paymentId: pending.invoiceId,
              termsVersion: pending.termsVersion,
              overstayAuthorized: pending.overstayAuthorized,
            }),
          });
          const sessionData = await sessionRes.json();
          if (!sessionRes.ok) {
            setError(sessionData.error || "Session creation failed after payment.");
            setStatus("error");
            return;
          }
          sessionStorage.removeItem("pending_session");
          setStatus("done");
          router.push(`/confirmation?sessionId=${sessionData.session.id}`);
          return;
        }

        // Not paid yet — keep polling
        if (pollCount.current < maxPolls) {
          setTimeout(poll, 2000);
        } else {
          setError("Payment not found yet. If you completed payment, tap the button again in a moment.");
          setStatus("waiting");
        }
      } catch {
        setError("Could not verify payment. Please try again or contact the manager.");
        setStatus("waiting");
      }
    };

    setTimeout(poll, 1000);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      fontFamily: "var(--font-body)",
    }}>
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        {status === "waiting" && (
          <>
            <div style={{ fontSize: 48, marginBottom: 24 }}>💳</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-display)", marginBottom: 8 }}>
              Complete your payment
            </h1>
            <p style={{ fontSize: 14, color: "var(--fg-muted)", marginBottom: 24 }}>
              Finish payment on QuickBooks, then return here and tap the button below to confirm your spot.
            </p>
            {error && <p style={{ fontSize: 13, color: "var(--error)", marginBottom: 16 }}>{error}</p>}
            <button
              onClick={confirmPayment}
              style={{ padding: "14px 28px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 16, cursor: "pointer", width: "100%" }}
            >
              I've paid — confirm my spot
            </button>
            <p style={{ fontSize: 12, color: "var(--fg-subtle)", marginTop: 12 }}>
              Tap after completing payment on QuickBooks
            </p>
          </>
        )}

        {status === "checking" && (
          <>
            <div style={{
              width: 48,
              height: 48,
              border: "3px solid var(--border)",
              borderTopColor: "var(--accent)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              margin: "0 auto 24px",
            }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-display)", marginBottom: 8 }}>
              Verifying payment…
            </h1>
            <p style={{ fontSize: 14, color: "var(--fg-muted)" }}>
              Confirming your payment with QuickBooks.
            </p>
          </>
        )}

        {status === "creating" && (
          <>
            <div style={{
              width: 48,
              height: 48,
              border: "3px solid var(--border)",
              borderTopColor: "var(--accent)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              margin: "0 auto 24px",
            }} />
            <h1 style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-display)", marginBottom: 8 }}>
              Assigning your spot…
            </h1>
            <p style={{ fontSize: 14, color: "var(--fg-muted)" }}>
              Payment confirmed! Setting up your parking session now.
            </p>
          </>
        )}

        {status === "voided" && (
          <>
            <div style={{
              width: 48, height: 48, borderRadius: "50%", background: "#FEF2F2",
              border: "2px solid var(--error)", display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 24, color: "var(--error)", margin: "0 auto 24px",
            }}>✕</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-display)", marginBottom: 8 }}>
              Payment cancelled
            </h1>
            <p style={{ fontSize: 14, color: "var(--fg-muted)", marginBottom: 24 }}>{error}</p>
            <Link href="/entry" style={{ padding: "10px 20px", background: "var(--accent)", color: "#fff", borderRadius: 8, textDecoration: "none", fontWeight: 600, fontSize: 14 }}>
              Start over
            </Link>
          </>
        )}

        {status === "partial" && (
          <>
            <div style={{
              width: 48, height: 48, borderRadius: "50%", background: "#FFF7E6",
              border: "2px solid #F59E0B", display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 24, color: "#F59E0B", margin: "0 auto 24px",
            }}>!</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-display)", marginBottom: 8 }}>
              Partial payment
            </h1>
            <p style={{ fontSize: 14, color: "#92400E", marginBottom: 24 }}>{error}</p>
            <Link href="/entry" style={{ padding: "10px 20px", background: "var(--input-bg)", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 8, textDecoration: "none", fontSize: 14 }}>
              Back to start
            </Link>
          </>
        )}

        {status === "error" && (
          <>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "#FEF2F2",
              border: "2px solid var(--error)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              color: "var(--error)",
              margin: "0 auto 24px",
            }}>
              !
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-display)", marginBottom: 8 }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: 14, color: "var(--error)", marginBottom: 24 }}>
              {error}
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <Link
                href="/checkin"
                style={{
                  padding: "10px 20px",
                  background: "var(--accent)",
                  color: "#fff",
                  borderRadius: 8,
                  textDecoration: "none",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                Try again
              </Link>
              <Link
                href="/entry"
                style={{
                  padding: "10px 20px",
                  background: "var(--input-bg)",
                  color: "var(--fg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  textDecoration: "none",
                  fontSize: 14,
                }}
              >
                Back to start
              </Link>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
