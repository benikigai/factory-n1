/** Tiny DOM builder. All bundle text goes through textContent, never innerHTML (it can be model output). */
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) continue;
      if (k === "class") el.className = String(v);
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** Only http(s) links are clickable; anything else renders as inert text. */
export function safeLink(url: string, text?: string): HTMLElement {
  let ok = false;
  try {
    const u = new URL(url);
    ok = u.protocol === "https:" || u.protocol === "http:";
  } catch {
    ok = false;
  }
  if (!ok) return h("span", { class: "bad-url", title: "not an http(s) URL" }, url);
  return h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, text ?? url);
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtDelta(d: number, digits = 0): string {
  if (!Number.isFinite(d)) return "—";
  const s = fmtNum(Math.abs(d), digits);
  return d > 0 ? `+${s}` : d < 0 ? `−${s}` : "±0";
}
