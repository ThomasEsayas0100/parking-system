"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("next") || "/admin";

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || "Login failed");
      }
      router.replace(redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1C1C1E",
        fontFamily: "var(--font-body)",
        padding: 20,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "#2C2C2E",
          border: "1px solid #3A3A3C",
          borderRadius: 8,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 600,
              color: "#F5F5F7",
              letterSpacing: "-0.01em",
            }}
          >
            Manager Sign In
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#98989D" }}>
            Enter the admin password to continue.
          </p>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: "#98989D" }}>
            Password
          </span>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              padding: "8px 10px",
              fontSize: 13,
              fontFamily: "var(--font-body)",
              background: "#1C1C1E",
              border: "1px solid #3A3A3C",
              borderRadius: 6,
              color: "#F5F5F7",
              outline: "none",
            }}
          />
        </label>

        {error && (
          <div
            style={{
              fontSize: 11,
              color: "#DC2626",
              padding: "6px 10px",
              background: "#2C1810",
              border: "1px solid #DC2626",
              borderRadius: 4,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          style={{
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            borderRadius: 6,
            background: loading || !password ? "#3A3A3C" : "#0A84FF",
            color: "#fff",
            cursor: loading || !password ? "not-allowed" : "pointer",
            fontFamily: "var(--font-body)",
          }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
