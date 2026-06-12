# 02-Capestones-of-Flight — Specification

## Overview

Adds a flight detail view to the India Flight Tracker. A search box pinned to the top-centre of the map allows users to find any visible aircraft by callsign or ICAO24 address. Selecting a plane — either from the search box, the flight list, or by clicking its marker — replaces the right sidebar content with a live detail panel showing the aircraft's origin airport, current position, and destination airport drawn on the main map, along with a telemetry readout that auto-refreshes every 10 seconds.

---

## Goals

- Add an always-visible search box at the top-centre of the main map for quick aircraft lookup by callsign or ICAO24.
- On selection, show a flight detail panel in the **right sidebar** of the main page (no separate page navigation).
- In the detail panel: display origin airport, current position, and destination airport as distinct markers on the existing main map, connected by a route polyline.
- Provide a backend API route (`GET /api/flight/<icao24>`) that returns origin, current position, and destination data in a single JSON response.
- Allow the user to dismiss the detail panel (✕ Close or ESC) to return to the overview flight list.

---

## Non-Goals

- Historical flight replay / animated trail of past positions.
- Turn-by-turn waypoints or full FMS flight plan data (not available from OpenSky free tier).
- Push notifications or alerts when a tracked flight lands.
- Tracking flights outside the India bounding box.
- User accounts or saved/favourite flights.
- A separate `/flight/<icao24>` detail page (removed from this version; the sidebar panel replaces it).

---

## Background & Context

The existing app shows live plane markers on a Leaflet map but treats every aircraft as an anonymous dot. Clicking a marker previously navigated away to a separate page. The updated design keeps the user on the main map — the sidebar transitions from the overview (stat cards + flight list) to a per-aircraft detail view, so origin/destination markers and route polylines appear on the same map the user was already viewing.

**Data sources available:**

| Data | Source | Notes |
|---|---|---|
| Current position | OpenSky `/api/states/all` (already used) | lat, lon, heading, altitude, callsign |
| Flight history (departure / arrival) | OpenSky `/api/flights/aircraft?icao24=&begin=&end=` | Returns departure/arrival ICAO codes for flights in last 30 days |
| Airport coordinates | `static/data/airports.json` (bundled) | Maps ICAO airport code → lat/lon, name, city |

---

## Functional Requirements

1. **MUST** render a search input centred at the top of the map, visible at all times on the main page.
2. **MUST** filter the visible flight list in real time as the user types (min 2 characters), matching against callsign and ICAO24 (case-insensitive).
3. **MUST** show a dropdown of up to 8 matching results below the search box; keyboard (↑ ↓ Enter) and mouse selection both work.
4. **MUST** open the flight detail panel in the right sidebar when the user selects a result from the search dropdown, clicks a plane marker on the map, or clicks a row in the flight list.
5. **MUST** expose `GET /api/flight/<icao24>` returning origin airport, current position, and destination airport.
6. **MUST** draw a route polyline on the main map when a flight is selected: solid origin→current, dashed current→destination.
7. **MUST** place distinct markers on the main map: green dot for origin, blue animated plane for current position (the existing marker), red dot for destination.
8. **MUST** show a sidebar detail panel with: callsign, aircraft ICAO24, origin airport name + ICAO, destination airport name + ICAO, current altitude, speed, heading, origin country, and data freshness timestamp.
9. **MUST** return `404 {"error": "Flight not found"}` from the API if the ICAO24 is unknown.
10. **MUST** provide a "✕ Close" button and ESC key shortcut in the detail panel to dismiss it and return to the flight list overview.
11. **SHOULD** auto-refresh the current position in the detail panel every 10 seconds without a page reload; airport markers remain fixed after the first fetch.
12. **SHOULD** display `"Unknown"` gracefully for origin or destination if the flight-history lookup returns no airport data.
13. **SHOULD** zoom and pan the main map to fit the full route (origin→destination bounds) when a flight is first selected.
14. **MAY** show a subtle animated pulse on the current-position marker.
15. **MAY** show a countdown timer in the detail panel footer indicating seconds until the next auto-refresh.

---

## Technical Design

### Architecture

```
Main page (index.html) — single page, no navigation
  ├── Search box overlay (top-centre of map)
  │     └── Dropdown → showFlightDetail(icao24)
  ├── Plane marker click → showFlightDetail(icao24)
  ├── Flight list row click → focusFlight(icao24) → showFlightDetail(icao24)
  └── Sidebar
        ├── #sidebar-overview (default: stat cards + flight list)
        └── #sidebar-flight-detail (shown when flight selected)
              ├── Close button → closeFlightDetail()
              ├── Callsign / ICAO24 header
              ├── Origin → Destination airport row
              └── Telemetry (alt, speed, heading, country, timestamp)

Flask backend
  └── api/flight_detail.py
        └── GET /api/flight/<icao24>
              ├── 1. Fetch current position from DB
              ├── 2. Fetch flight history from OpenSky flights API
              ├── 3. Resolve airport ICAO → lat/lon from bundled dataset
              └── 4. Return combined JSON
```

