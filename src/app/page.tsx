"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";

export default function Home() {
  const [scanUrl, setScanUrl] = useState("");
  useEffect(() => {
    setScanUrl(`${window.location.origin}/scan`);
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#1C1C1E",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 40,
        padding: "40px 20px",
        fontFamily: "var(--font-body)",
      }}
    >
      {/* Logo / title */}
      <div style={{ textAlign: "center" }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#F5F5F7",
            fontFamily: "var(--font-display)",
            margin: 0,
          }}
        >
          Parking System
        </h1>
        <p style={{ color: "#636366", fontSize: 13, marginTop: 6 }}>
          Sistema de Gestión de Estacionamiento
        </p>
      </div>

      {/* QR Code */}
      {scanUrl && (
        <div style={{
          background: "#2C2C2E",
          border: "1px solid #3A3A3C",
          borderRadius: 16,
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          width: "100%",
          maxWidth: 360,
        }}>
          <div style={{
            background: "#fff",
            padding: 12,
            borderRadius: 10,
            lineHeight: 0,
          }}>
            <QRCodeSVG value={scanUrl} size={140} />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#F5F5F7", fontFamily: "var(--font-display)", letterSpacing: "0.04em" }}>
              Gate QR Code
            </div>
            <div style={{ fontSize: 11, color: "#636366", marginTop: 4, fontFamily: "monospace", letterSpacing: "0.02em" }}>
              {scanUrl}
            </div>
          </div>
        </div>
      )}

      {/* Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 360 }}>

        {/* Scan / gate */}
        <Link href="/scan" style={{ textDecoration: "none" }}>
          <div
            style={{
              background: "linear-gradient(135deg, #0D2B1A 0%, #061508 100%)",
              border: "1px solid #30D15840",
              borderRadius: 16,
              padding: "20px 24px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 14,
              transition: "transform 0.15s, box-shadow 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.transform = "scale(1.02)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 32px rgba(48,209,88,0.2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = "scale(1)";
              (e.currentTarget as HTMLElement).style.boxShadow = "none";
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "#30D158", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
              🔓
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#F5F5F7", fontFamily: "var(--font-display)", letterSpacing: "0.02em" }}>
                Gate Access
              </div>
              <div style={{ fontSize: 12, color: "#30D158", fontWeight: 600, marginTop: 2 }}>
                Scan QR · open gate
              </div>
            </div>
          </div>
        </Link>

        {/* Demo check-in — primary CTA */}
        <Link href="/checkin?demo=1" style={{ textDecoration: "none" }}>
          <div
            style={{
              background: "linear-gradient(135deg, #0A2A50 0%, #061830 100%)",
              border: "1px solid #0A84FF44",
              borderRadius: 16,
              padding: "24px 24px",
              cursor: "pointer",
              transition: "transform 0.15s, box-shadow 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.transform = "scale(1.02)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 32px rgba(10, 132, 255, 0.25)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = "scale(1)";
              (e.currentTarget as HTMLElement).style.boxShadow = "none";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "#0A84FF",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                  flexShrink: 0,
                }}
              >
                🚛
              </div>
              <div>
                <div
                  style={{
                    fontSize: 17,
                    fontWeight: 700,
                    color: "#F5F5F7",
                    fontFamily: "var(--font-display)",
                    letterSpacing: "0.02em",
                  }}
                >
                  Driver Demo
                </div>
                <div style={{ fontSize: 12, color: "#0A84FF", fontWeight: 600, marginTop: 2 }}>
                  No payment · Spot assigned instantly
                </div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: "#8E8E93", margin: 0, lineHeight: 1.5 }}>
              Fill out the check-in form, get randomly assigned a spot, and see navigation on the live lot map.
            </p>
          </div>
        </Link>

        {/* Lot map */}
        <Link href="/lot" style={{ textDecoration: "none" }}>
          <div
            style={{
              background: "#2C2C2E",
              border: "1px solid #3A3A3C",
              borderRadius: 12,
              padding: "18px 20px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 14,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#3A3A3C")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "#2C2C2E")}
          >
            <span style={{ fontSize: 24 }}>🗺️</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#F5F5F7", fontFamily: "var(--font-display)" }}>
                Lot Map
              </div>
              <div style={{ fontSize: 12, color: "#636366", marginTop: 2 }}>
                View & edit parking lot layout
              </div>
            </div>
          </div>
        </Link>

        {/* Real check-in */}
        <Link href="/checkin" style={{ textDecoration: "none" }}>
          <div
            style={{
              background: "#2C2C2E",
              border: "1px solid #3A3A3C",
              borderRadius: 12,
              padding: "18px 20px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 14,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#3A3A3C")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "#2C2C2E")}
          >
            <span style={{ fontSize: 24 }}>📋</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#F5F5F7", fontFamily: "var(--font-display)" }}>
                Check In
              </div>
              <div style={{ fontSize: 12, color: "#636366", marginTop: 2 }}>
                Full flow with payment
              </div>
            </div>
          </div>
        </Link>

        {/* Admin */}
        <Link href="/admin" style={{ textDecoration: "none" }}>
          <div
            style={{
              background: "#2C2C2E",
              border: "1px solid #3A3A3C",
              borderRadius: 12,
              padding: "18px 20px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 14,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#3A3A3C")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "#2C2C2E")}
          >
            <span style={{ fontSize: 24 }}>⚙️</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#F5F5F7", fontFamily: "var(--font-display)" }}>
                Admin
              </div>
              <div style={{ fontSize: 12, color: "#636366", marginTop: 2 }}>
                Dashboard & session history
              </div>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
