# Trip-summary PDF assets

Read from disk by `src/lib/trip-summary-pdf.tsx` when the server renders the
trip-summary PDF (`/api/trips/[tripId]/summary`; `next.config.ts` ships this
folder with that route).

- `fonts/Inter-*.otf`: Inter 4, SIL Open Font License 1.1 (`fonts/OFL-Inter.txt`).
- `fonts/NotoSansTC-Regular.ttf`: Noto Sans TC, the fallback for Chinese and
  Japanese names, SIL Open Font License 1.1 (`fonts/OFL-NotoSansTC.txt`).
- `emoji/*.png`: the category icons, drawn from Noto Color Emoji (SIL Open Font
  License 1.1). The PDF fonts can't draw emoji, so the app's category emoji are
  images here.
