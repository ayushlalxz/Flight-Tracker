# 01-Select-State — Specification

## Overview

Adds interactive state/district selection to the India Flight Tracker map. Users can hover over any Indian state to see its border glow (white/beige highlight), click to select it, and then watch only the flights currently passing over that state or district. Each state gets its own dedicated API route that filters live OpenSky data to the state's geographic bounding polygon.

---

## Goals

- Render Indian state boundaries as a GeoJSON layer on top of the existing Leaflet map.
- On hover: animate the hovered state's border to a white/beige highlight colour — only when no state is currently selected.
- On click: lock the selection to that state; the map zooms/pans to fit it.
- When a state is selected, hover and click interaction is frozen on all other states — only the selected state responds (click to deselect) and flight markers/sidebar show only flights inside that state.
- Provide a dedicated Flask API route per state: `GET /api/flights/<state_slug>` that returns flights filtered to that state's bounding polygon.
- Allow the user to deselect (click the same state again, or click outside) to return to the all-India view.

---

## Non-Goals

- Union territory administrative detail below district level (sub-district / taluk).
- Real-time animated flight trails within the selected region.
- Storing per-state flight data in MySQL (state filtering is computed at request time).
- Authentication or per-user state preferences.

---

## Background & Context

The existing app fetches all flights inside a rectangular bounding box covering the entire Indian subcontinent (`INDIA_BBOX` in `config.py`). There is no geographic subdivision. Users want to narrow their view to a specific state (e.g., Maharashtra) or district, and have the map visually communicate which region is active. The OpenSky API accepts arbitrary `lamin/lomin/lamax/lomax` boxes, so per-state bounding boxes can be derived from GeoJSON boundary data. For concave shapes (e.g., Kerala), a point-in-polygon check using the actual GeoJSON polygon is also needed.

The map already uses **Leaflet** with a CartoDB Dark Matter tile layer. GeoJSON layers are a first-class Leaflet feature (`L.geoJSON`), so the integration path is low-friction.

---

## Functional Requirements

1. **MUST** load an Indian state boundaries GeoJSON file (single file, served as a static asset or bundled) when the map initialises.
2. **MUST** render state polygons as an invisible or very-low-opacity fill layer so the underlying tile layer remains visible.
3. **MUST** change the border (stroke) of a state polygon to `#F5F0E8` (beige-white) with increased stroke weight (`3px`) when the mouse enters it, and revert on mouse leave — only when no state is currently selected.
4. **MUST** keep the selected state's border permanently highlighted (same beige-white, `3px`) until deselected.
4a. **MUST** disable hover glow and click selection on all non-selected states while a state is locked — interaction is restricted to the selected state (deselect via re-click, `← India` button, or ESC).
5. **MUST** zoom/pan the map to fit the selected state's bounds on selection.
6. **MUST** call `GET /api/flights/<state_slug>` (replacing the existing `/api/flights` call) when a state is selected, and revert to `/api/flights` when deselected.
7. **MUST** filter displayed markers and the sidebar flight list to only flights returned by the state route.
8. **MUST** expose Flask routes in the form `GET /api/flights/<state_slug>` for every state (28 states + 8 UTs = 36 routes) *(assumed: could be a single parameterised route)*.
9. **MUST** return `404` with `{"error": "Unknown state"}` for unrecognised slugs.
10. **MUST** support district-level drill-down: when a state is already selected and the user hovers/clicks a district within it, the same hover-glow and selection behaviour applies at district level, calling `GET /api/flights/<state_slug>/<district_slug>`.
11. **SHOULD** display the name of the hovered/selected region in a small floating label or in the existing sidebar header.
12. **SHOULD** provide a visible "Back to India" / deselect affordance (button or ESC key).
13. **SHOULD** pause plane rendering outside the selected region (do not show markers that are outside the polygon).
14. **MAY** animate the border highlight with a CSS glow/pulse effect (box-shadow or SVG filter) for visual polish.
15. **MAY** show a loading spinner in the sidebar while the state-filtered fetch is in progress.

---

## Technical Design

### Architecture

