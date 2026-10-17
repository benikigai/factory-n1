# Browser QA Report — Final Combined Site (`codex/final-site`)

- **Target Build Evaluated**: `/Users/bshyong/Code/factory-n1-final/web/dist` (`codex/final-site`, commit `58ad323` — *"Build final combined Factory N+1 site"*)
- **QA Date**: 2026-10-17
- **Browser Engine**: Headless Chromium (Playwright) with WebGL / Three.js `CSS2DRenderer` active
- **Viewports Tested**:
  1. `1440 × 900` (Desktop widescreen / Screen Studio capture viewport)
  2. `1280 × 720` (720p projector / standard laptop viewport)
  3. `390 × 844` (Mobile / narrow responsive viewport)
- **Routes Tested**:
  1. `/` — Argon editorial landing page + embedded live Three.js split hero (`#hero-scene`) + 3-way prototype shootout + 5-stage pipeline
  2. `/replay.html?run=live-a-7` — 3D Factory Floor (`Gen-0 baseline` vs. `Agent champion`) + frozen evaluator rail + baseline scoreboard
  3. `/replay.html?run=live-a-7&view=agents&node=designers` — Agent Workflow SVG DAG + `Lightning Caught & Refuted` callout + `Lessons JSON` modal trigger

---

## 1. Automated & Visual Health Summary

| Viewport | Route | Console / Page Errors | Network `>=400` | Document Horizontal Overflow | Measured WebGL FPS | Screenshot |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **`1440×900`** | `/` (Landing) | `0` | `0` | `0 px` (`1440 / 1440`) | `61 fps` | [`landing-1440x900.jpg`](screenshots/landing-1440x900.jpg) |
| **`1440×900`** | `/replay.html?run=live-a-7` | `0` | `0` | `0 px` (`1440 / 1440`) | `61 fps` | [`replay-layout-1440x900.jpg`](screenshots/replay-layout-1440x900.jpg) |
| **`1440×900`** | `/replay.html?run=live-a-7&view=agents&node=designers` | `0` | `0` | `0 px` (`1440 / 1440`) | `60 fps` | [`replay-agents-1440x900.jpg`](screenshots/replay-agents-1440x900.jpg) |
| **`1280×720`** | `/` (Landing) | `0` | `0` | `0 px` (`1280 / 1280`) | `61 fps` | [`landing-1280x720.jpg`](screenshots/landing-1280x720.jpg) |
| **`1280×720`** | `/replay.html?run=live-a-7` | `0` | `0` | `0 px` (`1280 / 1280`) | `61 fps` | [`replay-layout-1280x720.jpg`](screenshots/replay-layout-1280x720.jpg) |
| **`1280×720`** | `/replay.html?run=live-a-7&view=agents&node=designers` | `0` | `0` | `0 px` (`1280 / 1280`) | `63 fps` | [`replay-agents-1280x720.jpg`](screenshots/replay-agents-1280x720.jpg) |
| **`390×844`** | `/` (Landing) | `0` | `0` | `0 px` (`390 / 390`) | `61 fps` | [`landing-390x844.jpg`](screenshots/landing-390x844.jpg) |
| **`390×844`** | `/replay.html?run=live-a-7` | `0` | `0` | `0 px` (`390 / 390`) | `61 fps` | [`replay-layout-390x844.jpg`](screenshots/replay-layout-390x844.jpg) |
| **`390×844`** | `/replay.html?run=live-a-7&view=agents&node=designers` | `0` | `0` | `0 px` (`390 / 844`) | `62 fps` | [`replay-agents-390x844.jpg`](screenshots/replay-agents-390x844.jpg) |

### What Works Well in the Combined Build
- **All 5 Judge-Review Priorities Landed in `replay.html`**:
  - The top bar has a one-click **`Lessons JSON`** button that opens the shared-memory artifact (`VER-g1`, `VER-g2`) and explicitly surfaces the `0/4` fresh-factory transfer caveat.
  - The right rail on `/replay.html?run=live-a-7` includes the **`Baseline comparison`** table (`Gen-0 baseline 18,061`, `Code heuristic 13,194`, `Random search (41 evals) 13,099`, `Shared memory (fresh A/B) Lost 4/4`, `Agent champion (live-a-7) 6,083 (-66.3%)`).
  - The `Agent workflow` view (`/replay.html?run=live-a-7&view=agents&node=designers`) highlights a dedicated red callout card: **`Lightning Caught & Refuted`** (`claimed 1,284.7` vs. `frozen evaluator 6,294.75`, `3.9x worse`).
  - The top-left `← Overview` link cleanly navigates back to `/`.
