"use client";

import { useEffect } from "react";
import { syncTextSize } from "@/lib/text-size";

/** Re-applies the saved text size after hydration (see syncTextSize). */
export function TextSizeSync() {
  useEffect(() => {
    syncTextSize();
  }, []);
  return null;
}
