"use client";

import { useState, useEffect } from "react";

const MOBILE_BREAKPOINT = 640;

/**
 * Returns true when the viewport is narrower than 640px.
 * Updates on resize. SSR-safe (defaults to false).
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return isMobile;
}
