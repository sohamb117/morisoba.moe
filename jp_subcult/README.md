# UNDERGROUND — Japan field atlas

A static atlas at morisoba.moe/jp_subcult/. Fullscreen 3D map, floating directory and detail windows, restrained grayscale and red, citations, saved places, search, area/category/status/tag/source filters, and source sorting.

## Preview

From this folder run:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open http://127.0.0.1:8765/ in a browser with WebGL enabled. Serve over HTTP, not `file://`. No build step, API key, database, or account is required. For publishing, upload the complete folder to a static host that serves `.mjs` as JavaScript. Production URL: https://morisoba.moe/jp_subcult/.

## Data and provenance

- `data/source-data.md`: complete human-readable export, including all destination records, the separate source ledger, citations, tag evidence, original notes and the entire supplied 552-line document.
- `data/records.json`: 377 places and events, the only entries shown in the viewer.
- `data/source-materials.json`: 43 publication, online-resource and reference notes. These are research materials, not map destinations.
- `data/original.md`: unmodified supplied document.
- `data/research.json`: research notes, source claims, check dates and tags before editorial merging.
- `data/corrections.json`: evidence-linked corrections retained for audit.
- `data/geocodes.json`: approximate public-address matches and provenance.
- `data/areas.json`: administrative-area anchors. These are never presented as shop locations.
- `data/catalog.js`: generated browser data.

The **first bracketed label** in each original bullet is a discovery source. It populates the source filter and Source A–Z sorting. It does not become a verified descriptive tag. Multiple discovery sources survive duplicate merging. Related venues inherit the source from their parent note.

Research snapshot: October 16, 2026. Among the 377 destinations, 206 have source-checked identity or facts, 159 need rechecking, 8 remain unverified, and 4 carry closure evidence. This does not mean all original claims or future opening hours have been verified. Each evidence-supported tag links to its evidence. Original notes are preserved even when contradicted by research.

231 destinations have approximate GSI address-block coordinates derived from cited addresses, not entrance-level pins. Other records use an explicitly labeled area overview or have no resolved location. No precise coordinates are fabricated. Map links search the current sourced address where established.

## Update data

Edit `data/records.json` and `data/source-materials.json`, preserving IDs, source notes, discoverySources and citations. Update check dates only after reviewing evidence. Then run:

```sh
python3 scripts/build.py
python3 scripts/validate.py
```

The build rewrites the browser catalog and Markdown export without making network requests. Validation checks original-bullet coverage, uniqueness, source separation, source-label interpretation, tag citation membership, evidence requirements, and address-pin provenance.

## Interaction

- Scroll/pinch to zoom, drag to pan, right-drag to rotate/tilt.
- 3D is always enabled. Initial zoom 17.3; zoom range 10–19.5, constrained to Japan.
- Select a place to fly to its approximate location and open a popup and detail panel.
- Source, area, category, status and supported-tag filters combine with text search.
- `/` focuses search; arrows browse results; Enter opens; Escape closes; `?` opens help.
- Drag panel title bars on desktop. EXPLORE hides/shows the directory. Mobile starts with panels closed; a selection opens a bottom sheet.
- Saved places stay in browser local storage. Search/filter/selection URLs are shareable.

## Maps and third-party services

MapLibre GL JS 6.14.0 is bundled locally, including its module worker, CSS and license. Map tiles, glyphs and sprites come from OpenFreeMap/OpenStreetMap; elevation comes from the public AWS Terrain Tiles dataset (Terrarium encoding). The viewer requires network access for these resources and WebGL for 3D. Geometry quality varies by area and map coverage. A venue's business facts do not come from map tiles.

Map and data credits are accessible from the persistent ? button. The directory, notes and citations remain usable if map resources fail. Saved state is local; there is no application backend, analytics, registration, or data submission.
