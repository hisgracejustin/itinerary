// Lays out a TripSummary (./trip-summary) as the shareable trip-summary PDF.
// Server-only: fonts and icons are read from src/assets/pdf (traced into the
// route's bundle by next.config's outputFileTracingIncludes).
import path from "node:path";
import React from "react";
// react-pdf's Image takes no alt text; the alias keeps the HTML <img> alt-text
// lint rule from mistaking it for one.
import { Document, Font, Image as PdfImage, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { CURRENCIES, formatCurrency } from "./currencies";
import type { Money, SummaryPerson, TripSummary } from "./trip-summary";

const ASSETS = path.join(process.cwd(), "src/assets/pdf");
const INTER: Record<number, string> = { 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold" };
// Inter draws Latin, Greek and Cyrillic; Noto Sans TC takes over for Chinese and
// Japanese, one weight standing in for all four.
Font.register({
  family: "Inter",
  fonts: Object.entries(INTER).map(([w, name]) => ({ src: path.join(ASSETS, `fonts/Inter-${name}.otf`), fontWeight: Number(w) })),
});
Font.register({
  family: "NotoSansTC",
  fonts: Object.keys(INTER).map((w) => ({ src: path.join(ASSETS, "fonts/NotoSansTC-Regular.ttf"), fontWeight: Number(w) })),
});
// Names and places aren't split with hyphens. Only a run of letters too long
// for any column (over 16) gets break points, every 10 letters, so it wraps
// instead of running into the next column. Never right after the word's own
// hyphen: react-pdf adds one at every break, which would double it. Chinese,
// Japanese and Korean wrap without hyphens, so they're left alone.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
export function breakPoints(word: string): string[] {
  if (word.length <= 16 || CJK.test(word)) return [word];
  const parts: string[] = [];
  for (const segment of word.split(/(?<=-)/)) {
    for (const chunk of segment.length <= 16 ? [segment] : (segment.match(/.{1,10}/gu) ?? [segment])) {
      if (parts.length && parts[parts.length - 1].endsWith("-")) parts[parts.length - 1] += chunk;
      else parts.push(chunk);
    }
  }
  return parts;
}
Font.registerHyphenationCallback(breakPoints);

const icon = (name: string) => path.join(ASSETS, `emoji/${name}.png`);

const C = {
  primary: "#33ab9f",
  primaryDark: "#237a70",
  primaryLight: "#e6f6f4",
  ink: "#202124",
  muted: "#5f6368",
  soft: "#80868b",
  line: "#e8eaed",
  bg: "#f8f9fa",
  pos: "#137333",
  posBg: "#e6f4ea",
  neg: "#c5221f",
  negBg: "#fce8e6",
};
// One distinct colour per person where colour is the only key (the upfront
// bar); avatars keep the app's own colours, which can repeat.
const SERIES = ["#33ab9f", "#7b61ff", "#f29900", "#e8453c", "#1a73e8", "#e52592", "#12b5cb", "#5f6368"];
const rgba = (hex: string, a: number) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// Large print: no text under 12pt, body 13pt. The PDF is mostly read on phones,
// often by older relatives, so everything is one column and flows from page to
// page rather than packing cards side by side.
const F = { min: 12, body: 13, amount: 14, lead: 16, stat: 20, h1: 22, title: 30 };
const MARGIN = 30;
// The page's content width: A4 less the side margins.
const CONTENT = 595.28 - 2 * MARGIN;
// Avatars are drawn big enough for their initials to be 12pt too.
const AVATAR = 28;

// ---- Formatting ------------------------------------------------------------
const money = (m: Money) => `${m.amount < 0 ? "−" : ""}${formatCurrency(Math.abs(m.amount), m.currency)}`;
const plain = (m: Money) =>
  Math.abs(m.amount).toLocaleString("en-US", {
    minimumFractionDigits: ["JPY", "KRW", "TWD"].includes(m.currency) ? 0 : 2,
    maximumFractionDigits: ["JPY", "KRW", "TWD"].includes(m.currency) ? 0 : 2,
  });
const symbol = (currency: string) => CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency;
const rateText = (rate: number) => String(Number(rate.toPrecision(5)));
const day = (iso: string, opts: Intl.DateTimeFormatOptions) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
};
const shortDate = (iso: string | null) => (iso ? day(iso, { weekday: "short", day: "numeric", month: "short" }) : "");
function dateRange(start: string | null, end: string | null) {
  if (!start || !end) return start ? day(start, { day: "numeric", month: "long", year: "numeric" }) : "";
  const [sy, sm] = start.split("-");
  const [ey, em] = end.split("-");
  const last = day(end, { day: "numeric", month: "long", year: "numeric" });
  if (sy === ey && sm === em) return `${day(start, { day: "numeric" })} – ${last}`;
  if (sy === ey) return `${day(start, { day: "numeric", month: "short" })} – ${day(end, { day: "numeric", month: "short", year: "numeric" })}`;
  return `${day(start, { day: "numeric", month: "short", year: "numeric" })} – ${day(end, { day: "numeric", month: "short", year: "numeric" })}`;
}
const percent = (fraction: number) => (fraction > 0 && fraction < 0.005 ? "<1%" : `${Math.round(fraction * 100)}%`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const s = StyleSheet.create({
  // No page-wide lineHeight: react-pdf would hand bigger text the body's
  // line height and the lines would overlap.
  page: { fontFamily: ["Inter", "NotoSansTC"], fontSize: F.body, color: C.ink, paddingTop: 32, paddingBottom: 60, paddingHorizontal: MARGIN },
  footer: { position: "absolute", bottom: 24, left: MARGIN, right: MARGIN, flexDirection: "row", gap: 12, fontSize: F.min, color: C.soft },
  sectionTitle: { fontSize: F.min, fontWeight: 700, letterSpacing: 1, color: C.muted, textTransform: "uppercase" },
  note: { fontSize: F.min, color: C.muted, marginTop: 8, lineHeight: 1.4 },
  empty: { color: C.muted, marginTop: 8 },
  hero: { borderRadius: 16, backgroundColor: "#2e9f93", paddingVertical: 22, paddingHorizontal: 24, color: "#ffffff", position: "relative", overflow: "hidden" },
  kicker: { fontSize: F.min, letterSpacing: 1.5, fontWeight: 700, opacity: 0.9 },
  title: { fontSize: F.title, fontWeight: 700, marginTop: 4, marginBottom: 4, letterSpacing: -0.4, lineHeight: 1.15, maxWidth: 330 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 14 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 99, paddingVertical: 3, paddingLeft: 3, paddingRight: 12, fontWeight: 500 },
  tile: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 },
  xfer: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.bg, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 12, marginTop: 8 },
  pill: { fontSize: F.min, fontWeight: 700, borderRadius: 99, paddingVertical: 2.5, paddingHorizontal: 8, marginLeft: 5, marginVertical: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 5 },
  divided: { borderTopWidth: 1, borderTopColor: C.line },
  th: { fontSize: F.min, color: C.muted, fontWeight: 600 },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: "#eef0f2" },
});