- **60 FPS WebGL Performance & Zero Console/Network Errors**: Both the embedded landing-page Three.js scene (`#hero-scene`) and the full-screen workbench (`#canvas-wrap`) sustain `60–63 fps` with zero failed asset fetches.

---

## 2. Ranked, Specific Fixes (`P0` → `P4`)

### P0 — Mobile `390px` 3D CSS2D Label Collision & Viewport Clipping on `/replay.html`
- **Where**: `/replay.html?run=live-a-7` at `390×844` ([`replay-layout-390x844.jpg`](screenshots/replay-layout-390x844.jpg)) and `/`'s `#hero-scene` at `390×844` ([`landing-390x844.jpg`](screenshots/landing-390x844.jpg)).
- **Symptom**:
  - At `390px` width, both 3D floors (`Gen-0 baseline` and `Agent champion (g1-quality)`) sit side-by-side inside a `390px`-wide canvas.
  - Because `CSS2DRenderer` renders `.st-label`, `.floor-name`, and `.floor-counters` at fixed pixel sizes without responsive scaling, **8 label elements clip outside the `390px` viewport** (`left: -31px` on `Gen-0 baseline`, `right: 413px` on `shipped 0/100 · throughput 0/d · fragile dmg 0`) and the center station pills (`pack-1 SM · ABC`, `pack-2 SM · ABC`, `ship-B zone B`) pile directly on top of one another.
- **Exact Fix (`web/style.css` & `web/src/scene.js`)**:
  1. In `web/style.css`, hide non-selected station pills on narrow screens and compact the floor headers:
     ```css
     @media (max-width: 640px) {
       .st-label {
         display: none;
       }
       .floor-name {
         font-size: 10px;
         padding: 2px 6px;
         max-width: 44vw;
         overflow: hidden;
         text-overflow: ellipsis;
       }
       .floor-counters {
         font-size: 9px;
         padding: 2px 6px;
         max-width: 46vw;
         overflow: hidden;
         text-overflow: ellipsis;
       }
     }
     ```
  2. In `web/src/scene.js` (`preset('overview')`), scale camera distance by `Math.max(1, 1.15 / Math.min(1, aspect))` when `aspect < 0.85` so both floors fit inside portrait mobile viewports without clipping their outer edges.

---

### P1 — Illegible Dark-on-Dark `.step-idx` Stage Headers in Landing Page Pipeline Cards
- **Where**: `/` (Landing page bottom section: *"Research. Propose. Test. Keep. Remember."*) across all 3 viewports (`1440×900`, `1280×720`, `390×844` — see [`landing-1440x900.jpg`](screenshots/landing-1440x900.jpg)).
- **Symptom**:
  - Each of the 5 `.pipeline-step` cards renders a dark green top banner (`background: #0f2926`) while `.step-idx` (`01 / GOAL`, `02 / RESEARCH`, `03 / DESIGN`, `04 / GATE`, `05 / MEMORY`) uses dark teal text (`color: #0f766e`).
  - The resulting contrast ratio is **~1.8:1** (well below WCAG AA `4.5:1`), making the stage numbers nearly invisible on both desktop and mobile.
- **Exact Fix (`web/argon-landing.css`)**:
  - Change `.pipeline-step .step-idx` text color to crisp mint/white (`#ecfdf5` or `#6ee7b7`) and increase font-weight to `700`:
    ```css
    .pipeline-step .step-idx {
      color: #a7f3d0;
      background: #0f2926;
      font-weight: 700;
      letter-spacing: 0.06em;
    }
    ```

---

### P2 — Desktop Split-Hero (`#hero-scene`) 3D Station Pill Crowding & Right-Edge Clipping
- **Where**: `/` at `1440×900` ([`landing-1440x900.jpg`](screenshots/landing-1440x900.jpg)) and `1280×720` ([`landing-1280x720.jpg`](screenshots/landing-1280x720.jpg)).
- **Symptom**:
  - Inside the right-hand `#hero-scene` container (`~580px` wide at `1440×900`, `~510px` wide at `1280×720`), the full-size `.st-label` badges (`pack-1 SM · ABC`, `ship-B zone B`, `pack-A SML · A`, `ship-A zone A`) collide in the center seam between the two floors, and `ship-A zone A` clips against the right border of the dark preview card (`right: 1388px` vs container right `1376px`).
