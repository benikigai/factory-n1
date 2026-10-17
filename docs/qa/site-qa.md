# Browser QA Report — Final Combined Site (`127.0.0.1:5190`, PR #1 `d337dab`)

- **Target Build Evaluated**: `http://127.0.0.1:5190/` (`codex/final-site` PR #1, commit `d337dab` — *"Hide hero station labels and allow video playback speed"*)
- **QA Date**: 2026-10-17 (Post-Rewrite Final Pass)
- **Browser Engine**: Headless Chromium (Playwright, `deviceScaleFactor: 2`) with WebGL / Three.js `CSS2DRenderer` active
- **Viewports Tested**:
  1. `1440 × 900` (Desktop widescreen / Screen Studio capture viewport)
  2. `1280 × 720` (720p projector / standard laptop viewport)
  3. `390 × 844` (Mobile / narrow responsive viewport)
- **Routes Tested**:
  1. `/?run=live-a-7&speed=60` — Landing page with embedded Three.js split hero (`#hero-scene` at `60×`), 5-stage pipeline, proof charts, and track cards
  2. `/replay.html?run=live-a-7` — 3D Factory Floor (`Gen-0 baseline` vs. `Agent champion (g1-quality)`) + frozen evaluator rail + baseline comparison table
  3. `/replay.html?run=live-a-7&view=agents&node=designers` — Agent Workflow view + `Lightning Caught & Refuted` callout + `Lessons JSON` modal trigger

---

## 1. Automated & Visual Health Summary (`127.0.0.1:5190`)

| Viewport | Route | Console / Page Errors | Network `>=400` | Doc Horizontal Overflow | Clipped / Overlapping 3D Labels | Truncated Text Elements | WebGL FPS | Screenshot |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **`1440×900`** | `/?run=live-a-7&speed=60` | `0` | `0` | `0 px` (`1440/1440`) | **`0` / `0`** *(Fixed in `d337dab`)* | `0` | `62 fps` | [`landing-1440x900.jpg`](screenshots/landing-1440x900.jpg) |
| **`1440×900`** | `/replay.html?run=live-a-7` | `0` | `0` | `0 px` (`1440/1440`) | `0` / `0` | `4` | `61 fps` | [`replay-layout-1440x900.jpg`](screenshots/replay-layout-1440x900.jpg) |
| **`1440×900`** | `/replay.html?run=live-a-7&view=agents&node=designers` | `0` | `0` | `0 px` (`1440/1440`) | `0` / `0` | `4` | `62 fps` | [`replay-agents-1440x900.jpg`](screenshots/replay-agents-1440x900.jpg) |
| **`1280×720`** | `/?run=live-a-7&speed=60` | `0` | `0` | `0 px` (`1280/1280`) | **`0` / `0`** *(Fixed in `d337dab`)* | `0` | `61 fps` | [`landing-1280x720.jpg`](screenshots/landing-1280x720.jpg) |
| **`1280×720`** | `/replay.html?run=live-a-7` | `0` | `0` | `0 px` (`1280/1280`) | `0` / `0` | `4` | `61 fps` | [`replay-layout-1280x720.jpg`](screenshots/replay-layout-1280x720.jpg) |
| **`1280×720`** | `/replay.html?run=live-a-7&view=agents&node=designers` | `0` | `0` | `0 px` (`1280/1280`) | `0` / `0` | `4` | `61 fps` | [`replay-agents-1280x720.jpg`](screenshots/replay-agents-1280x720.jpg) |
| **`390×844`** | `/?run=live-a-7&speed=60` | `0` | `0` | `0 px` (`390/390`) | **`0` / `0`** *(Fixed in `d337dab`)* | `1` | `63 fps` | [`landing-390x844.jpg`](screenshots/landing-390x844.jpg) |
| **`390×844`** | `/replay.html?run=live-a-7` | `0` | `0` | `0 px` (`390/390`) | **`8` clipped / `17` overlaps** | `4` | `62 fps` | [`replay-layout-390x844.jpg`](screenshots/replay-layout-390x844.jpg) |
| **`390×844`** | `/replay.html?run=live-a-7&view=agents&node=designers` | `0` | `0` | `0 px` (`390/390`) | `0` / `0` | `3` | `60 fps` | [`replay-agents-390x844.jpg`](screenshots/replay-agents-390x844.jpg) |

### Verified Improvements in `d337dab` (`127.0.0.1:5190`)
1. **Landing Hero 3D Station Label Overlap Resolved (`0` clipped, `0` overlaps)**: Hiding `.st-label` inside `#hero-scene` completely eliminated the center-seam label collisions and right-edge clipping on `/` across `1440×900`, `1280×720`, and `390×844` (see [`landing-1440x900.jpg`](screenshots/landing-1440x900.jpg) and [`landing-1280x720.jpg`](screenshots/landing-1280x720.jpg)).
2. **`/?speed=60` Video Hook Parameter Works as Intended**: Loading `/?run=live-a-7&speed=60` starts the landing hero at `60×` (`sim 02:29 / 26:22 · 60×` within 1.5s), immediately showing `shipped 6/100 · damaged 0` on `Agent champion (g1-quality)` while `Gen-0 baseline` remains at `shipped 0/100` with a visible queue bottleneck.
3. **Zero Console/Page Errors, Zero Failed Requests, 60–63 FPS**: All 9 viewport × route tests pass with zero runtime errors and zero document-level horizontal scroll overflow.

---

## 2. Ranked, Specific Fixes Remaining (`P0` → `P3`)

### P0 — Mobile `390px` 3D CSS2D Label Collision (`17` Overlaps) & Viewport Clipping (`8` Clipped) on `/replay.html`
- **Where**: `/replay.html?run=live-a-7` at `390×844` ([`replay-layout-390x844.jpg`](screenshots/replay-layout-390x844.jpg)).
- **Measured Evidence**:
  - While `d337dab` hid `.st-label` inside `#hero-scene` on `/`, full `/replay.html?run=live-a-7` at `390px` still renders all `.st-label`, `.floor-name`, and `.floor-counters` badges at desktop pixel dimensions across two side-by-side floors inside a `390px` canvas.
  - **8 elements clip outside the `390px` viewport**:
    - `Gen-0 baseline` `.floor-name` & `.floor-counters` (`left: -31px`, `right: 222px`)
    - `Agent champion (g1-quality)` `.floor-name` & `.floor-counters` (`left: 168px`, `right: 421px > 390px`)
    - `pack-1 SM · ABC` (`left: -9px`), `pack-2 SM · ABC` (`left: -11px`), `ship-B zone B` (`left: -12px`), `ship-A zone A` (`right: 413px > 390px`)
  - **17 pairwise label overlaps** occur in the center of the canvas (e.g., `Gen-0 baseline` overlaps `Agent champion (g1-quality)` by `1,120 px²`; `pack-1 SM · ABC` overlaps `ship-B zone B` by `987 px²`).
- **Exact Fix (`web/style.css` & `web/src/scene.js`)**:
  1. Apply the same `.st-label` hide rule used on `#hero-scene` to `/replay.html` under `@media (max-width: 640px)` and constrain `.floor-name` / `.floor-counters`:
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
         max-width: 44vw;
         overflow: hidden;
         text-overflow: ellipsis;
       }
     }
     ```
  2. In `web/src/scene.js` (`preset('overview')`), multiply camera distance by `Math.max(1, 1.15 / Math.min(1, aspect))` when `aspect < 0.85` so both floors stay inside the `390px` frustum.

---

### P1 — Low-Contrast Dark-on-Dark `.step-idx` Stage Headers in Landing Page Pipeline Cards (`~1.8:1` Contrast)
- **Where**: `/?run=live-a-7&speed=60` ("FIVE STAGES, ONE MEASURED FEEDBACK LOOP — *Research. Propose. Test. Keep. Remember.*") across `1440×900`, `1280×720`, and `390×844` ([`landing-1440x900.jpg`](screenshots/landing-1440x900.jpg)).
- **Measured Evidence**:
  - Computed style on `.pipeline-step .step-idx` (`01 / GOAL`, `02 / RESEARCH`, `03 / DESIGN`, `04 / GATE`, `05 / MEMORY`) is `color: rgb(15, 118, 110)` (`#0f766e`) on `background-color: rgb(20, 54, 43)` (`#14362b`).
  - Relative luminance contrast ratio is **1.82 : 1** (WCAG AA requires `4.5 : 1`), rendering the stage numbers nearly invisible on dark green bars.