// ---- Small pieces ---------------------------------------------------------
function Avatar({ p, size = AVATAR, ring }: { p: SummaryPerson; size?: number; ring?: string }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: ring ? "#ffffff" : p.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: Math.max(F.min, size * 0.42), fontWeight: 700, color: p.fg, lineHeight: 1 }}>{p.initials}</Text>
    </View>
  );
}
/** Width of an <Avatars> group: bubbles overlap by 30%. */
const groupWidth = (count: number, size: number) => size + (Math.min(Math.max(count, 1), 3) - 1) * size * 0.7;
const firstName = (name: string) => name.split(" ")[0];
/** A cost-table column's heading: a couple's own name, else a first name. */
const columnName = (p: TripSummary["people"][number]) => (p.members.length > 1 ? p.name : firstName(p.name));

/** A unit's members, overlapping (one bubble for a single person). */
function Avatars({ members, size = AVATAR, ring }: { members: SummaryPerson[]; size?: number; ring?: string }) {
  return (
    <View style={{ flexDirection: "row" }}>
      {members.slice(0, 3).map((m, i) => (
        <View key={m.id} style={{ marginLeft: i ? -size * 0.3 : 0 }}>
          <Avatar p={m} size={size} ring={ring} />
        </View>
      ))}
    </View>
  );
}
function Footer({ summary }: { summary: TripSummary }) {
  return (
    <View style={s.footer} fixed>
      <Text style={{ flex: 1, maxLines: 1, textOverflow: "ellipsis" }}>{summary.trip.name} · Trip summary</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}
/** A thin bar showing `fraction` of the row's width (never quite empty). */
function Bar({ fraction, color }: { fraction: number; color: string }) {
  return (
    <View style={s.barTrack}>
      <View style={{ width: `${Math.max(2, Math.min(1, fraction) * 100)}%`, height: 10, borderRadius: 5, backgroundColor: color }} />
    </View>
  );
}
/**
 * A section's heading. Sections are page-level siblings rather than boxes, so
 * a long one flows onto the next page; the heading moves with it when fewer
 * than `ahead` points of its rows would fit under it.
 */
function SectionTitle({ title, sub, ahead = 70 }: { title: string; sub?: string; ahead?: number }) {
  return (
    <View wrap={false} minPresenceAhead={ahead} style={{ marginTop: 26 }}>
      <Text style={s.sectionTitle}>{title}</Text>
      {sub ? <Text style={{ color: C.muted, marginTop: 3 }}>{sub}</Text> : null}
      <View style={{ borderBottomWidth: 1.5, borderBottomColor: C.line, marginTop: 7 }} />
    </View>
  );
}

/** Whether anything is in a currency other than home, i.e. needed converting. */
const converts = (summary: TripSummary) => summary.rates.list.length > 0;

// ---- Overview -------------------------------------------------------------
function Header({ summary }: { summary: TripSummary }) {
  const travellers = summary.people.reduce((n, p) => n + p.members.length, 0);
  const bits = [dateRange(summary.trip.start, summary.trip.end)];
  if (summary.trip.nights) bits.push(plural(summary.trip.nights, "night"));
  bits.push(plural(travellers, "traveller"));
  return (
    <View style={s.hero} wrap={false}>
      <View style={{ position: "absolute", width: 230, height: 230, borderRadius: 115, right: -60, top: -110, backgroundColor: "rgba(255,255,255,0.08)" }} />
      <View style={{ position: "absolute", width: 140, height: 140, borderRadius: 70, right: 110, bottom: -96, backgroundColor: "rgba(255,255,255,0.07)" }} />
      <Text style={s.kicker}>TRIP SUMMARY</Text>
      <Text style={s.title}>{summary.trip.name}</Text>
      <Text style={{ fontSize: F.amount, opacity: 0.95 }}>{bits.filter(Boolean).join(" · ")}</Text>
      <View style={s.chips}>
        {summary.people.map((p) => (
          <View key={p.key} style={s.chip}>
            <Avatars members={p.members} ring="#fff" />
            <Text>{p.name}</Text>
          </View>
        ))}
      </View>
      <View style={{ position: "absolute", top: 22, right: 24, alignItems: "flex-end" }}>
        <Text style={{ fontSize: F.min, opacity: 0.95 }}>Prepared by</Text>
        <Text style={{ fontSize: F.lead, fontWeight: 700 }}>{summary.preparedBy}</Text>
        <Text style={{ fontSize: F.min, opacity: 0.95 }}>{day(summary.generatedOn, { day: "numeric", month: "short", year: "numeric" })}</Text>
      </View>
    </View>
  );
}

function Stats({ summary, approx }: Ctx & { summary: TripSummary }) {
  const travellers = summary.people.reduce((n, p) => n + p.members.length, 0);
  const tiles: Array<[string, string, string]> = [
    ["Total trip cost", approx(summary.totals.approx), plural(summary.totals.costCount, "shared cost")],
    ["Per person", approx(summary.totals.perPerson), `across ${plural(travellers, "traveller")}`],
  ];
  return (
    <View wrap={false} style={{ marginTop: 12 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        {tiles.map(([label, value, sub], i) => (
          <View key={label} style={[s.tile, i === 0 ? { backgroundColor: C.primaryLight, borderColor: rgba(C.primary, 0.3) } : {}]}>
            <Text style={{ color: i === 0 ? C.primaryDark : C.muted }}>{label}</Text>
            <Text style={{ fontSize: F.stat, fontWeight: 700, marginTop: 2, color: i === 0 ? C.primaryDark : C.ink }}>{value}</Text>
            <Text style={{ fontSize: F.min, color: C.muted, marginTop: 1 }}>{sub}</Text>
          </View>
        ))}
      </View>
      {summary.notSplit ? (
        <Text style={s.note}>
          {summary.notSplit} cost{summary.notSplit === 1 ? " isn’t" : "s aren’t"} split yet, so {summary.notSplit === 1 ? "it isn’t" : "they aren’t"} included.
        </Text>
      ) : null}
    </View>
  );
}

function SettleUp({ summary, person, approx }: Ctx & { summary: TripSummary }) {
  const n = summary.settleUp.length;
  return (
    <>
      <SectionTitle
        title="To settle up"
        sub={n ? `${plural(n, "transfer")} square everyone up` : "Everyone is settled up — nobody owes anything."}
        ahead={n ? 70 : 0}
      />
      {summary.settleUp.map((t) => (
        <View key={`${t.from}>${t.to}`} style={s.xfer} wrap={false}>
          <Avatars members={person(t.from).members} />
          <Text style={{ color: C.soft, fontSize: F.lead }}>→</Text>
          <Avatars members={person(t.to).members} />
          <View style={{ flex: 1, marginLeft: 4 }}>
            <Text style={{ fontWeight: 600 }}>
              {person(t.from).name} {person(t.from).members.length === 1 ? "pays" : "pay"} {person(t.to).name}
            </Text>
            {t.amounts.length > 1 || t.amounts[0]?.currency !== summary.home ? (
              <Text style={{ fontSize: F.min, color: C.muted, marginTop: 1 }}>{approx(t.approx)} in total</Text>
            ) : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            {t.amounts.map((m) => (
              <Text key={m.currency} style={{ fontSize: F.lead, fontWeight: 700 }}>{money(m)}</Text>
            ))}
          </View>
        </View>
      ))}
      {n ? <Text style={s.note}>Fewest transfers for the group. Each amount is exact in its own currency; payments already made are taken into account.</Text> : null}
    </>
  );
}

function Balances({ summary, person, approx }: Ctx & { summary: TripSummary }) {
  if (!summary.balances.length) return null;
  const avatarCol = Math.max(...summary.people.map((p) => groupWidth(p.members.length, AVATAR)), AVATAR) + 10;
  return (
    <>
      <SectionTitle title="Everyone’s balance" ahead={100} />
      {summary.balances.map((b, i) => (
        <View key={b.key} wrap={false} style={[{ flexDirection: "row", alignItems: "center", paddingVertical: 8 }, i ? s.divided : {}]}>
          <View style={{ width: avatarCol }}>
            <Avatars members={person(b.key).members} />
          </View>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ fontWeight: 600 }}>{person(b.key).name}</Text>
            <Text style={{ fontSize: F.min, color: C.muted, marginTop: 1 }}>
              Paid {approx(b.paid)} · share {approx(b.share)}
            </Text>
          </View>
          <View style={{ maxWidth: 230, flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap" }}>
            {b.net.length ? (
              b.net.map((m) => (
                <Text key={m.currency} style={[s.pill, m.amount > 0 ? { color: C.pos, backgroundColor: C.posBg } : { color: C.neg, backgroundColor: C.negBg }]}>
                  {m.amount > 0 ? "+" : ""}{money(m)}
                </Text>
              ))
            ) : (
              <Text style={[s.pill, { color: C.muted, backgroundColor: C.bg }]}>Settled</Text>
            )}
          </View>
        </View>
      ))}
      <Text style={s.note}>
        Positive means they’re owed money; negative means they owe. Payments already made are included.
        {converts(summary)
          ? ` Every cost is split in the currency it was paid in, so balances are exact per currency; ≈ ${symbol(summary.home)} figures use the rates under “Costs by currency” and are only a guide.`
          : ""}
      </Text>
    </>
  );
}

function WhereItWent({ summary }: { summary: TripSummary }) {
  const max = summary.categories[0]?.approx || 1;
  const total = summary.totals.approx || 1;
  const home = (n: number) => `${symbol(summary.home)}${Math.round(n).toLocaleString("en-US")}`;
  return (
    <>
      <SectionTitle title="Where the money went" />
      {summary.categories.map((c) => (
        <View key={c.key} wrap={false} style={s.line}>
          <PdfImage src={icon(c.icon)} style={{ width: 16, height: 16 }} />
          <Text style={{ width: 126 }}>{c.label}</Text>
          <Bar fraction={c.approx / max} color={c.color} />
          <Text style={{ width: 96, textAlign: "right", fontWeight: 600 }}>{home(c.approx)}</Text>
          <Text style={{ width: 42, textAlign: "right", fontSize: F.min, color: C.soft }}>{percent(c.approx / total)}</Text>
        </View>
      ))}
    </>
  );
}

/** The same costs by the currency they were paid in, with the rates behind every ≈ figure. */
function Currencies({ summary }: { summary: TripSummary }) {
  if (!converts(summary)) return null;
  const home = summary.home;
  const max = summary.currencies[0]?.approx || 1;
  const { date, basis, missing, list } = summary.rates;
  const when = date
    ? `${basis === "trip-end" ? "Rates at the end of the trip" : "Latest daily rates"} (${day(date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })})`
    : "Approximate rates";
  const fallback = date && missing.length ? ` ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no daily rate, so an approximate one is used.` : "";
  // A currency only payments used still prices settle-up's ≈ totals.
  const extra = list.filter((r) => r.rate && !summary.currencies.some((c) => c.currency === r.currency));
  const extraText = extra.length
    ? ` Payments also used ${extra.map((r) => `1 ${r.currency} = ${rateText(r.rate!)} ${home}`).join(", ")}.`
    : "";
  return (
    <>
      <SectionTitle title="Costs by currency" />
      {summary.currencies.map((c) => (
        <View key={c.currency} wrap={false} style={s.line}>
          <Text style={{ width: 40, fontWeight: 700 }}>{c.currency}</Text>
          <Text style={{ width: 116, textAlign: "right" }}>{money(c)}</Text>
          <Text style={{ width: 70, fontSize: F.min, color: C.muted }}>{c.rate ? `× ${rateText(c.rate)}` : ""}</Text>
          <Bar fraction={c.approx / max} color={C.primary} />
          <Text style={{ width: 104, textAlign: "right", fontWeight: 600 }}>
            {c.currency === home ? "" : "≈ "}
            {symbol(home)}
            {Math.round(c.approx).toLocaleString("en-US")}
          </Text>
          <Text style={{ width: 42, textAlign: "right", fontSize: F.min, color: C.soft }}>{percent(c.share)}</Text>
        </View>
      ))}
      <Text style={s.note}>
        {when}.{fallback}{extraText} ≈ figures are only a guide; balances stay exact in each currency.
      </Text>
    </>
  );
}

function Upfront({ summary, person, approx }: Ctx & { summary: TripSummary }) {
  const shown = summary.upfront.filter((u) => u.approx > 0);
  if (!shown.length) return null;
  const colorOf = (key: string) => SERIES[Math.max(0, summary.people.findIndex((p) => p.key === key)) % SERIES.length];
  return (
    <>
      <SectionTitle title="Who paid upfront" ahead={80} />
      <View wrap={false} style={{ flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", marginTop: 10, marginBottom: 4, backgroundColor: C.bg }}>
        {shown.map((u) => (
          <View key={u.key} style={{ width: `${u.share * 100}%`, backgroundColor: colorOf(u.key) }} />
        ))}
      </View>
      {shown.map((u) => (
        <View key={u.key} wrap={false} style={s.line}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorOf(u.key) }} />
          <Text style={{ flex: 1 }}>{person(u.key).name}</Text>
          <Text style={{ fontWeight: 600 }}>{approx(u.approx)}</Text>
          <Text style={{ width: 42, textAlign: "right", fontSize: F.min, color: C.soft }}>{Math.round(u.share * 100)}%</Text>
        </View>
      ))}
    </>
  );
}

function Payments({ summary }: { summary: TripSummary }) {
  return (
    <>
      <SectionTitle title="Payments already made" ahead={summary.payments.length ? 60 : 0} />
      {summary.payments.length === 0 ? <Text style={s.empty}>No payments recorded yet.</Text> : null}
      {summary.payments.map((p, i) => (
        <View key={i} wrap={false} style={[{ flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 8 }, i ? s.divided : {}]}>
          <Avatar p={p.from} />
          <View style={{ flex: 1 }}>
            <Text>{firstName(p.from.name)} paid {firstName(p.to.name)}</Text>
            <Text style={{ fontSize: F.min, color: C.muted }}>{[shortDate(p.date), p.note].filter(Boolean).join(" · ")}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: F.amount, fontWeight: 700 }}>{money(p)}</Text>
            {p.paid ? <Text style={{ fontSize: F.min, color: C.muted }}>sent as {money(p.paid)}</Text> : null}
          </View>
        </View>
      ))}
    </>
  );
}

// ---- Cost pages -----------------------------------------------------------
// Up to this many people get a column each; beyond it, each cost lists the
// shares under its title instead.
const MAX_PERSON_COLUMNS = 4;
const AMOUNT_WIDTH = 108;

/** One cost's split, written out: for the no-columns layout. */
function sharesLine(r: TripSummary["categories"][number]["costs"][number], people: TripSummary["people"]) {
  const parts = people.filter((p) => r.shares[p.key]).map((p) => ({ name: columnName(p), value: r.shares[p.key] }));
  if (!parts.length) return "";
  const amount = (value: number) => plain({ currency: r.currency, amount: value });
  if (parts.every((x) => Math.abs(x.value - parts[0].value) < 0.005)) {
    return parts.length === 1 ? `All ${parts[0].name}’s` : `Split ${parts.length} ways · ${amount(parts[0].value)} each`;
  }
  return parts.map((x) => `${x.name} ${amount(x.value)}`).join(" · ");
}

function CostPages({ summary, person, approx }: Ctx & { summary: TripSummary }) {
  const people = summary.people;
  const columns = people.length <= MAX_PERSON_COLUMNS;
  // Wide enough for a share like 15,000.00 at 12pt; the item gets the rest.
  const personWidth = 66;
  // The closing panel's cards: three to a row, 2×2 for four people.
  const n = summary.balances.length;
  const perRow = n <= 3 ? Math.max(n, 1) : n === 4 ? 2 : 3;
  const cardWidth = Math.floor((CONTENT - 28 - (perRow - 1) * 9) / perRow);
  type Cost = TripSummary["categories"][number]["costs"][number];
  const costRow = (r: Cost, divided: boolean) => (
    <View style={[{ flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 5 }, divided ? s.divided : {}]}>
      <View style={{ flex: 1, flexDirection: "row", gap: 7, paddingRight: 8 }}>
        <PdfImage src={icon(r.icon)} style={{ width: 15, height: 15, marginTop: 1.5 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: 600 }}>{r.title}</Text>
          <Text style={{ fontSize: F.min, color: C.muted }}>{[shortDate(r.date), r.sub].filter(Boolean).join(" · ")}</Text>
          {r.notes.map((note) => (
            <Text key={note} style={{ fontSize: F.min, color: C.primaryDark }}>{note}</Text>
          ))}
          {columns ? null : <Text style={{ fontSize: F.min, marginTop: 2 }}>{sharesLine(r, people)}</Text>}
        </View>
      </View>
      {/* The amount, with who paid it underneath. */}
      <View style={{ width: AMOUNT_WIDTH, alignItems: "flex-end" }}>
        <Text style={{ fontSize: F.amount, fontWeight: 700 }}>{money(r)}</Text>
        <Text style={{ fontSize: F.min, color: C.muted, textAlign: "right" }}>
          {r.paidBy ? `paid by ${firstName(r.paidBy.name)}` : "not paid yet"}
          {r.otherPayers ? ` +${r.otherPayers}` : ""}
        </Text>
      </View>
      {columns
        ? people.map((p) => (
            <Text key={p.key} style={{ width: personWidth, paddingLeft: 6, textAlign: "right", fontSize: F.min, color: r.shares[p.key] ? C.ink : "#bdc1c6" }}>
              {r.shares[p.key] ? plain({ currency: r.currency, amount: r.shares[p.key] }) : "—"}
            </Text>
          ))
        : null}
    </View>
  );
  // Costs follow straight on from the overview (no forced page break, so a
  // long overview doesn't leave most of a page empty). Each category's header
  // and column headings are one unbreakable block with its first cost — and
  // the first category's with the section title — so no heading is ever left
  // at the foot of a page; the rest of its costs are page-level siblings that
  // flow on.
  return (
    <>
      {summary.categories.map((c, ci) => {
        const [first, ...rest] = c.costs;
        return (
          <React.Fragment key={c.key}>
            <View wrap={false} style={{ marginTop: ci ? 18 : 32 }}>
              {ci === 0 ? (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: F.h1, fontWeight: 700, letterSpacing: -0.3 }}>Every shared cost</Text>
                  <Text style={{ color: C.muted, marginTop: 3 }}>
                    Grouped by category, with {columns ? "each person’s share" : "how each was split"}, in the cost’s own currency.
                  </Text>
                </View>
              ) : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11, backgroundColor: rgba(c.color, 0.08) }}>
                <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: "#ffffff", borderWidth: 1, borderColor: rgba(c.color, 0.25), alignItems: "center", justifyContent: "center" }}>
                  <PdfImage src={icon(c.icon)} style={{ width: 20, height: 20 }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: F.lead, fontWeight: 700 }}>{c.label}</Text>
                  <Text style={{ fontSize: F.min, color: C.muted }}>
                    {plural(c.costs.length, "cost")}
                    {c.totals.length === 1 && c.totals[0].currency === summary.home ? "" : ` · ${approx(c.approx)}`}
                  </Text>
                </View>
                <Text style={{ fontSize: F.amount, fontWeight: 700, maxWidth: 250, textAlign: "right" }}>{c.totals.map(money).join(" + ")}</Text>
              </View>
              {columns ? (
                <View style={{ flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 5, paddingTop: 8, paddingBottom: 5 }}>
                  <Text style={[s.th, { flex: 1 }]}>Item</Text>
                  <Text style={[s.th, { width: AMOUNT_WIDTH, textAlign: "right" }]}>Amount</Text>
                  {people.map((p) => (
                    <Text key={p.key} style={[s.th, { width: personWidth, paddingLeft: 6, textAlign: "right" }]}>{columnName(p)}</Text>
                  ))}
                </View>
              ) : (
                <View style={{ height: 4 }} />
              )}
              {first ? costRow(first, columns) : null}
            </View>
            {rest.map((r, i) => (
              <View key={i} wrap={false}>
                {costRow(r, true)}
              </View>
            ))}
          </React.Fragment>
        );
      })}

      <View wrap={false} style={{ marginTop: 24, borderRadius: 14, backgroundColor: C.ink, padding: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 10 }}>
          <Text style={{ color: "#ffffff", fontSize: F.lead, fontWeight: 700 }}>All shared costs</Text>
          <Text style={{ color: "#ffffff", opacity: 0.8, fontSize: F.min }}>
            {plural(summary.totals.costCount, "cost")} · {approx(summary.totals.approx)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 12 }}>
          {summary.balances.map((b) => (
            <View key={b.key} style={{ width: cardWidth, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 10, padding: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 4 }}>
                <Avatars members={person(b.key).members} />
                <Text style={{ color: "#ffffff", fontWeight: 600, flex: 1 }}>{person(b.key).name}</Text>
              </View>
              <Text style={{ color: "#ffffff", fontSize: F.min, opacity: 0.8 }}>Share of costs</Text>
              <Text style={{ color: "#ffffff", fontSize: F.stat, fontWeight: 700 }}>{approx(b.share)}</Text>
              <Text style={{ color: "#ffffff", fontSize: F.min, opacity: 0.8 }}>{b.owed.map(money).join(" + ") || "—"}</Text>
            </View>
          ))}
        </View>
      </View>
    </>
  );
}