- **Exact Fix (`web/style.css`)**:
  - Scope smaller, denser station pills inside `#hero-scene` and hide secondary `.floor-counters` in the landing preview (since the hero already has its own overlay pill):
    ```css
    #hero-scene .st-label {
      font-size: 9px;
      padding: 1px 4px;
      opacity: 0.88;
    }
    #hero-scene .floor-counters {
      display: none;
    }
    ```

---

### P3 — Truncated `Agent champion (g1...` Card Header & `0/100` Cold-Start Counters on `/replay.html`
- **Where**: `/replay.html?run=live-a-7` right rail (`#rail`) at `1440×900` ([`replay-layout-1440x900.jpg`](screenshots/replay-layout-1440x900.jpg)) and `1280×720` ([`replay-layout-1280x720.jpg`](screenshots/replay-layout-1280x720.jpg)).
- **Symptom**:
  1. In the 2-column `.compare-cards` grid inside the `380px` right rail, the green champion card title truncates with an ellipsis as **`Agent champion (g1...`** at both `1440×900` and `1280×720`.
  2. When `/replay.html?run=live-a-7` first opens, playback starts at `sim t = 00:00`, so for the first ~30 seconds of real viewing both live counter pills and both right-rail cards display **`shipped 0 / 100`** (`0.0 / day`) until the first parcel traverses the floor.
- **Exact Fix (`web/src/main.js`)**:
  1. Shorten the right-rail card header from `Agent champion (${champion.id})` to **`Champion (${champion.id})`** so `Champion (g1-quality)` fits on a single line without truncation at `1440×900` and `1280×720`.
  2. Initialize `playback.t = 180` (`sim 03:00`) on initial load (or when `?t=` is not specified in the URL) so judges immediately see active parcel queues, non-zero shipped counts, and visible flow divergence between `Gen-0 baseline` and `Champion (g1-quality)`.

---

### P4 — Sub-`11px` Micro-Typography on Status Pills & Workflow Badges
- **Where**: Across `/` and `/replay.html` at all viewports (flagged by automated typography audit: `8` elements on `/`, `9` elements on `/replay.html?run=live-a-7`, `29` elements on `/replay.html?run=live-a-7&view=agents`).
- **Symptom**:
  - `.kind` badges (`EXTERNAL`, `RETIRED`, `KEPT` at `10px`), `.pill` tags (`9px` on mobile), and `.k` key labels (`10px`) drop below `11px`, reducing legibility on a `1280×720` projector stream or compressed video capture.
- **Exact Fix (`web/style.css` & `web/argon-landing.css`)**:
  - Floor all badge/key font sizes at `11px` (`0.6875rem`) with `line-height: 1.25`:
    ```css
    .kind,
    .compare-cards .k,
    .pill,
    .hero-tag {
      font-size: max(11px, 0.6875rem);
    }
    ```

---

## 3. Visual QA Gallery (`1440×900`, `1280×720`, `390×844`)

### Desktop Widescreen (`1440 × 900`)
- **Landing (`/`)**: [`screenshots/landing-1440x900.jpg`](screenshots/landing-1440x900.jpg)
- **3D Factory Floor (`/replay.html?run=live-a-7`)**: [`screenshots/replay-layout-1440x900.jpg`](screenshots/replay-layout-1440x900.jpg)
- **Agent Workflow DAG (`/replay.html?run=live-a-7&view=agents&node=designers`)**: [`screenshots/replay-agents-1440x900.jpg`](screenshots/replay-agents-1440x900.jpg)

### 720p Projector / Laptop (`1280 × 720`)
- **Landing (`/`)**: [`screenshots/landing-1280x720.jpg`](screenshots/landing-1280x720.jpg)
- **3D Factory Floor (`/replay.html?run=live-a-7`)**: [`screenshots/replay-layout-1280x720.jpg`](screenshots/replay-layout-1280x720.jpg)
- **Agent Workflow DAG (`/replay.html?run=live-a-7&view=agents&node=designers`)**: [`screenshots/replay-agents-1280x720.jpg`](screenshots/replay-agents-1280x720.jpg)

### Mobile Portrait (`390 × 844`)
- **Landing (`/`)**: [`screenshots/landing-390x844.jpg`](screenshots/landing-390x844.jpg)
- **3D Factory Floor (`/replay.html?run=live-a-7`)**: [`screenshots/replay-layout-390x844.jpg`](screenshots/replay-layout-390x844.jpg)
- **Agent Workflow DAG (`/replay.html?run=live-a-7&view=agents&node=designers`)**: [`screenshots/replay-agents-390x844.jpg`](screenshots/replay-agents-390x844.jpg)
