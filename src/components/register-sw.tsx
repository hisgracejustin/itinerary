"use client";

import { useEffect } from "react";

/** Registers the PWA service worker (public/sw.js) after mount. */
export function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;

    // First-ever install (every iOS home-screen add is one): pages loaded
    // before the worker existed are claimed, but WebKit doesn't reliably
    // route their fetches — or even subsequent navigations — through the
    // worker until the next document load. Reload once when the first worker
    // takes control, so offline caching works in the very first session
    // instead of silently starting from the second.
    if (!sw.controller) {
      const onControl = () => {
        try {
          if (window.sessionStorage.getItem("sw-claim-reload")) return;
          window.sessionStorage.setItem("sw-claim-reload", "1");
        } catch {
          /* no sessionStorage — reload anyway; controller now exists, so the
             listener can't re-fire into a loop within this page */
        }
        window.location.reload();
      };
      sw.addEventListener("controllerchange", onControl, { once: true });
    }

    sw.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
