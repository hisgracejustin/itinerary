# iPhone Safe Area Implementation Guide

Follow these steps exactly to ensure your web app renders correctly on iPhones (notch, Dynamic Island, home indicator) without content being cut off or extra dead space.

## 1. Viewport Meta Tag

In your `index.html` `<head>`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

- `viewport-fit=cover` is **critical** — it tells the browser to extend your page behind the notch and home indicator instead of auto-shrinking it.
- `black-translucent` makes the status bar area transparent so your app background shows through.

## 2. Use Dynamic Viewport Height

On your root/outermost layout container, use `100dvh` (dynamic viewport height), NOT `100vh`:

```css
min-height: 100dvh;
```

Why: `100vh` on iOS Safari includes the area behind the address bar, causing overflow. `100dvh` adjusts dynamically as the browser chrome appears/disappears.

## 3. Top Safe Area (avoid notch/Dynamic Island)

Apply `env(safe-area-inset-top)` as padding-top on your outermost layout wrapper:

```css
padding-top: env(safe-area-inset-top);
```

This pushes your app bar/content below the status bar and notch. Do NOT put this on `<body>` or `<html>` — put it on your app's root layout component.

## 4. Bottom Safe Area (avoid home indicator)

On any fixed-bottom element (tab bar, bottom nav, bottom sheet), use:

```css
padding-bottom: max(env(safe-area-inset-bottom), 8px);
```

Key points:
- Use `max()` to ensure a minimum padding (8px) on devices without a home indicator so it never looks cramped.
- Apply this to the **fixed-position bottom element itself**, not to the page body.
- If you have a FAB or other element above the bottom nav, position it relative to the nav height + safe area (e.g., `bottom: 76px`).

## 5. HTML/Body Reset

```css
html, body, #root {
  height: 100%;
  margin: 0;
  overscroll-behavior-y: contain;
}
```

`overscroll-behavior-y: contain` prevents the rubber-band bounce effect from revealing a gap behind your app.

## Common Mistakes to Avoid

1. **Forgetting `viewport-fit=cover`** — without it, `env(safe-area-inset-*)` values will always be `0`.
2. **Using `100vh` instead of `100dvh`** — causes extra space or scrolling on iOS Safari.
3. **Using fixed pixel padding instead of `env()`** — breaks on different devices with different inset sizes.
4. **Applying safe area padding to `<body>`** — apply it to your app layout component so it participates in your flexbox/grid layout correctly.
5. **Using `env(safe-area-inset-bottom)` alone without `max()`** — on devices without a home indicator the value is `0`, leaving no padding at all.
6. **Forgetting to set `height: auto`** on the bottom nav — let it size to content + padding rather than a fixed height, so the safe area padding actually adds space.

## Summary Structure

```
┌─────────────────────────────┐
│ env(safe-area-inset-top)    │ ← padding-top on root container
├─────────────────────────────┤
│ App Bar                     │
├─────────────────────────────┤
│ Content (flex: 1, scroll)   │
├─────────────────────────────┤
│ Bottom Nav (fixed)          │
│ pb: max(env(...bottom), 8px)│
└─────────────────────────────┘
```

Root container: `display: flex; flex-direction: column; min-height: 100dvh; padding-top: env(safe-area-inset-top);`

---

These instructions are framework-agnostic. The CSS environment variables work in any modern CSS — whether you're using MUI `sx` props, Tailwind, styled-components, or plain CSS.
