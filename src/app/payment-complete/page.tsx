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
  const [status, setStatus] = useState<"checking" | "creating" | "done" | "voided" | "partial" | "error">("checking");
  const [error, setError] = useState("");
  const pollCount = useRef(0);
  const maxPolls = 30; // 30 x 2s = 60 seconds max wait

  useEffect(() => {
    const raw = sessionStorage.getItem("pending_session");
    if (!raw) {
      setError("No pending session found. Please check in again.");
      setStatus("error");
      return;
    }

    let pending: PendingSession;
    try {
      pending = JSON.parse(raw);
    } catch {
      setError("Invalid session data. Please check in again.");
      setStatus("error");
      return;
    }

    if (!pending.invoiceId) {
      setError("No invoice ID found. Please check in again.");
      setStatus("error");
      return;
    }

    // Poll for payment completion
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
        }>(
          `/api/payments/status?invoiceId=${pending.invoiceId}`,
        );

        // Invoice was voided/cancelled in QB — stop polling, show error
        if (data.voided) {
          sessionStorage.removeItem("pending_session");
          setError("This payment was cancelled. Please check in again to start a new session.");
          setStatus("voided");
          return;
        }

        // Partial payment — stop polling, show warning
        if (data.partial) {
          setError(`Partial payment received ($${data.amountPaid.toFixed(2)} of $${data.totalAmount.toFixed(2)}). Please contact the manager to complete your payment.`);
          setStatus("partial");
          return;
        }

        if (data.paid) {
          // Payment confirmed — create the session
          setStatus("creating");

          const sessionRes = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              driverId: pending.driverId,
              vehicleId: pending.vehicleId,
              durationType: pending.durationType,
              ...(pending.durationType === "HOURLY" ? { hours: pending.hours } : { months: pending.months }),
              paymentId: pending.invoiceId, // store invoice ID as payment reference
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

          // Clean up and redirect
          sessionStorage.removeItem("pending_session");
          setStatus("done");
          router.push(`/confirmation?sessionId=${sessionData.session.id}`);
          return;
        }

        // Not paid yet — keep polling (up to max)
        if (pollCount.current < maxPolls) {
          setTimeout(poll, 2000);
        } else {
          setError("Payment verification timed out. If you completed payment, please contact the manager.");
          setStatus("error");
        }
      } catch {
        setError("Could not verify payment. Please contact the manager.");
        setStatus("error");
      }
    };

    // Start polling after a short delay (give QB time to process)
    setTimeout(poll, 1500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              Confirming your payment with QuickBooks. This usually takes a few seconds.
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