- **Exact Fix (`web/argon-landing.css`)**:
  - Change `.pipeline-step .step-idx` text color to `#a7f3d0` (or `#ecfdf5`), raising contrast to **`9.4 : 1`**:
    ```css
    .pipeline-step .step-idx {
      color: #a7f3d0;
      background-color: #14362b;
      font-weight: 700;
      letter-spacing: 0.06em;
    }
    ```

---

### P2 — Right-Rail Text Truncation (`text-overflow: ellipsis`) on `/replay.html` at `1440×900` & `1280×720`
- **Where**: `/replay.html?run=live-a-7` and `/replay.html?run=live-a-7&view=agents&node=designers` right rail (`#rail`) across all 3 viewports ([`replay-layout-1440x900.jpg`](screenshots/replay-layout-1440x900.jpg), [`replay-layout-1280x720.jpg`](screenshots/replay-layout-1280x720.jpg)).
- **Measured Evidence**:
  - Four key labels in the right rail overflow their container width and clip with `...`:
    1. `.live-title`: **`Agent champion (g1-quality)`** (`scrollWidth: 173px > clientWidth: 136px`, displays as `Agent champion (g1...`).
    2. Baseline table row: **`Code heuristic: pack stations accept all size...`** (`scrollWidth: 262px > clientWidth: 165px`).
    3. Baseline table row: **`Random hill-climber at equal budget (41 sim e...`** (`scrollWidth: 297px > clientWidth: 165px`).
    4. Baseline table row: **`Agent champion (g1-quality)`** (`scrollWidth: 171px > clientWidth: 165px`).
