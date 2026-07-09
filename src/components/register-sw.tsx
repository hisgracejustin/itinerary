"use client";

import { useEffect } from "react";

/** Registers the PWA service worker (public/sw.js) after mount. */
export function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
