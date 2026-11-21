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

// Type sizes in points. The PDF is mostly read on a phone, where an A4 page
// shows at about two-thirds size, so nothing goes below 8pt.
const F = { micro: 8, small: 9, body: 10.5, num: 11, lead: 13.5, stat: 15, h1: 19, title: 26 };
// The page's content width: A4 less the side margins.
const CONTENT = 595.28 - 72;

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

const s = StyleSheet.create({
  page: { fontFamily: ["Inter", "NotoSansTC"], fontSize: F.body, color: C.ink, paddingTop: 34, paddingBottom: 48, paddingHorizontal: 36 },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: F.micro, color: "#9aa0a6" },
  card: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 13, backgroundColor: "#ffffff" },
  h2: { fontSize: F.small, fontWeight: 700, letterSpacing: 1, color: C.muted, marginBottom: 8, textTransform: "uppercase" },
  row: { flexDirection: "row", gap: 10, marginTop: 10 },
  note: { fontSize: F.micro, color: C.soft, marginTop: 8, lineHeight: 1.4 },
  hero: { borderRadius: 14, backgroundColor: "#2e9f93", paddingVertical: 18, paddingHorizontal: 20, color: "#ffffff", position: "relative", overflow: "hidden" },
  kicker: { fontSize: F.micro, letterSpacing: 1.6, fontWeight: 700, opacity: 0.85 },
  title: { fontSize: F.title, fontWeight: 700, marginTop: 3, marginBottom: 4, letterSpacing: -0.4, lineHeight: 1.15, maxWidth: 340 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 99, paddingVertical: 3, paddingLeft: 3, paddingRight: 10, fontSize: 9.5, fontWeight: 500 },
  xfer: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: C.bg, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11, marginTop: 6 },
  pill: { fontSize: F.small, fontWeight: 700, borderRadius: 99, paddingVertical: 2, paddingHorizontal: 7, marginLeft: 4, marginVertical: 1.5 },
  th: { fontSize: F.micro, color: C.soft, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "#eef0f2" },
});

// ---- Small pieces ---------------------------------------------------------
function Avatar({ p, size = 16, ring }: { p: SummaryPerson; size?: number; ring?: string }) {
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
      <Text style={{ fontSize: size * 0.38, fontWeight: 700, color: p.fg, lineHeight: 1 }}>{p.initials}</Text>
    </View>
  );
}
/** Width of an <Avatars> group: bubbles overlap by 30%. */
const groupWidth = (count: number, size: number) => size + (Math.min(Math.max(count, 1), 3) - 1) * size * 0.7;
const firstName = (name: string) => name.split(" ")[0];
/** A cost-table column's heading: a couple's own name, else a first name. */
const columnName = (p: TripSummary["people"][number]) => (p.members.length > 1 ? p.name : firstName(p.name));

