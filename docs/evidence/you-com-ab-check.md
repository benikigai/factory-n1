# You.com search: before/after check (2026-10-17 ~12:19 PT)

Same query, two live searches, no model calls: `warehouse packing station bottlenecks queue reduction`. This query produced duplicate articles in the first live checks.

**Pass criteria, fixed before running:** the "after" call returns HTTP 200 with ≥1 source, no duplicate article, non-empty highlights, and a `search_uuid`. **Result: PASS.**

## Before: original settings (`count: 3`, snippets, no boost, no dedupe)
HTTP 200 · search_uuid `8df3aab8-6a17-49d5-bdf2-757d9d56058d` · duplicate articles: **1**

| Source | Boosted domain | Excerpt chars |
|---|---|---|
| https://cyzerg.com/blog/warehouse-packing-station-5-factors-to-consider-to-avoid-bottlenecks/ | no | 1510 |
| https://www.apexwarehousesystems.com/eliminate-bottlenecks-errors-how-to-optimize-your-packing-station-for-peak-efficiency/ | no | 1435 |
| https://articles.cyzerg.com/warehouse-packing-station-5-factors-to-consider-to-avoid-bottlenecks | no | 1510 |

## After: Argon's settings (`boost_domains`, `extraction_mode: highlights` with `total_max_tokens: 1024`, `count: 5` with mirror dedupe → top 3)
HTTP 200 · search_uuid `f9deccdc-438b-4e29-bce8-a8f0557ce866` · latency 0.97 s · duplicate articles: **0**

| Source | Boosted domain | Excerpt chars |
|---|---|---|
| https://synkrato.com/articles/using-simulation-to-reduce-warehouse-bottlenecks/ | no | 802 |
| https://www.logisticsff.com/warehouse-layout-shipping-speed/ | no | 464 |
| https://meshautomationinc.com/automated-warehouse-systems/ | no | 448 |

## What this shows
- **Verified:** the duplicate article is gone. Highlights extraction works with the `total_max_tokens` field and returns shorter, query-focused passages. `search_uuid` and `latency` are recorded as receipts.
- **Not shown:** none of the 10 boosted engineering domains ranked for this query, so the results are still vendor and blog pages. `boost_domains` is a ranking boost, not a filter. Don't claim the research is "grounded in Georgia Tech/MHI/Mecalux" unless a recorded run actually cites those domains.
- **Cost:** Estimated $0.005 per search (published base rate); You.com documents that extraction may add cost, so the 'after' call's cost is not confirmed by this script. No model calls were made.