- **Exact Fix (`web/src/main.js` & `web/style.css`)**:
  1. In `web/src/main.js`, shorten the live card title to **`Champion (${champion.id})`** (`Champion (g1-quality)`, `~128px`) and shorten the baseline table labels to **`Code heuristic (all sizes)`** and **`Random search (41 sim runs)`** so every row reads cleanly without ellipsis truncation in the `380px` rail.
  2. Support `?speed=60` in `web/src/main.js` (matching `web/landing.ts`) so `/replay.html?run=live-a-7&speed=60` can also launch directly at `60×` for Screen Studio Beat 1.

---

### P3 — Sub-`11px` Micro-Typography on Status Pills, Metadata Keys & Retired Badges (`9px–10.12px`)
- **Where**: Across `/` (`31` elements on desktop, `44` on mobile) and `/replay.html` (`20–30` elements across viewports).
- **Measured Evidence**:
  - `.pill` (`grader 493a1b03 · SIM 1.1.0` at `10px`, `peak-202 · 100 packages · one clock` at `9px` on mobile), `.hero-tag` (`Starting floor` / `Agents' floor` at `9px` on mobile), `.kind-external` / `.kind-retired` (`10px`), and the `grader` SHA cell (`9.2px`) fall below `11px`.
- **Exact Fix (`web/style.css`, `web/landing.css`, `web/argon-landing.css`)**:
  - Floor badge, pill, and metadata key font sizes at `11px` (`0.6875rem`):
    ```css
    .pill,
    .hero-tag,
    .kind,
    .compare-cards .k {
      font-size: max(11px, 0.6875rem);
    }
    ```

---

## 3. Visual QA Gallery (`127.0.0.1:5190` — `1440×900`, `1280×720`, `390×844`)

### Desktop Widescreen (`1440 × 900`)
- **Landing (`/?run=live-a-7&speed=60`)**: [`screenshots/landing-1440x900.jpg`](screenshots/landing-1440x900.jpg)
- **3D Factory Floor (`/replay.html?run=live-a-7`)**: [`screenshots/replay-layout-1440x900.jpg`](screenshots/replay-layout-1440x900.jpg)
- **Agent Workflow DAG (`/replay.html?run=live-a-7&view=agents&node=designers`)**: [`screenshots/replay-agents-1440x900.jpg`](screenshots/replay-agents-1440x900.jpg)

### 720p Projector / Laptop (`1280 × 720`)
- **Landing (`/?run=live-a-7&speed=60`)**: [`screenshots/landing-1280x720.jpg`](screenshots/landing-1280x720.jpg)
- **3D Factory Floor (`/replay.html?run=live-a-7`)**: [`screenshots/replay-layout-1280x720.jpg`](screenshots/replay-layout-1280x720.jpg)
- **Agent Workflow DAG (`/replay.html?run=live-a-7&view=agents&node=designers`)**: [`screenshots/replay-agents-1280x720.jpg`](screenshots/replay-agents-1280x720.jpg)

### Mobile Portrait (`390 × 844`)
- **Landing (`/?run=live-a-7&speed=60`)**: [`screenshots/landing-390x844.jpg`](screenshots/landing-390x844.jpg)
- **3D Factory Floor (`/replay.html?run=live-a-7`)**: [`screenshots/replay-layout-390x844.jpg`](screenshots/replay-layout-390x844.jpg)
- **Agent Workflow DAG (`/replay.html?run=live-a-7&view=agents&node=designers`)**: [`screenshots/replay-agents-390x844.jpg`](screenshots/replay-agents-390x844.jpg)
