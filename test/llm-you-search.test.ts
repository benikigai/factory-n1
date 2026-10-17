import { test } from "node:test";
import assert from "node:assert/strict";
import { createYouSearch } from "../src/llm/you-search.ts";

test("search deduplicates concurrent queries, preserves citations, and enforces its budget", async () => {
  let requests = 0;
  const client = createYouSearch({ apiKey: "fixture-key", maxCalls: 1, fetch: async (url, init) => {
    requests++;
    assert.equal(url, "https://ydc-index.io/v1/search");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(init?.body as string), { query: "warehouse queues", count: 3 });
    return new Response(JSON.stringify({ results: { web: [
      { url: "https://example.com/queues", title: "Queues", snippets: ["Evidence"] },
      { url: "javascript:bad()", title: "Unsafe" },
    ] } }));
  } });
  const [live, cached] = await Promise.all([client.search("warehouse queues"), client.search(" warehouse queues ")]);
  assert.equal(requests, 1);
  assert.equal(live.mode, "live");
  assert.equal(cached.mode, "cache");
  assert.equal(live.sources.length, 1);
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
