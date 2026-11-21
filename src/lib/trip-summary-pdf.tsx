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
// Names and places shouldn't be split with hyphens.
Font.registerHyphenationCallback((word) => [word]);

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

// ---- Formatting ------------------------------------------------------------
const money = (m: Money) => `${m.amount < 0 ? "−" : ""}${formatCurrency(Math.abs(m.amount), m.currency)}`;
const plain = (m: Money) =>
  Math.abs(m.amount).toLocaleString("en-US", {
    minimumFractionDigits: ["JPY", "KRW", "TWD"].includes(m.currency) ? 0 : 2,
    maximumFractionDigits: ["JPY", "KRW", "TWD"].includes(m.currency) ? 0 : 2,
  });
const symbol = (currency: string) => CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency;
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
  page: { fontFamily: ["Inter", "NotoSansTC"], fontSize: 9, color: C.ink, paddingTop: 34, paddingBottom: 46, paddingHorizontal: 36 },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 6.5, color: "#9aa0a6" },
  card: { borderWidth: 1, borderColor: C.line, borderRadius: 11, padding: 12, backgroundColor: "#ffffff" },
  h2: { fontSize: 7, fontWeight: 700, letterSpacing: 1, color: C.muted, marginBottom: 7, textTransform: "uppercase" },
  row: { flexDirection: "row", gap: 9, marginTop: 9 },
  note: { fontSize: 6.5, color: C.soft, marginTop: 6, lineHeight: 1.4 },
  hero: { borderRadius: 14, backgroundColor: "#2e9f93", paddingVertical: 16, paddingHorizontal: 19, color: "#ffffff", position: "relative", overflow: "hidden" },
  kicker: { fontSize: 6.5, letterSpacing: 1.6, fontWeight: 700, opacity: 0.85 },
  title: { fontSize: 22, fontWeight: 700, marginTop: 3, marginBottom: 3, letterSpacing: -0.4, lineHeight: 1.15, maxWidth: 360 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 10 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 99, paddingVertical: 2.5, paddingLeft: 2.5, paddingRight: 9, fontSize: 7.5, fontWeight: 500 },
  xfer: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.bg, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 9, marginTop: 5 },
  fact: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6.5, borderBottomWidth: 1, borderBottomColor: C.line, borderStyle: "dashed" },
  pill: { fontSize: 7, fontWeight: 700, borderRadius: 99, paddingVertical: 1.5, paddingHorizontal: 6, marginLeft: 3 },
  th: { fontSize: 6, color: C.soft, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase" },
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

// ---- Page 1 ---------------------------------------------------------------
function Header({ summary }: { summary: TripSummary }) {
  const travellers = summary.people.reduce((n, p) => n + p.members.length, 0);
  const bits = [dateRange(summary.trip.start, summary.trip.end)];
  if (summary.trip.nights) bits.push(`${summary.trip.nights} night${summary.trip.nights === 1 ? "" : "s"}`);
  bits.push(`${travellers} traveller${travellers === 1 ? "" : "s"}`);
  return (
    <View style={s.hero} wrap={false}>
      <View style={{ position: "absolute", width: 190, height: 190, borderRadius: 95, right: -50, top: -90, backgroundColor: "rgba(255,255,255,0.08)" }} />
      <View style={{ position: "absolute", width: 120, height: 120, borderRadius: 60, right: 90, bottom: -80, backgroundColor: "rgba(255,255,255,0.07)" }} />
      <Text style={s.kicker}>TRIP SUMMARY</Text>
      <Text style={s.title}>{summary.trip.name}</Text>
      <Text style={{ fontSize: 9, opacity: 0.92 }}>{bits.filter(Boolean).join(" · ")}</Text>
      <View style={s.chips}>
        {summary.people.map((p) => (
          <View key={p.key} style={s.chip}>
            <Avatars members={p.members} size={15} ring="#fff" />
            <Text>{p.name}</Text>
          </View>
        ))}
      </View>
      <View style={{ position: "absolute", top: 16, right: 19, alignItems: "flex-end" }}>
        <Text style={{ fontSize: 7, opacity: 0.92 }}>Prepared by</Text>
        <Text style={{ fontSize: 9.5, fontWeight: 700, marginTop: 1 }}>{summary.preparedBy}</Text>
        <Text style={{ fontSize: 7, opacity: 0.92, marginTop: 1 }}>{day(summary.generatedOn, { day: "numeric", month: "short", year: "numeric" })}</Text>
      </View>
    </View>
  );
}

function SettleUp({ summary, person, approx }: Ctx & { summary: TripSummary }) {
  const n = summary.settleUp.length;
  return (
    <View style={[s.card, { flex: 1.55 }]} wrap={false}>
      <Text style={[s.h2, { marginBottom: 1 }]}>To settle up</Text>
      <Text style={{ fontSize: 8, color: C.muted, marginBottom: 2 }}>
        {n ? `${n} transfer${n === 1 ? "" : "s"} square everyone up` : "Everyone is settled up — nobody owes anything."}
      </Text>
      {summary.settleUp.map((t) => (
        <View key={`${t.from}>${t.to}`} style={s.xfer}>
          <Avatars members={person(t.from).members} size={19} />
          <Text style={{ color: C.soft, fontSize: 9 }}>→</Text>
          <Avatars members={person(t.to).members} size={19} />
          <View style={{ flex: 1, marginLeft: 2 }}>
            <Text style={{ fontSize: 8.5, fontWeight: 600 }}>
              {person(t.from).name} {person(t.from).members.length === 1 ? "pays" : "pay"} {person(t.to).name}
            </Text>
            {t.amounts.length > 1 || t.amounts[0]?.currency !== summary.home ? (
              <Text style={{ fontSize: 6.5, color: C.muted }}>{approx(t.approx)} in total</Text>
            ) : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            {t.amounts.map((m) => (
              <Text key={m.currency} style={{ fontSize: 10.5, fontWeight: 700 }}>{money(m)}</Text>
            ))}
          </View>
        </View>
      ))}
      {n ? <Text style={s.note}>Fewest transfers for the group. Each amount is exact in its own currency; payments already made are taken into account.</Text> : null}
    </View>
  );
}

function Facts({ summary, approx }: Ctx & { summary: TripSummary }) {
  const rows: Array<[string, string]> = [
    ["Total trip cost", approx(summary.totals.approx)],
    ["Per person", approx(summary.totals.perPerson)],
    ["Shared costs", String(summary.totals.costCount)],
    ["Payments made", String(summary.totals.paymentCount)],
  ];
  return (
    <View style={[s.card, { flexGrow: 1, paddingVertical: 6 }]} wrap={false}>
      {rows.map(([k, v], i) => (
        <View key={k} style={[s.fact, { flexGrow: 1 }, i === rows.length - 1 ? { borderBottomWidth: 0 } : {}]}>
          <Text style={{ color: C.muted, fontSize: 8.5 }}>{k}</Text>
          <Text style={{ fontWeight: 700, fontSize: 10 }}>{v}</Text>
        </View>
      ))}
      {summary.notSplit ? (
        <Text style={s.note}>
          {summary.notSplit} cost{summary.notSplit === 1 ? " isn’t" : "s aren’t"} split yet, so {summary.notSplit === 1 ? "it isn’t" : "they aren’t"} included.
        </Text>
      ) : null}
    </View>
  );
}

function Balances({ summary, person, approx }: Ctx & { summary: TripSummary }) {
  const avatarCol = Math.max(...summary.people.map((p) => groupWidth(p.members.length, 17)), 17) + 8;
  return (
    <View style={[s.card, { marginTop: 9 }]} wrap={false}>
      <Text style={s.h2}>Everyone’s balance</Text>
      <View style={{ flexDirection: "row", paddingHorizontal: 5, paddingBottom: 4 }}>
        <Text style={[s.th, { flex: 1, marginLeft: avatarCol }]}>Person</Text>
        <Text style={[s.th, { width: 78, textAlign: "right" }]}>Paid for</Text>
        <Text style={[s.th, { width: 78, textAlign: "right" }]}>Their share</Text>
        <Text style={[s.th, { width: 178, textAlign: "right" }]}>Balance</Text>
      </View>
      {summary.balances.map((b) => (
        <View key={b.key} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 5.5, paddingHorizontal: 5, borderTopWidth: 1, borderTopColor: C.line }}>
          <View style={{ width: avatarCol }}>
            <Avatars members={person(b.key).members} size={17} />
          </View>
          <Text style={{ flex: 1, fontWeight: 600, fontSize: 8.5 }}>{person(b.key).name}</Text>
          <Text style={{ width: 78, textAlign: "right", fontSize: 8.5 }}>{approx(b.paid)}</Text>
          <Text style={{ width: 78, textAlign: "right", fontSize: 8.5 }}>{approx(b.share)}</Text>
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
      <Text style={s.note}>Positive means they’re owed money; negative means they owe. Payments already made are included.</Text>
    </View>
  );
}

function WhereItWent({ summary, approx }: Ctx & { summary: TripSummary }) {
  const max = summary.categories[0]?.approx || 1;
  const total = summary.totals.approx || 1;
  return (
    <View style={[s.card, { flex: 1 }]} wrap={false}>
      <Text style={s.h2}>Where the money went</Text>
      {summary.categories.length === 0 ? <Text style={{ color: C.muted }}>No shared costs yet.</Text> : null}
      {summary.categories.map((c) => {
        const pct = c.approx / total;
        return (
          <View key={c.key} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2.6 }}>
            <PdfImage src={icon(c.icon)} style={{ width: 11, height: 11 }} />
            <Text style={{ width: 68, fontSize: 8, fontWeight: 500 }}>{c.label}</Text>
            <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: C.bg }}>
              <View style={{ width: `${Math.max(2, (c.approx / max) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: c.color }} />
            </View>
            <Text style={{ width: 54, textAlign: "right", fontSize: 7.5, fontWeight: 600 }}>{approx(c.approx).replace("≈ ", "")}</Text>
            <Text style={{ width: 20, textAlign: "right", fontSize: 7, color: C.soft }}>{pct < 0.005 ? "<1" : Math.round(pct * 100)}%</Text>
          </View>
        );
      })}
    </View>
  );
}

function Upfront({ summary, person, approx }: Ctx & { summary: TripSummary }) {
  const shown = summary.upfront.filter((u) => u.approx > 0);
  const colorOf = (key: string) => SERIES[Math.max(0, summary.people.findIndex((p) => p.key === key)) % SERIES.length];
  return (
    <View style={s.card} wrap={false}>
      <Text style={s.h2}>Who paid upfront</Text>
      <View style={{ flexDirection: "row", height: 9, borderRadius: 5, overflow: "hidden", marginBottom: 7, backgroundColor: C.bg }}>
        {shown.map((u) => (
          <View key={u.key} style={{ width: `${u.share * 100}%`, backgroundColor: colorOf(u.key) }} />
        ))}
      </View>
      {shown.map((u) => (
        <View key={u.key} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 1.8 }}>
          <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: colorOf(u.key) }} />
          <Text style={{ flex: 1, fontSize: 8 }}>{person(u.key).name}</Text>
          <Text style={{ fontSize: 8, fontWeight: 600 }}>{approx(u.approx)}</Text>
          <Text style={{ width: 24, textAlign: "right", fontSize: 7, color: C.soft }}>{Math.round(u.share * 100)}%</Text>
        </View>
      ))}
      {shown.length === 0 ? <Text style={{ color: C.muted }}>Nobody has paid for anything yet.</Text> : null}
    </View>
  );
}

function Payments({ summary }: { summary: TripSummary }) {
  return (
    <View style={s.card} wrap={false}>
      <Text style={s.h2}>Payments already made</Text>
      {summary.payments.length === 0 ? <Text style={{ color: C.muted }}>No payments recorded yet.</Text> : null}
      {summary.payments.map((p, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 5, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
          <Avatar p={p.from} size={16} />
          <Text style={{ color: C.soft, fontSize: 8 }}>→</Text>
          <Avatar p={p.to} size={16} />
          <View style={{ flex: 1, marginLeft: 2 }}>
            <Text style={{ fontSize: 8 }}>{firstName(p.from.name)} paid {firstName(p.to.name)}</Text>
            <Text style={{ fontSize: 6.5, color: C.muted }}>{[shortDate(p.date), p.note].filter(Boolean).join(" · ")}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 8.5, fontWeight: 700 }}>{money(p)}</Text>
            {p.paid ? <Text style={{ fontSize: 6.5, color: C.muted }}>sent as {money(p.paid)}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function HowItWorks({ summary }: { summary: TripSummary }) {
  return (
    <View wrap={false} style={{ marginTop: 9, borderRadius: 9, backgroundColor: C.bg, padding: 10 }}>
      <Text style={{ fontSize: 7, color: C.muted, lineHeight: 1.45 }}>
        <Text style={{ color: C.ink, fontWeight: 700 }}>How these numbers work. </Text>
        Every cost is split in the currency it was paid in, and balances are exact per currency. ≈ {symbol(summary.home)} figures
        {summary.rates.live && summary.rates.date
          ? ` use the daily rates on ${day(summary.rates.date, { day: "numeric", month: "short", year: "numeric" })}`
          : " use approximate rates"}
        {summary.rates.list.length
          ? ` (${summary.rates.list.filter((r) => r.rate).map((r) => `1 ${r.currency} = ${Number(r.rate!.toPrecision(5))} ${summary.home}`).join(", ")})`
          : ""}{" "}
        and are only a guide.
      </Text>
    </View>
  );
}

// ---- Cost pages -----------------------------------------------------------
const MAX_PERSON_COLUMNS = 5;

function CostPages({ summary, person, approx }: Ctx & { summary: TripSummary }) {
  const people = summary.people;
  const columns = people.length <= MAX_PERSON_COLUMNS;
  const personWidth = columns ? Math.min(62, Math.floor(237 / Math.max(people.length, 1))) : 0;
  // The closing panel's cards: one row for up to three people, 2×2 for four,
  // rows of three beyond that. Width = A4 less page and panel padding.
  const n = summary.balances.length;
  const perRow = n <= 3 ? Math.max(n, 1) : n === 4 ? 2 : 3;
  const cardWidth = Math.floor((595.28 - 72 - 24 - (perRow - 1) * 7) / perRow);
  // Costs follow straight on from the overview (no forced page break, so a
  // long overview doesn't leave most of a page empty). Everything here is a
  // page-level sibling, not nested per category: react-pdf only keeps a
  // heading with what follows (minPresenceAhead) when it has an earlier break
  // point in the same container.
  return (
    <>
      <View wrap={false} minPresenceAhead={110} style={{ marginTop: 18 }}>
        <Text style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.3 }}>Every shared cost</Text>
        <Text style={{ color: C.muted, marginTop: 1, marginBottom: 10 }}>
          Grouped by category{columns ? ", with each person’s share in the cost’s own currency." : "."}
        </Text>
      </View>
      {summary.categories.map((c, ci) => (
        <React.Fragment key={c.key}>
          {/* Header and column headings move to the next page with the first row. */}
          <View wrap={false} minPresenceAhead={40} style={{ marginTop: ci ? 10 : 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 9, backgroundColor: rgba(c.color, 0.08) }}>
            <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: "#ffffff", borderWidth: 1, borderColor: rgba(c.color, 0.25), alignItems: "center", justifyContent: "center" }}>
              <PdfImage src={icon(c.icon)} style={{ width: 14, height: 14 }} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, fontWeight: 700 }}>{c.label}</Text>
              <Text style={{ fontSize: 7, color: C.muted }}>
                {c.costs.length} cost{c.costs.length === 1 ? "" : "s"} · {approx(c.approx)}
              </Text>
            </View>
            <Text style={{ fontSize: 9, fontWeight: 700 }}>{c.totals.map(money).join(" + ")}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 5, paddingTop: 6, paddingBottom: 3 }}>
            <Text style={[s.th, { flex: 1 }]}>Item</Text>
            <Text style={[s.th, { width: 66 }]}>Paid by</Text>
            <Text style={[s.th, { width: 72, textAlign: "right" }]}>Amount</Text>
            {columns ? (
              people.map((p) => (
                <View key={p.key} style={{ width: personWidth, alignItems: "flex-end", gap: 2, paddingLeft: 4 }}>
                  <Avatars members={p.members} size={11} />
                  <Text style={[s.th, { textAlign: "right", maxLines: 2, textOverflow: "ellipsis" }]}>{columnName(p)}</Text>
                </View>
              ))
            ) : (
              <Text style={[s.th, { width: 52, textAlign: "right" }]}>Split</Text>
            )}
          </View>
          </View>
          {c.costs.map((r, i) => (
            <View key={i} wrap={false} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 5, paddingHorizontal: 5, borderTopWidth: 1, borderTopColor: C.line }}>
              <View style={{ flex: 1, flexDirection: "row", gap: 5, paddingRight: 6 }}>
                <PdfImage src={icon(r.icon)} style={{ width: 10, height: 10, marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 8.5, fontWeight: 600 }}>{r.title}</Text>
                  <Text style={{ fontSize: 6.5, color: C.muted }}>{[shortDate(r.date), r.sub].filter(Boolean).join(" · ")}</Text>
                  {r.notes.map((n) => (
                    <Text key={n} style={{ fontSize: 6.5, color: C.primaryDark }}>{n}</Text>
                  ))}
                </View>
              </View>
              <View style={{ width: 66, flexDirection: "row", alignItems: "center", gap: 4 }}>
                {r.paidBy ? <Avatar p={r.paidBy} size={13} /> : null}
                <Text style={{ flex: 1, fontSize: 7.5 }}>
                  {r.paidBy ? firstName(r.paidBy.name) : "—"}
                  {r.otherPayers ? ` +${r.otherPayers}` : ""}
                </Text>
              </View>
              <Text style={{ width: 72, textAlign: "right", fontSize: 8.5, fontWeight: 700 }}>{money(r)}</Text>
              {columns ? (
                people.map((p) => (
                  <Text key={p.key} style={{ width: personWidth, textAlign: "right", fontSize: 8, color: r.shares[p.key] ? C.ink : "#bdc1c6" }}>
                    {r.shares[p.key] ? plain({ currency: r.currency, amount: r.shares[p.key] }) : "—"}
                  </Text>
                ))
              ) : (
                <Text style={{ width: 52, textAlign: "right", fontSize: 7.5, color: C.muted }}>
                  {Object.keys(r.shares).length} way{Object.keys(r.shares).length === 1 ? "" : "s"}
                </Text>
              )}
            </View>
          ))}
        </React.Fragment>
      ))}
      {summary.categories.length === 0 ? <Text style={{ color: C.muted }}>No shared costs yet.</Text> : null}

      <View wrap={false} style={{ marginTop: 14, borderRadius: 11, backgroundColor: C.ink, padding: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <Text style={{ color: "#ffffff", fontSize: 10.5, fontWeight: 700 }}>All shared costs</Text>
          <Text style={{ color: "#ffffff", opacity: 0.75, fontSize: 7.5 }}>
            {summary.totals.costCount} cost{summary.totals.costCount === 1 ? "" : "s"} · {approx(summary.totals.approx)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 9 }}>
          {summary.balances.map((b) => (
            <View key={b.key} style={{ width: cardWidth, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 8, padding: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 3 }}>
                <Avatars members={person(b.key).members} size={14} />
                <Text style={{ color: "#ffffff", fontSize: 8, fontWeight: 600 }}>{person(b.key).name}</Text>
              </View>
              <Text style={{ color: "#ffffff", fontSize: 6.5, opacity: 0.75 }}>Share of costs</Text>
              <Text style={{ color: "#ffffff", fontSize: 11, fontWeight: 700 }}>{approx(b.share)}</Text>
              <Text style={{ color: "#ffffff", fontSize: 6.5, opacity: 0.7 }}>{b.owed.map(money).join(" + ") || "—"}</Text>
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
  const approx = (n: number) => `≈ ${symbol(summary.home)}${Math.round(n).toLocaleString("en-US")}`;
  const ctx = { person, approx };
  // A settle-up card with several transfers leaves room beside it under the
  // facts; "Who paid upfront" fills it rather than lengthen the page. Rough
  // heights in points, erring low for settle-up so the cards never overflow it.
  const settleHeight = 35 + summary.settleUp.length * 37 + (summary.settleUp.length ? 30 : 0);
  const sideHeight = 110 + (summary.notSplit ? 16 : 0) + 9 + 36 + summary.upfront.filter((u) => u.approx > 0).length * 13;
  const upfrontBesideSettle = settleHeight >= sideHeight;
  return (
    <Document title={`${summary.trip.name} — trip summary`} author={summary.preparedBy} creator="Itinerary" producer="Itinerary">
      <Page size="A4" style={s.page}>
        <Footer summary={summary} />
        <Header summary={summary} />
        <View style={s.row}>
          <SettleUp summary={summary} {...ctx} />
          <View style={{ flex: 1, gap: 9 }}>
            <Facts summary={summary} {...ctx} />
            {upfrontBesideSettle ? <Upfront summary={summary} {...ctx} /> : null}
          </View>
        </View>
        <Balances summary={summary} {...ctx} />
        <HowItWorks summary={summary} />
        <View style={s.row}>
          <WhereItWent summary={summary} {...ctx} />
          <View style={{ flex: 1, gap: 9 }}>
            {upfrontBesideSettle ? null : <Upfront summary={summary} {...ctx} />}
            <Payments summary={summary} />
          </View>
        </View>
        <CostPages summary={summary} {...ctx} />
      </Page>
    </Document>
  );
}

/** The finished PDF file. */
export function renderTripSummaryPdf(summary: TripSummary): Promise<Buffer> {
  return renderToBuffer(<TripSummaryDocument summary={summary} />);
}
