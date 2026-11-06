# Original viewer source

Based on the local `factory-n1` viewer at commit `25ff9774331e02c822f9a22f757741b66cecc6e3`, inspected October 17, 2026.

Adapted here:

- `web/world/floor.ts`: original slab, walls, belts and rendering, extended with selectable station labels and presentation-only agent floors.
- `web/world/warehouse.ts`: original scene, lighting, camera and synchronized playback, extended with selection and a single agent-floor view.
- `web/ui/controls.ts`: original playback controls, with modal keyboard handling.
- `web/style.css`: copied into `src/style.css`, then extended for run controls, the inspector, keyboard focus and mobile stacking.

Imported directly from the sibling checkout: station models, trace-state calculations, evidence panel and safe DOM helpers. Original backend and viewer source were not modified by this redesign. The physical replay uses the original saved layout and traces; `team-layout.ts` generates only the navigational arrangement of existing agent records.
