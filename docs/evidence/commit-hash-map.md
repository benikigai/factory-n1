# Commit hash map (history rewritten 2026-10-17)

On 2026-10-17 the repository history was rewritten twice with `git filter-branch` and force-pushed, both times approved by Ben: first to remove attribution trailers from commit messages (Interim), then to set the author and committer email on the 16 earliest commits to the GitHub-linked address so every commit shows as benikigai (Current). File contents are identical; only hashes changed. Audits and evidence that cite an old hash map to the new one below. The extra commit `0801aa3` re-points the memory-eval evidence at the rewritten frozen commit.

| Original | Interim | Current | Subject |
|---|---|---|---|
| `657252e` | `1b32370` | `67237fe` | Scaffold Factory N+1: deterministic warehouse sim, DoD checks, Crusoe client |
| `bdefe5e` | `ac02536` | `4bac5aa` | Wire live Crusoe inference: catalog-resolved model IDs, spend caps, simulator tool round-trip |
| `e30b693` | `5d119de` | `e88bd4b` | Fix package-identity bug in simulator; freeze grader (sim 1.1.0) |
| `2080389` | `fd43efe` | `8993389` | Provider slice: spend reservation, typed tool turns, verified Nemotron rates |
| `fc9c78e` | `5f40778` | `ffb95a4` | You.com research adapter live-verified; avoid forced tool_choice |
| `90241f6` | `1ea3a91` | `18877e4` | Validate research citations against returned You.com URLs |
| `edee3b1` | `00ed118` | `72e76d6` | Learning loop: You.com research -> shared memory -> Nemotron designers -> frozen grader -> 3D replay |
| `664906c` | `6d4ed59` | `000e34f` | Hypothesis tests: one strict-JSON repair before giving up |
| `57a012c` | `dd271f7` | `886ad9c` | Five fixed-dock factories (A-E) for learning, gating and held-out final |
| `a0e818e` | `5ab5186` | `85bb247` | Demo polish: hero run live-a-5, static site build, README and evidence |
| `2a1561d` | `0d28bbc` | `22c8090` | You.com: boost_domains, highlights extraction, mirror dedupe, search receipts |
| `d0f6c4d` | `9251af9` | `2e33923` | Lock memory-vs-no-memory experiment; fix damage attribution and rejected-lesson labels |
| `05265c2` | `0e50234` | `29103a2` | Experiment: equal hard per-arm caps, per-pair persistence, final-split labels |
| `cd7435a` | `7878a11` | `c21436e` | Hard per-run caps at the point of use (calls at dispatch, sims at evaluate) |
| `416f37a` | `80abdb3` | `fc328ae` | Memory-eval marked INVALID (infrastructure); byte-bounded reservations; budget reconciliation |
| `cc65ee1` | `19bde5d` | `7ba2bc5` | Show verified results: live-a-7 hero, no valid memory result, spend accounting |
| `de4c72c` | `2b72ae0` | `dffcf27` | Demo script: verified live-a-7 numbers and honest memory status |
| `b91e231` | `2dd8556` | `0d47833` | Fail-fast: transient retry, pair-level INCOMPLETE, budget abort |
| `ea302ce` | `8a8e8c5` | `3336bbc` | Memory vs no-memory: valid result, negative (0W/0T/4L), published for verification |
| `6586d9e` | `dfd79d2` | `49c4a3c` | README: current returned-usage spend |
