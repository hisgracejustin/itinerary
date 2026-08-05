/**
 * Tiny soft-markdown renderer for option notes: **bold**, bullet lines (- or *),
 * numbered lines (1. ), and plain paragraphs. Escapes HTML first so user content
 * can't inject markup. List/paragraph spacing uses inline styles so it renders
 * even when Tailwind hasn't scanned class names inside this string.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineBold(escaped) {
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

const UL_STYLE = "list-style:disc;padding-left:1.25rem;margin:0.35em 0";
const OL_STYLE = "list-style:decimal;padding-left:1.25rem;margin:0.35em 0";
const P_STYLE = "margin:0.2em 0;white-space:pre-wrap";
const LI_STYLE = "margin:0.15em 0";

/** @returns {string} Safe HTML fragment */
export function renderSoftMarkdown(text) {
  if (!text || !String(text).trim()) return "";
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const parts = [];
  /** @type {{ kind: 'ul' | 'ol', items: string[] } | null} */
  let list = null;

  const flushList = () => {
    if (!list) return;
    const style = list.kind === "ul" ? UL_STYLE : OL_STYLE;
    parts.push(
      `<${list.kind} style="${style}">${list.items.join("")}</${list.kind}>`,
    );
    list = null;
  };

  const pushItem = (kind, body, number = null) => {
    if (!list || list.kind !== kind) {
      flushList();
      list = { kind, items: [] };
    }
    list.items.push(
      `<li${number == null ? "" : ` value="${number}"`} style="${LI_STYLE}">${inlineBold(escapeHtml(body))}</li>`,
    );
  };

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      pushItem("ul", bullet[1]);
      continue;
    }
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      pushItem("ol", numbered[2], Number(numbered[1]));
      continue;
    }
    flushList();
    if (!line.trim()) {
      parts.push('<div style="height:0.5rem" aria-hidden="true"></div>');
      continue;
    }
    parts.push(`<p style="${P_STYLE}">${inlineBold(escapeHtml(line))}</p>`);
  }
  flushList();
  return parts.join("");
}
