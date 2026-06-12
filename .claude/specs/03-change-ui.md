# 03-change-ui — Specification

## Overview

Refreshes the visual design of flight markers on the main Leaflet map.
Airborne plane icons change from blue (`#58a6ff`) to **yellow** (`#f5c518`).
When a plane is selected (flight detail panel opens), its marker switches to
**orange** (`#f0883e`) and receives a stronger glow, making the active aircraft
instantly distinguishable from the rest of the traffic.  Additional UI polish
(layout, typography, colours) is to be applied once the reference image is
supplied — those items are tracked under Open Questions.

---

## Goals

- Change default airborne plane colour from blue to yellow.
- Change the selected-flight plane colour to orange (distinct from both the
  default yellow and the existing on-ground orange — see Colour Palette below).
- Keep on-ground planes visually distinct from both airborne states.
- Ensure the glow / drop-shadow on each marker matches its fill colour.
- Maintain all existing interaction behaviour (hover, click, FDP panel,
  state-selection layer).
- Apply any further UI changes derived from the reference image once it is
  provided.

---

## Non-Goals

- Changing the Leaflet tile layer or base-map theme.
- Modifying the state polygon layer colours.
- Altering the airport origin/destination dot colours (green / red).
- Changing the sidebar layout beyond what the reference image specifies.
- Animating the transition between yellow → orange on selection *(assumed: not
  required; instant icon swap is sufficient)*.

---

## Background & Context

Currently `makePlaneIcon` in `map.js` assigns:

| State | Colour | Hex |
|---|---|---|
| Airborne | Blue (accent) | `#58a6ff` |
| On ground | Orange (warn) | `#f0883e` |

The CSS drop-shadow on `.plane-marker svg` is tuned for blue
(`rgba(88,166,255,.6)`).  With yellow icons the shadow must be re-tuned to
avoid a blue halo on yellow SVGs.  The selected-flight icon is currently
re-rendered by `showFlightDetail` but uses the same `makePlaneIcon` palette —
there is no separate "selected" colour state yet.

A reference image was mentioned by the user but not yet attached.
The colour changes (yellow / orange) are explicitly stated; all other UI
changes will be derived from the image once available.

---

## Functional Requirements

### Marker colours
1. **MUST** render all airborne plane markers in **yellow** (`#f5c518`) by
   default.
2. **MUST** render on-ground plane markers in a colour clearly distinct from
   yellow — keep existing **dim-orange** (`#f0883e`) or choose a new value that
   reads as "parked / inactive" against the dark map.
3. **MUST** render the currently selected plane (the one whose detail is open in
   the FDP panel) in **orange** (`#ff8c00` — see Colour Palette).
4. **MUST** update the CSS drop-shadow on each marker to match its fill colour
   (yellow glow for default, orange glow for selected, muted glow for on-ground).
5. **MUST** restore the marker to yellow when `closeFlightDetail()` is called
   (i.e. deselect resets the icon).

### Selection tracking
6. **MUST** track which marker corresponds to the currently selected ICAO24 so
   its icon can be swapped on open and reset on close.
7. **MUST** handle the case where the selected flight's marker has been removed
   and re-added by a background auto-refresh (the refresh recreates all markers
   — the refreshed marker should still appear orange if the FDP panel is open).

### Reference-image UI changes *(deferred)*
8. **SHOULD** apply all further layout / typography / colour changes described
   in the reference image once it is supplied; those will be captured as
   sub-requirements in a revision of this spec.

---

## Technical Design

### Architecture

All changes are confined to the front end:

```
static/js/map.js
  makePlaneIcon(heading, onGround, selected)
    → new `selected` boolean parameter
    → colour chosen from PLANE_COLOURS constant

  renderFlights(flights)
    → passes selected=true when f.icao24 === fdpSelectedIcao24

  showFlightDetail(icao24)
    → after switching sidebar, call renderFlights to repaint markers
      (or swap only the affected marker's icon)

  closeFlightDetail()
    → after clearing FDP state, call renderFlights to restore yellow

static/css/style.css
  .plane-marker svg
    → drop-shadow updated to yellow glow rgba(245,197,24,.6)
  .plane-marker--selected svg   ← new modifier class
    → drop-shadow orange glow rgba(255,140,0,.8)
  .plane-marker--ground svg     ← new modifier class (optional)
    → drop-shadow muted
```

### Colour Palette

| Role | Hex | Usage |
|---|---|---|
| Airborne default | `#f5c518` | Yellow — all flying planes |
| Selected | `#ff8c00` | Orange — active FDP plane |
| On-ground | `#f0883e` *(existing)* | Parked / taxiing |
| Solid polyline | `#58a6ff` *(existing)* | Origin → current route |
| Dashed polyline | `#8b949e` *(existing)* | Current → destination route |