/** A unit's members, overlapping (one bubble for a single person). */
function Avatars({ members, size = 16, ring }: { members: SummaryPerson[]; size?: number; ring?: string }) {
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
      <Text>{summary.trip.name} · Trip summary</Text>
      <Text render={({ pageNumber, totalPages }) => `Made with Itinerary · Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}
/** A thin bar showing `fraction` of the row's width (never quite empty). */
function Bar({ fraction, color }: { fraction: number; color: string }) {
  return (
    <View style={s.barTrack}>
      <View style={{ width: `${Math.max(2, Math.min(1, fraction) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}
const percent = (fraction: number) => (fraction > 0 && fraction < 0.005 ? "<1%" : `${Math.round(fraction * 100)}%`);

// ---- Overview -------------------------------------------------------------
function Header({ summary }: { summary: TripSummary }) {
  const travellers = summary.people.reduce((n, p) => n + p.members.length, 0);
  const bits = [dateRange(summary.trip.start, summary.trip.end)];
  if (summary.trip.nights) bits.push(`${summary.trip.nights} night${summary.trip.nights === 1 ? "" : "s"}`);
  bits.push(`${travellers} traveller${travellers === 1 ? "" : "s"}`);
  return (
    <View style={s.hero} wrap={false}>
      <View style={{ position: "absolute", width: 210, height: 210, borderRadius: 105, right: -55, top: -100, backgroundColor: "rgba(255,255,255,0.08)" }} />
      <View style={{ position: "absolute", width: 130, height: 130, borderRadius: 65, right: 100, bottom: -88, backgroundColor: "rgba(255,255,255,0.07)" }} />
      <Text style={s.kicker}>TRIP SUMMARY</Text>
      <Text style={s.title}>{summary.trip.name}</Text>
      <Text style={{ fontSize: 11, opacity: 0.92 }}>{bits.filter(Boolean).join(" · ")}</Text>
      <View style={s.chips}>
        {summary.people.map((p) => (
          <View key={p.key} style={s.chip}>
            <Avatars members={p.members} size={17} ring="#fff" />
            <Text>{p.name}</Text>
          </View>
        ))}
      </View>
      <View style={{ position: "absolute", top: 18, right: 20, alignItems: "flex-end" }}>
        <Text style={{ fontSize: F.micro, opacity: 0.92 }}>Prepared by</Text>
        <Text style={{ fontSize: 11.5, fontWeight: 700, marginTop: 1 }}>{summary.preparedBy}</Text>
        <Text style={{ fontSize: F.micro, opacity: 0.92, marginTop: 1 }}>{day(summary.generatedOn, { day: "numeric", month: "short", year: "numeric" })}</Text>
      </View>
    </View>
  );
}

function Stats({ summary, approx }: Ctx & { summary: TripSummary }) {
  // Money tiles get the room; the two counts are short.
  const tiles: Array<[string, string, number]> = [
    ["Total trip cost", approx(summary.totals.approx), 1.35],
    ["Per person", approx(summary.totals.perPerson), 1.35],
    ["Shared costs", String(summary.totals.costCount), 0.9],
    ["Payments made", String(summary.totals.paymentCount), 0.9],
  ];
  return (
    <View wrap={false} style={{ marginTop: 10 }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {tiles.map(([label, value, grow], i) => (
          <View
            key={label}
            style={[s.card, { flexGrow: grow, flexBasis: 0, paddingVertical: 10, paddingHorizontal: 12 }, i === 0 ? { backgroundColor: C.primaryLight, borderColor: rgba(C.primary, 0.3) } : {}]}
          >
            <Text style={{ fontSize: F.small, color: i === 0 ? C.primaryDark : C.muted }}>{label}</Text>
            <Text style={{ fontSize: F.stat, fontWeight: 700, marginTop: 3, color: i === 0 ? C.primaryDark : C.ink }}>{value}</Text>
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

// A longer list than this may run onto the next page rather than leave page 1
// empty; it always starts right under the stats, so its heading stays put.
const MAX_WHOLE_TRANSFERS = 6;

function SettleUp({ summary, person, approx }: Ctx & { summary: TripSummary }) {
  const n = summary.settleUp.length;
  return (
    <View style={[s.card, { marginTop: 10 }]} wrap={n > MAX_WHOLE_TRANSFERS}>
      <Text style={[s.h2, { marginBottom: 2 }]}>To settle up</Text>
      <Text style={{ color: C.muted }}>
        {n ? `${n} transfer${n === 1 ? "" : "s"} square everyone up` : "Everyone is settled up — nobody owes anything."}
      </Text>
      {summary.settleUp.map((t) => (
        <View key={`${t.from}>${t.to}`} style={s.xfer} wrap={false}>
          <Avatars members={person(t.from).members} size={22} />
          <Text style={{ color: C.soft, fontSize: 11 }}>→</Text>
          <Avatars members={person(t.to).members} size={22} />
          <View style={{ flex: 1, marginLeft: 3 }}>
            <Text style={{ fontWeight: 600 }}>
              {person(t.from).name} {person(t.from).members.length === 1 ? "pays" : "pay"} {person(t.to).name}
            </Text>
            {t.amounts.length > 1 || t.amounts[0]?.currency !== summary.home ? (
              <Text style={{ fontSize: F.small, color: C.muted, marginTop: 1 }}>{approx(t.approx)} in total</Text>
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
    </View>
  );
}

function Balances({ summary, person, approx }: Ctx & { summary: TripSummary }) {
  const avatarCol = Math.max(...summary.people.map((p) => groupWidth(p.members.length, 20)), 20) + 8;
  // Kept whole on one page unless it's too long to fit one.
  return (
    <View style={[s.card, { marginTop: 10 }]} wrap={summary.balances.length > 14}>
      <Text style={s.h2}>Everyone’s balance</Text>
      <View style={{ flexDirection: "row", paddingHorizontal: 5, paddingBottom: 5 }}>
        <Text style={[s.th, { flex: 1, marginLeft: avatarCol }]}>Person</Text>
        <Text style={[s.th, { width: 86, textAlign: "right" }]}>Paid for</Text>
        <Text style={[s.th, { width: 86, textAlign: "right" }]}>Their share</Text>
        <Text style={[s.th, { width: 178, textAlign: "right" }]}>Balance</Text>
      </View>
      {summary.balances.map((b) => (
        <View key={b.key} wrap={false} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6.5, paddingHorizontal: 5, borderTopWidth: 1, borderTopColor: C.line }}>
          <View style={{ width: avatarCol }}>
            <Avatars members={person(b.key).members} size={20} />
          </View>
          <Text style={{ flex: 1, fontWeight: 600, paddingRight: 4 }}>{person(b.key).name}</Text>
          <Text style={{ width: 86, textAlign: "right" }}>{approx(b.paid)}</Text>
          <Text style={{ width: 86, textAlign: "right" }}>{approx(b.share)}</Text>
          <View style={{ width: 178, flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap" }}>
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
    </View>
  );
}

/** Whether anything is in a currency other than home, i.e. needed converting. */
const converts = (summary: TripSummary) => summary.rates.list.length > 0;

function WhereItWent({ summary }: { summary: TripSummary }) {
  const max = summary.categories[0]?.approx || 1;
  const total = summary.totals.approx || 1;
  const home = (n: number) => `${symbol(summary.home)}${Math.round(n).toLocaleString("en-US")}`;
  return (
    <View style={[s.card, { marginTop: 10 }]} wrap={false}>
      <Text style={s.h2}>Where the money went</Text>
      {summary.categories.length === 0 ? <Text style={{ color: C.muted }}>No shared costs yet.</Text> : null}
      {summary.categories.map((c) => (
        <View key={c.key} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3.2 }}>
          <PdfImage src={icon(c.icon)} style={{ width: 13, height: 13 }} />
          <Text style={{ width: 104 }}>{c.label}</Text>
          <Bar fraction={c.approx / max} color={c.color} />
          <Text style={{ width: 84, textAlign: "right", fontWeight: 600 }}>{home(c.approx)}</Text>
          <Text style={{ width: 34, textAlign: "right", fontSize: F.small, color: C.soft }}>{percent(c.approx / total)}</Text>
        </View>
      ))}
    </View>
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
    <View style={[s.card, { marginTop: 10 }]} wrap={false}>
      <Text style={s.h2}>Costs by currency</Text>
      {summary.currencies.map((c) => (
        <View key={c.currency} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3.2 }}>
          <Text style={{ width: 34, fontWeight: 700 }}>{c.currency}</Text>
          <Text style={{ width: 92, textAlign: "right" }}>{money(c)}</Text>
          <Text style={{ width: 58, fontSize: F.small, color: C.muted }}>{c.rate ? `× ${rateText(c.rate)}` : ""}</Text>
          <Bar fraction={c.approx / max} color={C.primary} />
          <Text style={{ width: 84, textAlign: "right", fontWeight: 600 }}>
            {c.currency === home ? "" : "≈ "}
            {symbol(home)}
            {Math.round(c.approx).toLocaleString("en-US")}
          </Text>
          <Text style={{ width: 34, textAlign: "right", fontSize: F.small, color: C.soft }}>{percent(c.share)}</Text>
        </View>
      ))}
      <Text style={s.note}>
        {when}.{fallback}{extraText} ≈ figures are only a guide; balances stay exact in each currency.
      </Text>
    </View>
  );
}

function Upfront({ summary, person, approx, side }: Ctx & { summary: TripSummary; side?: boolean }) {
  const shown = summary.upfront.filter((u) => u.approx > 0);
  const colorOf = (key: string) => SERIES[Math.max(0, summary.people.findIndex((p) => p.key === key)) % SERIES.length];
  return (
    <View style={[s.card, side ? { flex: 1 } : {}]} wrap={false}>
      <Text style={s.h2}>Who paid upfront</Text>
      <View style={{ flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", marginBottom: 8, backgroundColor: C.bg }}>
        {shown.map((u) => (
          <View key={u.key} style={{ width: `${u.share * 100}%`, backgroundColor: colorOf(u.key) }} />
        ))}
      </View>
      {shown.map((u) => (
        <View key={u.key} style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 2.5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorOf(u.key) }} />
          <Text style={{ flex: 1 }}>{person(u.key).name}</Text>
          <Text style={{ fontWeight: 600 }}>{approx(u.approx)}</Text>
          <Text style={{ width: 32, textAlign: "right", fontSize: F.small, color: C.soft }}>{Math.round(u.share * 100)}%</Text>
        </View>
      ))}
      {shown.length === 0 ? <Text style={{ color: C.muted }}>Nobody has paid for anything yet.</Text> : null}
    </View>
  );
}

function Payments({ summary, side }: { summary: TripSummary; side?: boolean }) {
  return (
    <View style={[s.card, side ? { flex: 1 } : {}]} wrap={!side}>
      <Text style={s.h2}>Payments already made</Text>
      {summary.payments.length === 0 ? <Text style={{ color: C.muted }}>No payments recorded yet.</Text> : null}
      {summary.payments.map((p, i) => (
        <View key={i} wrap={false} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
          <Avatar p={p.from} size={20} />
          <View style={{ flex: 1, marginLeft: 2 }}>
            <Text>{firstName(p.from.name)} paid {firstName(p.to.name)}</Text>
            <Text style={{ fontSize: F.small, color: C.muted }}>{[shortDate(p.date), p.note].filter(Boolean).join(" · ")}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: F.num, fontWeight: 700 }}>{money(p)}</Text>
            {p.paid ? <Text style={{ fontSize: F.small, color: C.muted }}>sent as {money(p.paid)}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

// A long payments list gets a full-width card that can run onto the next page;
// a short one sits beside "Who paid upfront".
const MAX_SIDE_PAYMENTS = 8;
function UpfrontAndPayments(props: Ctx & { summary: TripSummary }) {
  if (props.summary.payments.length > MAX_SIDE_PAYMENTS) {
    return (
      <>
        <View style={{ marginTop: 10 }} wrap={false}>
          <Upfront {...props} />
        </View>
        <View style={{ marginTop: 10 }}>
          <Payments summary={props.summary} />
        </View>
      </>
    );
  }
  return (
    <View style={s.row} wrap={false}>
      <Upfront {...props} side />
      <Payments summary={props.summary} side />
    </View>
  );
}

// ---- Cost pages -----------------------------------------------------------
const MAX_PERSON_COLUMNS = 5;
const AMOUNT_WIDTH = 96;

function CostPages({ summary, person, approx }: Ctx & { summary: TripSummary }) {
  const people = summary.people;
  const columns = people.length <= MAX_PERSON_COLUMNS;
  // Person columns share what's left after the amount and a readable item
  // column, within limits that fit a share like 12,345.67.
  const personWidth = columns ? Math.max(50, Math.min(62, Math.floor((CONTENT - 10 - AMOUNT_WIDTH - 150) / Math.max(people.length, 1)))) : 0;
  // The closing panel's cards: one row for up to three people, 2×2 for four,
  // rows of three beyond that. Width = content less the panel's padding.
  const n = summary.balances.length;
  const perRow = n <= 3 ? Math.max(n, 1) : n === 4 ? 2 : 3;
  const cardWidth = Math.floor((CONTENT - 26 - (perRow - 1) * 8) / perRow);
  // Costs follow straight on from the overview (no forced page break, so a
  // long overview doesn't leave most of a page empty). Everything here is a
  // page-level sibling, not nested per category: react-pdf only keeps a
  // heading with what follows (minPresenceAhead) when it has an earlier break
  // point in the same container.
  return (
    <>
      <View wrap={false} minPresenceAhead={130} style={{ marginTop: 20 }}>
        <Text style={{ fontSize: F.h1, fontWeight: 700, letterSpacing: -0.3 }}>Every shared cost</Text>
        <Text style={{ color: C.muted, marginTop: 2, marginBottom: 10 }}>
          Grouped by category{columns ? ", with each person’s share in the cost’s own currency." : "."}
        </Text>
      </View>
      {summary.categories.map((c, ci) => (
        <React.Fragment key={c.key}>
          {/* Header and column headings move to the next page with the first row. */}
          <View wrap={false} minPresenceAhead={48} style={{ marginTop: ci ? 12 : 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: rgba(c.color, 0.08) }}>
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "#ffffff", borderWidth: 1, borderColor: rgba(c.color, 0.25), alignItems: "center", justifyContent: "center" }}>
                <PdfImage src={icon(c.icon)} style={{ width: 16, height: 16 }} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12.5, fontWeight: 700 }}>{c.label}</Text>
                <Text style={{ fontSize: F.small, color: C.muted }}>
                  {c.costs.length} cost{c.costs.length === 1 ? "" : "s"}
                  {c.totals.length === 1 && c.totals[0].currency === summary.home ? "" : ` · ${approx(c.approx)}`}
                </Text>
              </View>
              <Text style={{ fontSize: 12, fontWeight: 700, maxWidth: 260, textAlign: "right" }}>{c.totals.map(money).join(" + ")}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 5, paddingTop: 7, paddingBottom: 4 }}>
              <Text style={[s.th, { flex: 1 }]}>Item</Text>
              <Text style={[s.th, { width: AMOUNT_WIDTH, textAlign: "right" }]}>Amount</Text>
              {columns ? (
                people.map((p) => (
                  <View key={p.key} style={{ width: personWidth, alignItems: "flex-end", gap: 2, paddingLeft: 4 }}>
                    <Avatars members={p.members} size={13} />
                    <Text style={[s.th, { textAlign: "right", maxLines: 2, textOverflow: "ellipsis" }]}>{columnName(p)}</Text>
                  </View>
                ))
              ) : (
                <Text style={[s.th, { width: 64, textAlign: "right" }]}>Split</Text>
              )}
            </View>
          </View>
          {c.costs.map((r, i) => (
            <View key={i} wrap={false} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 5, borderTopWidth: 1, borderTopColor: C.line }}>
              <View style={{ flex: 1, flexDirection: "row", gap: 6, paddingRight: 8 }}>
                <PdfImage src={icon(r.icon)} style={{ width: 12, height: 12, marginTop: 1.5 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: 600 }}>{r.title}</Text>
                  <Text style={{ fontSize: F.small, color: C.muted }}>{[shortDate(r.date), r.sub].filter(Boolean).join(" · ")}</Text>
                  {r.notes.map((note) => (
                    <Text key={note} style={{ fontSize: F.small, color: C.primaryDark }}>{note}</Text>
                  ))}
                </View>
              </View>
              {/* The amount, with who paid it underneath. */}
              <View style={{ width: AMOUNT_WIDTH, alignItems: "flex-end" }}>
                <Text style={{ fontSize: F.num, fontWeight: 700 }}>{money(r)}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 }}>
                  {r.paidBy ? <Avatar p={r.paidBy} size={12} /> : null}
                  <Text style={{ fontSize: F.micro, color: C.muted }}>
                    {r.paidBy ? `paid by ${firstName(r.paidBy.name)}` : "not paid yet"}
                    {r.otherPayers ? ` +${r.otherPayers}` : ""}
                  </Text>
                </View>
              </View>
              {columns ? (
                people.map((p) => (
                  <Text key={p.key} style={{ width: personWidth, paddingLeft: 4, textAlign: "right", fontSize: 10, color: r.shares[p.key] ? C.ink : "#bdc1c6" }}>
                    {r.shares[p.key] ? plain({ currency: r.currency, amount: r.shares[p.key] }) : "—"}
                  </Text>
                ))
              ) : (
                <Text style={{ width: 64, textAlign: "right", fontSize: F.small, color: C.muted }}>
                  {Object.keys(r.shares).length} way{Object.keys(r.shares).length === 1 ? "" : "s"}
                </Text>
              )}
            </View>
          ))}
        </React.Fragment>
      ))}
      {summary.categories.length === 0 ? <Text style={{ color: C.muted }}>No shared costs yet.</Text> : null}

      <View wrap={false} style={{ marginTop: 16, borderRadius: 12, backgroundColor: C.ink, padding: 13 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <Text style={{ color: "#ffffff", fontSize: 13, fontWeight: 700 }}>All shared costs</Text>
          <Text style={{ color: "#ffffff", opacity: 0.75, fontSize: F.small }}>
            {summary.totals.costCount} cost{summary.totals.costCount === 1 ? "" : "s"} · {approx(summary.totals.approx)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {summary.balances.map((b) => (
            <View key={b.key} style={{ width: cardWidth, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 9, padding: 9 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <Avatars members={person(b.key).members} size={16} />
                <Text style={{ color: "#ffffff", fontWeight: 600, flex: 1 }}>{person(b.key).name}</Text>
              </View>
              <Text style={{ color: "#ffffff", fontSize: F.micro, opacity: 0.75 }}>Share of costs</Text>
              <Text style={{ color: "#ffffff", fontSize: F.stat, fontWeight: 700 }}>{approx(b.share)}</Text>
              <Text style={{ color: "#ffffff", fontSize: F.small, opacity: 0.75, marginTop: 1 }}>{b.owed.map(money).join(" + ") || "—"}</Text>
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
  // Overview first — who pays whom and everyone's balance, then where the
  // money went — and every cost after it. Each card moves to the next page
  // whole rather than splitting.
  return (
    <Document title={`${summary.trip.name} — trip summary`} author={summary.preparedBy} creator="Itinerary" producer="Itinerary">
      <Page size="A4" style={s.page}>
        <Footer summary={summary} />
        <Header summary={summary} />
        <Stats summary={summary} {...ctx} />
        <SettleUp summary={summary} {...ctx} />
        <Balances summary={summary} {...ctx} />
        <WhereItWent summary={summary} />
        <Currencies summary={summary} />
        <UpfrontAndPayments summary={summary} {...ctx} />
        <CostPages summary={summary} {...ctx} />
      </Page>
    </Document>
  );
}

/** The finished PDF file. */
export function renderTripSummaryPdf(summary: TripSummary): Promise<Buffer> {
  return renderToBuffer(<TripSummaryDocument summary={summary} />);
}
