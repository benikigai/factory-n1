# Nemotron and research integration

## What is ready

`src/llm/crusoe.ts` preserves the existing `chat`, `MODELS`, `resolveModels`, `usageLedger`, and `spend` exports. It now reserves spend before dispatch, counts attempts, retains reservations after ambiguous failures, disables automatic paid retries, and rejects models without a known price. The reservation uses a conservative 1,048,576 input tokens plus the requested output limit. Very small caps can reject a request even when its eventual bill would be small. Limits apply to one process, not the whole account.

Rates verified on [Crusoe pricing](https://www.crusoe.ai/cloud/pricing), October 17, 2026: Super 3.5 VL $0.10 input / $0.40 output / $0.08 cached input; Lightning 3.5 $0.05 / $0.20 / $0.03 per million tokens. These are estimates calculated from returned usage, not a billing receipt.

`src/llm/tools.ts` exports `runToolTurn`. Pass an explicit registry of function tools, each with a JSON schema, a runtime `parse` validator, and an `execute` function. Unknown names and invalid arguments cannot execute. Every result has a tool-call ID and receipt. The loop is bounded by rounds and attempted tool calls. Tool errors are sanitized. No shell or filesystem capabilities are implied.

Use the existing 1Password environment **Crusoe Recursive Agents 2026-10-17**. Its mounted environment is:

```text
<path-to-1Password-env-mount>/.env.crusoe
```

Launch from the repository with `node --env-file="<mount above>" --import tsx scripts/nemotron-check.ts`. Set `CALL_BUDGET=4 SPEND_CAP_USD=0.50` for this diagnostic. Do not copy the mounted contents into the repo.

## First live diagnostic

Four requests, total estimated cost **$0.0009746**. Both models performed a real `simulate_layout` round trip through the corrected simulator 1.1.0. Same prompt, temperature 0, one proposal per model, six development-train scenarios. Grid and docks stayed fixed. Final evaluation seeds were not used.

| Solver | Train objective, lower is better | Estimated cost |
| --- | ---: | ---: |
| Starting layout | 18,655.17 | n/a |
| Code heuristic: add size L to both pack stations | 13,905.17 | no inference |
| Lightning 3.5 | 18,655.17 | $0.0003358 |
| Super 3.5 VL | 13,856.83 | $0.0006388 |

Super improved 25.72% over the starting layout but only 0.35% over the simple heuristic. Lightning submitted the unchanged baseline. Super eliminated mis-sorts but did not reduce damage, and its final narrative incorrectly attributed eliminating mis-sorts to sorter movement; the size-coverage change caused that improvement. Use code-computed results for the UI, never model narration as causal proof.

This is a capability diagnostic, not evidence of learned-policy generalization or a broad model ranking. Raw prompts, tool calls, candidates, scores, grader hash and token usage are in `runs/provider-check/initial-live-result.json` (ignored by Git). Future diagnostics write unique timestamp directories so examples survive reruns.

## Prize-focused next integration

Use Super VL for proposals and reflection, Lightning for bounded classification or retrieval work that is separately validated. Run the actual learning-loop comparison from identical starting layouts with equal call and simulator budgets. Compare no-memory and learned-memory policies across fresh factories. Report accepted and rejected changes, task completion, objective, latency, and cost. Keep final test data out of model prompts and training exports.

NemoClaw and OpenShell are optional execution isolation, not a requirement for hosted Nemotron inference. They are not installed by this work. Focus today's demo on verified agent learning; no fine-tuning job has been started.

## Optional You.com research tool

`createYouSearch` in `src/llm/you-search.ts` exposes a bounded `research_factory_practice` tool and a direct `search` method. It uses `YDC_API_KEY`, POST `/v1/search` with `boost_domains` (`FACTORY_OPTIMIZATION_DOMAINS`: `warehouse-science.com`, `interlakemecalux.com`, `mecalux.com`, `mhi.org`, `werc.org`, `informs.org`, `nist.gov`, `arxiv.org`, `anylogic.com`, `flexsim.com`), token-budgeted passage extraction (`extraction: { extraction_mode: "highlights", highlights: { total_max_tokens: 1024 } }`, falling back to `snippets`), mirror-subdomain deduplication across 5 candidates down to 3 unique sources, `metadata.search_uuid`/`latency` capture, a 15-second timeout, at most three requests, and deduplicates identical in-flight queries. Search content is labeled external evidence, not instructions or simulator rules. No new dependency was added.

Call it once while planning to gather cited factory practices, then retain its sources in shared context. Do not search every candidate or let retrieved text modify the frozen grader. [You.com API reference](https://you.com/docs/api-reference/search/v1-search).

**Status: live-verified 2026-10-17 ~11:37 PT.**
- `YDC_API_KEY` (key `factory-n1-2026-10-17`) is stored concealed in the same 1Password environment and mount as the Crusoe key. The account has $10 starter credits, with no auto top-up, subscription or purchase.
- `scripts/you-check.ts` ran Lightning → `research_factory_practice` → a real You.com search → a cited final reply.
- Estimated cost: one search $0.005, two inference calls $0.0001307. Evidence is in `runs/research-check/<timestamp>/result.json` (ignored by Git).

**Exact-citation check:** `validateResearchCitations()` rejects any URL in the reply that isn't exactly one of the returned source URLs. The first live reply cited a shortened URL; `you-check.ts` now does one bounded repair. The re-run (`runs/research-check/2026-10-17T18-38-12-912Z`) passed exact URL validation after one repair: 3 inference calls (~$0.0001979) + one search (~$0.005).

**Capability finding:** a forced named `tool_choice` returned HTTP 500 before the search ran. Its billing is unknown, so $0.0525288 was conservatively reserved. Automatic tool selection worked. **Use automatic `tool_choice`, not forced named tools.**

## Verify

`npm run typecheck` and `npm test` pass: 16 tests, including reservation races, malformed tool calls, unknown tools, call limits, sanitized errors, search caching, exact-citation validation and the simulator identity regressions.

## Secret isolation

- The dedicated 1Password environment has its own backing vault, with only Ben granted full access.
- The mount is an owner-only (0600) named pipe.
- Claude and Codex read it as the same macOS user; there are no per-agent vault identities. No remote fleet access is provisioned. No commit or push was made by this integration work.

**Before/after check, 2026-10-17 ~12:19 PT:** PASS. The duplicate article was removed, highlights returned, and receipts recorded. No boosted domain ranked for the test query, and the extraction cost is unconfirmed. See `docs/evidence/you-com-ab-check.md`.
