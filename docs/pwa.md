# PWA & iOS safe areas

The app is an installable PWA and renders edge-to-edge on iPhones (notch, Dynamic
Island, home indicator). This covers how that's wired under Next.js and the
safe-area rules.

## PWA wiring (Next.js)

- **Manifest** — [`src/app/manifest.ts`](../src/app/manifest.ts) returns a
  `MetadataRoute.Manifest`; Next serves it at `/manifest.webmanifest` and injects
  the `<link rel="manifest">` automatically. Name, `theme_color` `#1a73e8`,
  `display: standalone`, icon `/icon.png`.
- **Viewport / meta** — set via `metadata` + `viewport` exports in
  [`src/app/layout.tsx`](../src/app/layout.tsx) (there is no `index.html`):
  `themeColor`, `viewportFit: "cover"`, `maximumScale: 1`, apple-web-app meta.
- **Service worker** — [`public/sw.js`](../public/sw.js), registered by the client
  [`RegisterSW`](../src/components/register-sw.tsx) mounted in the root layout.
  Strategy: cache-first for immutable static assets (`/_next/static`, icon,
  manifest), **network-first** for navigations, `/api/*`, and the pdf.js worker.
  Bump `CACHE_NAME` to invalidate old caches. The sidebar's "check for updates"
  button unregisters the SW and clears caches.

## iOS safe areas

`viewport-fit=cover` (set in the layout `viewport` export) is what makes
`env(safe-area-inset-*)` non-zero — without it they're always `0`.

- **Dynamic height** — use `100dvh` (dynamic viewport height), not `100vh`, so the
  layout tracks iOS Safari's collapsing chrome. The app shell uses `fixed inset-0`.
- **Top inset (notch / Dynamic Island)** — apply `padding-top:
  env(safe-area-inset-top)` on the app layout container (the sidebar/shell in
  [`AppShell`](../src/components/AppShell.tsx) / `Sidebar`), **not** on `<body>`.
- **Bottom inset (home indicator)** — on fixed-bottom elements use
  `padding-bottom: max(env(safe-area-inset-bottom), 8px)` so devices without a home
  indicator still get a minimum.
- **Body reset** — `globals.css` sets `html, body { height: 100%; margin: 0;
  overscroll-behavior-y: none; }` to prevent rubber-band bounce revealing a gap.

## Common mistakes

1. Forgetting `viewport-fit=cover` → all insets are `0`.
2. Using `100vh` instead of `100dvh` → overflow/extra space on iOS Safari.
3. Fixed-pixel padding instead of `env()` → wrong on different devices.
4. Putting safe-area padding on `<body>` instead of the app layout component.
5. `env(safe-area-inset-bottom)` without `max()` → no padding on non-notch devices.

These CSS rules are framework-agnostic; only the manifest/viewport/service-worker
wiring above is Next-specific.