type Ctx = {
  person: (key: string) => TripSummary["people"][number];
  approx: (n: number) => string;
};

export function TripSummaryDocument({ summary }: { summary: TripSummary }) {
  const byKey = new Map(summary.people.map((p) => [p.key, p]));
  const person = (key: string) => byKey.get(key) ?? { key, name: "Someone", members: [] };
  // Everything in the home currency: totals are exact, so no ≈ and no rounding.
  const approx = converts(summary)
    ? (n: number) => `≈ ${symbol(summary.home)}${Math.round(n).toLocaleString("en-US")}`
    : (n: number) => money({ currency: summary.home, amount: n });
  const ctx = { person, approx };
  const hasCosts = summary.categories.length > 0;
  // The overview first — who pays whom and everyone's balance, then where the
  // money went — and every cost after it, one column throughout.
  return (
    <Document title={`${summary.trip.name} — trip summary`} author={summary.preparedBy} creator="Itinerary" producer="Itinerary">
      <Page size="A4" style={s.page}>
        <Footer summary={summary} />
        <Header summary={summary} />
        <Stats summary={summary} {...ctx} />
        <SettleUp summary={summary} {...ctx} />
        {hasCosts ? (
          <>
            <Balances summary={summary} {...ctx} />
            <WhereItWent summary={summary} />
            <Currencies summary={summary} />
            <Upfront summary={summary} {...ctx} />
            <Payments summary={summary} />
            <CostPages summary={summary} {...ctx} />
          </>
        ) : (
          <>
            <SectionTitle title="Shared costs" ahead={0} />
            <Text style={s.empty}>No shared costs yet.</Text>
          </>
        )}
      </Page>
    </Document>
  );
}

/** The finished PDF file. */
export function renderTripSummaryPdf(summary: TripSummary): Promise<Buffer> {
  return renderToBuffer(<TripSummaryDocument summary={summary} />);
}
