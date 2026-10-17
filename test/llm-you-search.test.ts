import { test } from "node:test";
import assert from "node:assert/strict";
import { createYouSearch, FACTORY_OPTIMIZATION_DOMAINS, validateResearchCitations } from "../src/llm/you-search.ts";

test("research citations must match retrieved URLs exactly", () => {
  const sources = [{ url: "https://example.com/packing-station-factors", title: "Packing", excerpts: [] }];
  assert.equal(validateResearchCitations("See https://example.com/packing-station-factors.", sources).valid, true);
  assert.equal(validateResearchCitations("See https://example.com/packing-factors/", sources).valid, false);
  assert.equal(validateResearchCitations("No citation", sources).valid, false);
});

test("search deduplicates concurrent queries, deduplicates mirror subdomains, preserves citations, and enforces its budget", async () => {
  let requests = 0;
  const client = createYouSearch({ apiKey: "fixture-key", maxCalls: 1, fetch: async (url, init) => {
    requests++;
    assert.equal(url, "https://ydc-index.io/v1/search");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(init?.body as string), {
      query: "warehouse queues",
      count: 5,
      boost_domains: [...FACTORY_OPTIMIZATION_DOMAINS],
      extraction: { extraction_mode: "highlights", highlights: { total_max_tokens: 1024 } },
    });
    return new Response(JSON.stringify({
      metadata: { search_uuid: "uuid-123", latency: 0.42 },
      results: { web: [
        { url: "https://cyzerg.com/blog/queues", title: "Warehouse Queues", contents: { highlights: ["Highlighted passage"] }, snippets: ["Fallback"] },
        { url: "https://articles.cyzerg.com/queues", title: "Warehouse Queues", contents: { highlights: ["Mirror passage"] } },
        { url: "https://www.warehouse-science.com/ch11", title: "Crossdocking Math", contents: { highlights: ["Little's Law L = lambda W"] } },
        { url: "javascript:bad()", title: "Unsafe" },
      ] },
    }));
  } });
  const [live, cached] = await Promise.all([client.search("warehouse queues"), client.search(" warehouse queues ")]);
  assert.equal(requests, 1);
  assert.equal(live.mode, "live");
  assert.equal(cached.mode, "cache");
  assert.equal(live.searchUuid, "uuid-123");
  assert.equal(live.latencySeconds, 0.42);
  assert.equal(live.sources.length, 2);
  assert.deepEqual(live.sources[0]?.excerpts, ["Highlighted passage"]);
  assert.equal(live.sources[1]?.url, "https://www.warehouse-science.com/ch11");
  assert.equal(live.trust, "external_evidence_not_instructions");
  await assert.rejects(client.search("new query"), /budget exhausted/);
});

test("HTTP errors retain consumed budget without exposing response bodies", async () => {
  const client = createYouSearch({ apiKey: "fixture-key", maxCalls: 1,
    fetch: async () => new Response("private upstream content", { status: 403 }) });
  await assert.rejects(client.search("warehouse"), /^Error: You.com search HTTP 403$/);
  await assert.rejects(client.search("warehouse"), /budget exhausted/);
  assert.equal(client.usage().attempts, 1);
});