> **Note:** the user said "orange when selected" and "yellow" for default.
> `#ff8c00` (web orange) is used for "selected" to avoid clashing with the
> existing on-ground `#f0883e` (amber-orange).  Adjust in the Colour Palette
> if the reference image specifies otherwise.

### Data Model

No new data.  `fdpSelectedIcao24` (already tracked in `map.js`) drives the
colour decision at render time.

### API / Interface

#### `makePlaneIcon(heading, onGround, selected = false)`

```js
// Colour priority: selected > on_ground > airborne
const PLANE_COLOURS = {
  selected:  { fill: "#ff8c00", glow: "rgba(255,140,0,.8)",   size: 20 },
  airborne:  { fill: "#f5c518", glow: "rgba(245,197,24,.6)",  size: 18 },
  onGround:  { fill: "#f0883e", glow: "rgba(240,136,62,.4)",  size: 14 },
};

function makePlaneIcon(heading, onGround, selected = false) {
  const theme = selected ? PLANE_COLOURS.selected
              : onGround ? PLANE_COLOURS.onGround
              :             PLANE_COLOURS.airborne;
  // SVG fill = theme.fill; divIcon class includes marker modifier
}
```

#### `renderFlights(flights)` — updated call

```js
const icon = makePlaneIcon(
  f.heading  || 0,
  f.on_ground,
  f.icao24   === fdpSelectedIcao24   // selected flag
);
```

#### CSS modifier classes

| Class | Applied when |
|---|---|
| `.plane-marker` | always (base) |
| `.plane-marker--selected` | icon is for the active FDP flight |
| `.plane-marker--ground` | icon is for an on-ground plane |

Drop-shadows are set per class so the glow colour always matches the fill.

### Dependencies

| Dependency | Change needed? |
|---|---|
| Leaflet divIcon | No — same mechanism, different colour/class |
| `style.css` | Yes — drop-shadow colours |
| `map.js` | Yes — `makePlaneIcon`, `renderFlights` |
| `flight.js` (standalone detail page) | Yes — `makeCurrentIcon` still uses blue; update to orange |
| `flight.css` | Yes — `.plane-marker--current` glow update |

---

## Edge Cases & Error Handling

| Scenario | Handling |
|---|---|
| Auto-refresh fires while FDP panel is open | `renderFlights` is called with current `fdpSelectedIcao24` set → selected marker redrawn orange automatically |
| User selects a flight that is on the ground | `selected` flag takes priority over `onGround` → marker is orange, not amber |
| `fdpSelectedIcao24` is set but the flight has moved outside the viewport bbox and is not in the new `window.flightData` | No marker rendered — no action needed; FDP panel still shows last known data |
| User rapidly clicks different flights | `showFlightDetail` resets `fdpSelectedIcao24` then calls `renderFlights` — only one marker is ever orange at a time |

---

## Security Considerations

N/A — purely client-side visual change; no new inputs, no new network calls.

---

## Performance Considerations

- `renderFlights` already iterates all markers on every refresh; adding one
  boolean comparison per marker is negligible.
- Icon objects are recreated on each render (Leaflet `L.divIcon` is cheap);
  no caching needed.

---

## Testing Strategy

### Manual
1. Load the map — all airborne planes are **yellow**; on-ground planes are
   amber/orange.
2. Click any plane marker — that marker turns **orange**; all others stay yellow.
3. Open a different flight from the search box or list — previous marker
   returns to yellow; new selection turns orange.
4. Press ESC or ✕ Close — orange marker returns to yellow.
5. Let auto-refresh fire while a flight is selected — selected marker stays
   orange after refresh.
6. Select an on-ground flight — marker shows orange (selected takes priority).

---

## Open Questions

1. **Reference image not provided.** The user mentioned a UI reference image
   but did not attach it.  All layout, typography, and colour changes beyond the
   yellow/orange marker palette are blocked until the image is shared.
   **Action:** user to re-share the image; spec will be updated with a new
   revision capturing those requirements before implementation begins.
2. **On-ground colour after palette change.** With airborne planes now yellow,
   the existing on-ground amber (`#f0883e`) may look too similar.  Consider a
   cooler muted tone (e.g. `#6e7681` grey) to clearly separate "parked" from
   "flying".  Awaiting reference image for confirmation.
3. **Selected plane size.** Should the selected marker be slightly larger than
   the default to aid discoverability?  `PLANE_COLOURS.selected.size = 20` is
   proposed above *(assumed)*.

---

## Revision History

| Date | Author | Change |
|------|--------|--------|
| 2026-06-12 | Ayush Lal | Initial spec — yellow/orange markers; UI changes deferred pending reference image |
