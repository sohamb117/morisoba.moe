# Validation — 2026-10-16

## Data

- 377 destination/event records; 43 source-material and online-reference notes kept separately.
- 362/362 original bullets covered; all 552 original lines preserved.
- Unique record IDs; all original notes match the supplied text.
- Every first bracketed label preserved as a discovery source, including labels inherited by related venue records.
- Every supported tag has a citation belonging to the record. Source-checked and closed entries require evidence and a check date.
- 231 approximate pins match the record's current cited address and include GSI provenance. Ambiguous/closed-branch pins were suppressed.
- Statuses are scoped to stated facts, not blanket verification of hours, stock or future access.

## Preview checks

Checked in the Codex browser against the local static server:

- Fullscreen 3D map, visible extruded buildings, enabled elevation terrain, and distinct ocean surface around Naoshima.
- Place selection moves the camera to zoom 17.5 and opens a popup and evidence panel.
- Zoom-out stops at 10.0, including a further attempted zoom-out.
- Source filter and Source A–Z sort: “Goth: fashion” returns 7 entries in alphabetical order.
- No Print or Other tab; publication notes excluded from the destination catalog. Legacy publication URLs normalize to the destination directory.
- Search and an empty-result reset; selection deep link survives reload.
- Save survives reload; test save removed afterward.
- Mobile viewport 390×844: map covers the viewport, panel fits within it, no horizontal document overflow.
- No browser console errors during the completed map checks.
- JavaScript syntax check and data validation script pass.

Map loading and geometry depend on OpenFreeMap, its glyph resources, AWS terrain tiles, browser WebGL support and network access. Data evidence is a research snapshot; locations without sufficient address evidence remain unresolved. No production deployment was performed.