```
Browser (Leaflet map)
  ├── india-states.geojson   (static asset, loaded once on init)
  ├── india-districts.geojson (static asset, lazy-loaded when a state is selected)
  │
  ├── map.js                 (extended: GeoJSON layer, hover/click handlers)
  ├── sidebar.js             (reads window.flightData — no change needed)
  │
  └── fetchAndRender(url)    (now accepts a URL param; defaults to /api/flights)

Flask backend
  ├── api/flights.py         (existing /api/flights route unchanged)
  └── api/state_flights.py   (new blueprint)
        ├── GET /api/flights/<state_slug>
        └── GET /api/flights/<state_slug>/<district_slug>
```

The frontend drives the filtering via URL — it calls the appropriate route and renders whatever comes back. The backend does bounding-box pre-filtering via OpenSky params, then polygon post-filtering to handle concave state shapes.

### Data Model

#### GeoJSON assets

| File | Contents | Size estimate |
|------|----------|---------------|
| `static/geo/india-states.geojson` | 36 state/UT polygons with `NAME_1` and `slug` properties | ~3 MB simplified |
| `static/geo/india-districts.geojson` | ~750 district polygons with `NAME_1`, `NAME_2`, `state_slug`, `district_slug` | ~8 MB simplified |

Each feature MUST carry:
```json
{
  "properties": {
    "name":          "Maharashtra",
    "slug":          "maharashtra",
    "bbox":          [72.6, 15.6, 80.9, 22.0],
    "parent_slug":   null
  }
}
```

#### State bounding box registry (server-side)

```python
# config.py addition
STATE_BBOXES: dict[str, dict] = {
    "maharashtra": {"lamin": 15.6, "lomin": 72.6, "lamax": 22.0, "lomax": 80.9},
    # … one entry per state/UT, derived from GeoJSON at startup
}
```

#### Selected-state client state

```js
// map.js additions
let selectedRegion = null;   // { slug, layer, type: "state"|"district" }
let stateGeoLayer  = null;   // L.geoJSON instance for states
let districtGeoLayer = null; // L.geoJSON instance for districts (lazy)
```

### API / Interface

#### `GET /api/flights/<state_slug>`

- **Path param:** `state_slug` — kebab-case state name (e.g., `maharashtra`, `tamil-nadu`).
- **Query params:** none (inherits global OpenSky params).
- **Response (200):**
  ```json
  {
    "source":   "live",
    "state":    "maharashtra",
    "count":    12,
    "flights":  [ /* same schema as /api/flights */ ]
  }
  ```
- **Response (404):**
  ```json
  { "error": "Unknown state: xyz" }
  ```

#### `GET /api/flights/<state_slug>/<district_slug>`

- Same as above but further filtered to the district polygon.
- **Response (404)** if state or district not found.

#### Frontend JS changes in `map.js`

```js
// Extended signature
async function fetchAndRender(url = "/api/flights") { … }

// New
function initStateLayer() { … }          // loads GeoJSON, attaches hover/click
function selectRegion(slug, layer) { … } // highlights, zooms, triggers fetch
function deselectRegion() { … }          // resets to all-India view
function onStateHover(e) { … }
function onStateClick(e) { … }
```

### Dependencies

| Dependency | Purpose | Already present? |
|------------|---------|-----------------|
| Leaflet `L.geoJSON` | Render/interact with GeoJSON polygons | Yes (Leaflet loaded) |
| `shapely` (Python) | Point-in-polygon check on the backend | No — needs `pip install shapely` |
| India states GeoJSON | Boundary data | No — source from `datameet/maps-of-india` or Mapbox boundaries |
| India districts GeoJSON | District boundary data | No — same source |

---

## Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| OpenSky rate-limited while a state is selected | Fall back to DB snapshot, filtered by polygon, same as global fallback |
| State slug not found in registry | Backend returns 404; frontend shows toast "Unknown region" and reverts to all-India |
| GeoJSON file fails to load | Catch fetch error; disable state selection, show console warning; map continues in all-India mode |
| Concave state shape (e.g., Goa) where bbox over-captures flights | Backend does point-in-polygon post-filter using `shapely.geometry.shape(feature).contains(Point(lon, lat))` |
| Very small state / UT (e.g., Lakshadweep) with zero flights | Return `{ count: 0, flights: [] }` — sidebar shows "No flights in this region" |
| User clicks rapidly between states | Debounce or cancel in-flight fetch; only the last-clicked state's request is applied to the UI |
| Selecting a district while district GeoJSON is still loading | Show a loading indicator; queue the selection until GeoJSON resolves |
| User resizes or rotates device | Leaflet handles reflow; GeoJSON layer re-renders automatically |

---

## Security Considerations

- State/district slug from the URL path is validated against a hard-coded registry (`STATE_BBOXES`). It is never interpolated into SQL or shell commands, so injection is not a concern.
- GeoJSON files are static assets served by Flask; no user-supplied data reaches the file system.
- The OpenSky credentials in `config.py` remain server-side only; the state route does not expose them.

---

## Performance Considerations

- **GeoJSON size:** Simplify state boundaries to ≥ 0.01° tolerance (use `mapshaper` or `topojson`). Target < 300 KB for states, < 1.5 MB for districts after gzip.
- **District lazy loading:** Only fetch `india-districts.geojson` after the user selects a state; do not load it on initial page load.
- **Backend polygon check:** `shapely` point-in-polygon is O(n) per flight per polygon edge. With ≤ 500 flights and state polygons simplified to ~200 vertices, this is well under 10 ms. *(assumed)*
- **OpenSky bbox pre-filter:** Always pass the state's tight bounding box as `lamin/lomin/lamax/lomax` to OpenSky to minimise the response payload before the polygon post-filter.
- **Caching:** Consider a 10-second server-side cache (`functools.lru_cache` with a TTL wrapper) per state slug to avoid redundant OpenSky calls if multiple clients hit the same state simultaneously. *(assumed)*

---

## Testing Strategy

### Unit
- `test_state_bbox`: assert every state slug in the registry maps to a valid, non-overlapping bounding box.
- `test_point_in_polygon`: for each state, test a known interior point and a known exterior point.
- `test_slug_validation`: assert 404 is returned for garbage slugs; 200 for valid ones.

### Integration
- `test_state_route_live` *(skipped in CI)*: call `/api/flights/maharashtra` against a real OpenSky response stub and verify returned flights all fall inside Maharashtra's polygon.
- `test_state_route_cached`: with OpenSky mocked to fail, assert the route falls back to DB data filtered to the state.

### End-to-End (manual / Playwright)
- Hover over each of 5 representative states; verify border glows white/beige.
- Click a state; verify zoom, route call, marker count decreases, sidebar updates.
- Press ESC or click "Back to India"; verify deselection and all-India view returns.
- Hover a district after selecting a state; verify district border highlights independently.

---

## Open Questions

1. **GeoJSON source:** Which authoritative GeoJSON dataset should be used? `datameet/maps-of-india` (open license) or Mapbox Admin Boundaries (requires account)? Needs decision before implementation.
2. **District scope at launch:** Should district drill-down ship in the same release as state selection, or as a follow-up? Implementing district GeoJSON loading adds complexity; it could be deferred.
3. **Slug normalisation:** Should "Andaman and Nicobar Islands" become `andaman-and-nicobar-islands` or `andaman-nicobar`? Need a canonical slug list agreed on before the backend registry and GeoJSON properties are authored.
4. **Highlight colour:** The spec says "white or beige". Confirm the exact hex — `#FFFFFF` (pure white) or `#F5F0E8` (warm beige) — against the dark CartoDB tile to validate legibility.
5. **OpenSky quota impact:** Selecting a state will fire an additional OpenSky request on each auto-refresh tick. With the current 1-second `AUTO_REFRESH_SECONDS`, this could exhaust the anonymous 400 req/day limit very quickly for state views. Should the refresh interval be increased to 10–30 s when a state is selected, or should state routes use only the DB cache?

---

## Revision History

| Date | Author | Change |
|------|--------|--------|
| 2026-06-12 | Ayush Lal | Initial spec |
