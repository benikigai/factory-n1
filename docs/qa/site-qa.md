# Browser QA Report — Engineering Drafting Sheet + Nemotron Visual Inspector (`127.0.0.1:5190`, `ab91569`)

- **Target Build Evaluated**: `http://127.0.0.1:5190/` (`codex/final-site` PR #2 commit `ab91569` — merging Claude's engineering drafting-sheet landing page `1f84559` + Codex's verified `Nemotron-3.5-Super-VL` visual inspector `b75a31e`)
- **QA Date**: 2026-10-17 (`14:29 PT`)
- **Browser Engine**: Headless Chromium (Playwright, `deviceScaleFactor: 2`) with WebGL / Three.js `CSS2DRenderer` active
- **Viewports Tested**: `1440 × 900`, `1280 × 720`, `390 × 844`
- **Routes Tested**:
  1. `/?speed=60` — Engineering drafting-sheet landing page (`#top`, `#revisions`, `#inspection`, `#bom`, `#evidence-section`)
  2. `/replay.html?run=live-a-11` — 3D Factory Floor (`Gen-0 baseline` vs. `Agent champion (g1-route)`)
  3. `/replay.html?run=live-a-11&view=visual` — Verified `Nemotron-3.5-Super-VL` Visual Inspector (`IMAGE CHECK: 678D59` canary + deterministic tool receipts)
  4. `/replay.html?run=live-a-7&view=agents` — Agent Workflow 3D floor & inspector (`live-a-7`)

---

## 1. Automated & Visual Health Summary (`127.0.0.1:5190` at `ab91569`)

| Viewport | Route | Console / Page Errors | Network `>=400` | Horizontal Overflow | Clipped / Overlapping 3D Labels | Truncated Elements | WebGL FPS | Screenshot |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **`1440×900`** | `/?speed=60` (Drafting Sheet) | `0` | `0` | `0 px` | **`0` / `0`** | **`0`** | `62 fps` | [`landing-1440x900.jpg`](screenshots/landing-1440x900.jpg) |
| **`1440×900`** | `/replay.html?run=live-a-11` | `0` | `0` | `0 px` | `0` / `0` | `4` | `61 fps` | [`replay-layout-1440x900.jpg`](screenshots/replay-layout-1440x900.jpg) |
| **`1440×900`** | `/replay.html?run=live-a-11&view=visual` | `0` | `0` | `0 px` | `1` (`ship-A` right edge) / `0` | `0` | `62 fps` | [`replay-visual-1440x900.jpg`](screenshots/replay-visual-1440x900.jpg) |
| **`1440×900`** | `/replay.html?run=live-a-7&view=agents` | **`1` (`404`)** | **`404 inspection.json`** | `0 px` | `0` / `0` | `4` | `62 fps` | [`replay-agents-1440x900.jpg`](screenshots/replay-agents-1440x900.jpg) |
| **`1280×720`** | `/?speed=60` (Drafting Sheet) | `0` | `0` | `0 px` | **`0` / `0`** | **`0`** | `61 fps` | [`landing-1280x720.jpg`](screenshots/landing-1280x720.jpg) |
| **`1280×720`** | `/replay.html?run=live-a-11` | `0` | `0` | `0 px` | `0` / `0` | `4` | `61 fps` | [`replay-layout-1280x720.jpg`](screenshots/replay-layout-1280x720.jpg) |
| **`1280×720`** | `/replay.html?run=live-a-11&view=visual` | `0` | `0` | `0 px` | `1` / `0` | `0` | `61 fps` | [`replay-visual-1280x720.jpg`](screenshots/replay-visual-1280x720.jpg) |
| **`1280×720`** | `/replay.html?run=live-a-7&view=agents` | **`1` (`404`)** | **`404 inspection.json`** | `0 px` | `0` / `0` | `4` | `62 fps` | [`replay-agents-1280x720.jpg`](screenshots/replay-agents-1280x720.jpg) |
| **`390×844`** | `/?speed=60` (Drafting Sheet) | `0` | `0` | `0 px` | **`0` / `0`** | **`0`** | `63 fps` | [`landing-390x844.jpg`](screenshots/landing-390x844.jpg) |
| **`390×844`** | `/replay.html?run=live-a-11` | `0` | `0` | `0 px` | **`8` clipped / `17` overlaps** | `3` | `61 fps` | [`replay-layout-390x844.jpg`](screenshots/replay-layout-390x844.jpg) |
| **`390×844`** | `/replay.html?run=live-a-11&view=visual` | `0` | `0` | `0 px` | **`8` clipped / `17` overlaps** | `1` | `63 fps` | [`replay-visual-390x844.jpg`](screenshots/replay-visual-390x844.jpg) |
| **`390×844`** | `/replay.html?run=live-a-7&view=agents` | **`1` (`404`)** | **`404 inspection.json`** | `0 px` | `0` / `0` | `3` | `62 fps` | [`replay-agents-390x844.jpg`](screenshots/replay-agents-390x844.jpg) |

---

## 2. What Improved in the Drafting-Sheet + Visual Inspector Build (`ab91569`)

1. **Landing Page (`/?speed=60`) is Now `0` Errors, `0` Clips, `0` Overlaps, `0` Truncations Across All 3 Viewports (`1440×900`, `1280×720`, `390×844`)**:
   - The new engineering drafting-sheet layout ([`landing-1440x900.jpg`](screenshots/landing-1440x900.jpg), [`landing-revisions-1440x900.jpg`](screenshots/landing-revisions-1440x900.jpg), [`landing-inspection-1440x900.jpg`](screenshots/landing-inspection-1440x900.jpg), [`landing-bom-1440x900.jpg`](screenshots/landing-bom-1440x900.jpg)) completely fixed the earlier P1 dark-on-dark `.step-idx` contrast issue by replacing the dark green cards with crisp ink-on-vellum hairline typography (`01 Goal → 02 Research → 03 Design → 04 Simulate → 05 Gate → 06 Remember`).
   - Section `01 Revision history` (`#revisions`) and Section `02 Why it can be trusted` (`#inspection`) put `6,083` (equal budget), `4/7 → 0/7` (fabricated re-run caught), and `0 of 4` (shared memory negative result) side-by-side in a single scannable row.
2. **Verified `Nemotron-3.5-Super-VL` Visual Inspector (`/replay.html?run=live-a-11&view=visual`) Renders Cleanly**:
   - Shows the `Image input verified` badge, `Crusoe Managed Inference` (`nvidia/NVIDIA-Nemotron-3.5-Super-VL`), the `IMAGE CHECK: 678D59` canary frame thumbnail, and expandable deterministic tool receipts ([`replay-visual-1440x900.jpg`](screenshots/replay-visual-1440x900.jpg)).

---

## 3. Ranked, Specific Fixes (`P0` → `P3`)

### P0 — Console `404` on `/runs/<runId>/inspection/inspection.json` When Opening Any Run Other Than `live-a-11`
- **Where**: `/replay.html?run=live-a-7&view=agents` (and any `live-a-5`, `live-a-7`, `live-a-8`, or `memeval-*` run in `replay.html`).
- **Measured Evidence**:
  - Navigating to `/replay.html?run=live-a-7&view=agents` logs a console error:
    `Failed to load resource: the server responded with a status of 404 (File not found) — http://127.0.0.1:5190/runs/live-a-7/inspection/inspection.json`
  - Only `live-a-11` has a recorded `inspection/inspection.json` bundle, so unconditional `fetch('./runs/' + runId + '/inspection/inspection.json')` triggers a network `404` on `live-a-7` (which is used for Shot 3 `0:15–0:30` in the demo video).
- **Exact Fix (`web/main.ts` or `scripts/build-static.ts`)**:
  - Either gate the `inspection.json` fetch on a manifest flag (`summary.hasVisualInspection` or `runId === 'live-a-11'`), or write a stub `{ "available": false }` `inspection.json` into the other recorded run folders during `npm run build:static` so `replay.html?run=live-a-7` produces **zero** network `404`s in DevTools.

---

### P1 — Mobile `390px` 3D CSS2D Label Collision (`17` Overlaps) & Viewport Clipping (`8` Clipped) on `/replay.html`
- **Where**: `/replay.html?run=live-a-11` and `/replay.html?run=live-a-11&view=visual` at `390×844` ([`replay-layout-390x844.jpg`](screenshots/replay-layout-390x844.jpg), [`replay-visual-390x844.jpg`](screenshots/replay-visual-390x844.jpg)).
- **Measured Evidence**:
  - While the landing page `#hero-scene` at `390px` ([`landing-390x844.jpg`](screenshots/landing-390x844.jpg)) has **0 clipped / 0 overlapping labels**, full `/replay.html` at `390px` still renders all `.st-label` and full-width `.floor-name` / `.floor-counters` badges across both side-by-side floors (`left: -31px` to `right: 421px > 390px`, `17` pairwise collisions).
- **Exact Fix (`web/style.css`)**:
  ```css
  @media (max-width: 640px) {
    .st-label {
      display: none;
    }
    .floor-name,
    .floor-counters {
      font-size: 9.5px;
      padding: 2px 6px;
      max-width: 44vw;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
  ```

---

### P2 — Right-Edge Clipping of `ship-A zone A` Label on Desktop `/replay.html` (`1440×900` & `1280×720`)
- **Where**: `/replay.html?run=live-a-11&view=visual` (and `/replay.html?run=live-a-11`) on the right edge of the 3D stage next to `#rail` ([`replay-visual-1440x900.jpg`](screenshots/replay-visual-1440x900.jpg)).
- **Measured Evidence**:
  - On the right-hand champion floor, the `ship-A zone A` pill sits at the far right corner of the 3D floor and clips slightly under the `#rail` border (`ship-A zo...`).
- **Exact Fix (`web/src/scene.ts` / `web/style.css`)**:
  - Nudge the default `overview` camera target `x` by `+0.6` (or increase `overview` distance by `1.05×`) so `ship-A zone A` has `~16px` of breathing room to the left of `#rail`.

---

### P3 — Right-Rail Text Truncation (`...`) & `?speed=60` Query Support on `/replay.html`
- **Where**: `/replay.html?run=live-a-11` right rail (`#rail`) at `1440×900` and `1280×720` ([`replay-layout-1440x900.jpg`](screenshots/replay-layout-1440x900.jpg)).
- **Measured Evidence**:
  - `.live-title` truncates `Agent champion (g1-route)` as **`Agent champion (g1...`** (`136px < 173px`), and two comparator table labels truncate (`Code heuristic: pack stati...`, `Fresh random hill-climber...`).
  - Additionally, `/replay.html` still ignores `?speed=60` in the URL query string (defaulting to `16×` unless toggled in the bottom-left dropdown).
- **Exact Fix (`web/ui/panel.ts` & `web/main.ts`)**:
  - Shorten `.live-title` to `Champion (${champion.id})` and parse `?speed=` in `web/main.ts`.
