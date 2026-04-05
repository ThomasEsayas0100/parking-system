"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LotEditorRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/lot");
  }, [router]);
  return null;
}
