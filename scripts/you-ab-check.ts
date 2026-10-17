// Live before/after check of the You.com search settings, same query, 2 searches, no model calls.
//   before: the original request (POST /v1/search {query, count: 3}, snippets)
//   after:  createYouSearch() (boost_domains, highlights extraction, count 5 + mirror dedupe, search_uuid/latency)
// Pass criteria are fixed before running: after returns HTTP 200 with >=1 source, no duplicate article,
// non-empty highlights, and a search_uuid. Boosted-domain hits are reported, not required (boost != filter).
// Usage: node --env-file=<secret mount> --import tsx scripts/you-ab-check.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { createYouSearch, FACTORY_OPTIMIZATION_DOMAINS } from "../src/llm/you-search.ts";

const QUERY = "warehouse packing station bottlenecks queue reduction"; // produced cyzerg.com + articles.cyzerg.com duplicates on 2026-10-17
const key = process.env.YDC_API_KEY;
if (!key) throw new Error("YDC_API_KEY missing from the mounted environment");

const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");
const boosted = (u: string) => FACTORY_OPTIMIZATION_DOMAINS.some((d) => host(u) === d || host(u).endsWith(`.${d}`));
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const dupTitles = (titles: string[]) => titles.length - new Set(titles.map(norm)).size;

// BEFORE: exactly the original adapter's request body.
const t0 = Date.now();
const res = await fetch("https://ydc-index.io/v1/search", {
  method: "POST",
  headers: { "X-API-Key": key, "Content-Type": "application/json" },
  body: JSON.stringify({ query: QUERY, count: 3 }),
  signal: AbortSignal.timeout(15_000),
});
const beforeMs = Date.now() - t0;
const beforeData = (await res.json()) as { results?: { web?: { url: string; title: string; snippets?: string[] }[] }; metadata?: Record<string, unknown> };
const beforeWeb = (beforeData.results?.web ?? []).slice(0, 3);
const before = {
  settings: { count: 3, extraction: "none (snippets)", boost_domains: "none", dedupe: "none" },
  http: res.status,
  wallMs: beforeMs,
  searchUuid: beforeData.metadata?.search_uuid ?? null,
  sources: beforeWeb.map((w) => ({ url: w.url, title: w.title, boosted: boosted(w.url), excerptChars: (w.snippets ?? []).join(" ").length })),
  duplicateArticles: dupTitles(beforeWeb.map((w) => w.title)),
  costHeaders: Object.fromEntries([...res.headers].filter(([k]) => /cost|credit|usage|billing|price/i.test(k))),
};

// AFTER: the new adapter as committed for the loop.
const search = createYouSearch({ maxCalls: 1 });
const t1 = Date.now();
let after: Record<string, unknown>;
let pass = false;
try {
  const r = await search.search(QUERY);
  const highlightChars = r.sources.map((s) => s.excerpts.join(" ").length);
  after = {
    settings: { count: 5, extraction: "highlights (total_max_tokens 1024)", boost_domains: FACTORY_OPTIMIZATION_DOMAINS, dedupe: "mirror subdomains" },
    http: 200,
    wallMs: Date.now() - t1,
    searchUuid: (r as any).searchUuid ?? null,
    latencySeconds: (r as any).latencySeconds ?? null,
    sources: r.sources.map((s, i) => ({ url: s.url, title: s.title, boosted: boosted(s.url), excerptChars: highlightChars[i] })),
    duplicateArticles: dupTitles(r.sources.map((s) => s.title)),
  };
  pass = r.sources.length >= 1 && (after.duplicateArticles as number) === 0 && highlightChars.some((n) => n > 0) && Boolean((r as any).searchUuid);
} catch (e) {
  after = { error: String((e as Error).message).slice(0, 200), wallMs: Date.now() - t1 };
}

const out = {
  kind: "you.com before/after check", query: QUERY, checkedAt: new Date().toISOString(), before, after, pass,
  searches: 2,
  costNote: "Estimated $0.005 per search (published base rate); You.com documents that extraction may add cost, so the 'after' call's cost is not confirmed by this script. No model calls were made.",
};
const dir = `runs/research-check/ab-${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/result.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ saved: `${dir}/result.json`, pass, before, after }, null, 2));
if (!pass) process.exitCode = 1;