### Data Model

#### `GET /api/flight/<icao24>` response schema

```json
{
  "icao24": "abc123",
  "position": {
    "icao24": "abc123",
    "callsign": "AI101",
    "origin_country": "India",
    "latitude": 19.09,
    "longitude": 72.87,
    "altitude_m": 10668,
    "velocity_ms": 245.3,
    "heading": 270,
    "on_ground": false,
    "fetched_at": "2026-06-12T10:00:00"
  },
  "origin": {
    "icao": "VIDP",
    "name": "Indira Gandhi International Airport",
    "city": "New Delhi",
    "lat": 28.5665,
    "lon": 77.1031
  },
  "destination": {
    "icao": "VABB",
    "name": "Chhatrapati Shivaji Maharaj International Airport",
    "city": "Mumbai",
    "lat": 19.0896,
    "lon": 72.8656
  }
}
```

`origin` and `destination` may be `null` if lookup fails.

### API / Interface

#### `GET /api/flight/<icao24>`

Validates icao24 as 6-char hex → DB lookup → OpenSky flight history (last 24h) → resolve airports → return JSON.

#### JS interface

| Function | Module | Description |
|---|---|---|
| `showFlightDetail(icao24)` | `map.js` | Fetches detail, switches sidebar view, places map markers |
| `closeFlightDetail()` | `map.js` | Clears markers/lines, restores overview panel |
| `focusFlight(icao24)` | `map.js` | Thin wrapper — calls `showFlightDetail` |
| `navigateToFlight(icao24)` | `search.js` | Closes dropdown, calls `showFlightDetail` |

### Dependencies

| Dependency | Purpose | Already present? |
|---|---|---|
| `static/data/airports.json` | Airport code → lat/lon | Yes — generated by `scripts/generate_airports.py` |
| OpenSky `/api/flights/aircraft` | Flight history | Yes — `api/flight_detail.py` |
| Leaflet (CDN) | Map markers + polylines | Yes |

---

## Edge Cases & Error Handling

| Scenario | Handling |
|---|---|
| Aircraft has no flight history | `origin` and `destination` null; panel shows "Unknown" with only current position marker |
| Airport ICAO code not in bundled dataset | Airport object null; panel shows raw ICAO code as fallback |
| Aircraft is on the ground | `on_ground: true`; current marker shown; no polylines if no origin/dest |
| OpenSky history API rate-limited | Proceed with `origin: null, destination: null`; don't block position display |
| ICAO24 not in DB | `fdp-status` shows error badge; panel remains open with "Not found" message |
| User selects a different flight while panel is open | `showFlightDetail` resets all state, clears old markers, fetches new flight |
| ESC pressed with both state selected and flight detail open | Close flight detail first; second ESC deselects state |

---

## Security Considerations

- `icao24` is validated as 6-character hex before any DB query or OpenSky call. Returns 400 for invalid format.
- `airports.json` is a static asset; no user input reaches the filesystem.
- No user data is stored — the detail panel is stateless and read-only.

---

## Performance Considerations

- **Cold load latency:** `/api/flight/<icao24>` makes two sequential external calls. Target < 3s.
- **Airport lookup:** O(1) from Python dict loaded at startup.
- **Auto-refresh:** 10-second interval, fetches only position from DB. Origin/destination cached client-side after first successful fetch.
- **Search filtering:** Client-side against `window.flightData` — no network call.

---

## Testing Strategy

### Manual
1. Type "AI" in the search box — dropdown shows matching flights.
2. Select a result — sidebar transitions to detail view; green/red dots appear on map.
3. Click a plane marker — same sidebar transition.
4. Click a flight list row — same sidebar transition.
5. Wait 10s — current position refreshes, airports stay fixed.
6. Click ✕ Close or press ESC — returns to overview, markers removed.
7. Select a different flight while panel is open — panel resets cleanly.
8. Select a flight with no origin/dest data — panel shows "Unknown" gracefully.

---

## Open Questions

1. **Destination confidence:** `estArrivalAirport` is estimated. Should UI label it "Estimated destination"?
2. **OpenSky quota:** Should backend cache flight-history results per ICAO24 for ~5 minutes to limit API calls?

---

## Revision History

| Date | Author | Change |
|------|--------|--------|
| 2026-06-12 | Ayush Lal | Initial spec (separate detail page) |
| 2026-06-12 | Ayush Lal | Revised: detail shown in sidebar panel, no page navigation |
