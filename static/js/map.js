/**
 * map.js — Leaflet map initialisation, flight marker management,
 *           and interactive state-selection layer.
 */

/* ── Map init ─────────────────────────────────────────────────────────── */
const map = L.map("map", {
  center: [20.5937, 78.9629],
  zoom: 5,
  zoomControl: true,
  attributionControl: true,
});

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}",
  {
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; ' +
      'Source: US National Park Service | ' +
      '&copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 8,
  }
).addTo(map);

// Labels-only overlay (transparent bg, dark text) — state, district & city names in black
L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
  {
    subdomains: "abcd",
    maxZoom:    19,
  }
).addTo(map);


/* ── Flight state ─────────────────────────────────────────────────────── */
/** @type {L.Marker[]} */
let planeMarkers = [];

/** @type {number|null} */
let refreshInterval = null;

/** @type {boolean} */
let autoRefreshEnabled = true;

/** Shared flight data — sidebar.js reads this via window.flightData */
window.flightData = [];


/* ── State-selection state ────────────────────────────────────────────── */
/** @type {L.GeoJSON|null} */
let stateLayer = null;

/** @type {Object|null} GeoJSON feature of the currently selected state */
let selectedState = null;

/** @type {string|null} slug of the currently selected state, e.g. "tamil-nadu" */
let selectedStateSlug = null;

/** @type {AbortController|null} lets us cancel in-flight fetches on rapid clicks */
let fetchAbortController = null;


/* ── Slug helper ──────────────────────────────────────────────────────── */
/**
 * Convert a NAME_1 state name to a URL slug.
 * Must match Python _name_to_slug() in api/state_flights.py exactly.
 * @param {string} name
 * @returns {string}
 */
function nameToSlug(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}


/* ── SVG plane icon ───────────────────────────────────────────────────── */
const PLANE_COLOURS = {
  selected: { fill: "#ff8c00", size: 32, cls: "plane-marker--selected" },
  airborne: { fill: "#f5c518", size: 28, cls: ""                       },
  ground:   { fill: "#9e9e9e", size: 16, cls: "plane-marker--ground"   },
};

function makePlaneIcon(heading, onGround, selected = false) {
  const theme = selected ? PLANE_COLOURS.selected
              : onGround ? PLANE_COLOURS.ground
              :             PLANE_COLOURS.airborne;
  const { fill, size, cls } = theme;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg"
       width="${size}" height="${size}" viewBox="0 0 32 32"
       style="transform:rotate(${heading}deg);display:block;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.65));">
    <path fill="${fill}" stroke="rgba(0,0,0,0.75)" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round"
          d="M16 2 L18 7 L18 12 L30 20 L29 22 L19 16
      L20 22 L25 27 L23 29 L18 25 L17 30 L15 30
      L14 25 L9 29 L7 27 L12 22 L13 16 L3 22 L2 20
      L14 12 L14 7 Z"/>
  </svg>`;

  return L.divIcon({
    html:       `<div class="plane-marker ${cls}">${svg}</div>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
    className:  "",
  });
}


/* ── Popup content ────────────────────────────────────────────────────── */
function buildPopup(f) {
  const altFt  = f.altitude_m  != null ? Math.round(f.altitude_m * 3.28084).toLocaleString() : "—";
  const spdKmh = f.velocity_ms != null ? Math.round(f.velocity_ms * 3.6).toLocaleString()   : "—";
  const hdg    = f.heading     != null ? `${Math.round(f.heading)}°` : "—";

  return `
    <div class="popup__callsign">${f.callsign || f.icao24 || "Unknown"}</div>
    <div class="popup__grid">
      <span class="popup__key">Country</span>
      <span class="popup__val">${f.origin_country || "—"}</span>
      <span class="popup__key">Altitude</span>
      <span class="popup__val">${altFt} ft</span>
      <span class="popup__key">Speed</span>
      <span class="popup__val">${spdKmh} km/h</span>
      <span class="popup__key">Heading</span>
      <span class="popup__val">${hdg}</span>
      <span class="popup__key">ICAO24</span>
      <span class="popup__val">${f.icao24 || "—"}</span>
    </div>
    ${f.on_ground ? '<div class="popup__ground">On Ground</div>' : ""}`;
}


/* ── Render flights ───────────────────────────────────────────────────── */
function renderFlights(flights) {
  planeMarkers.forEach(m => map.removeLayer(m));
  planeMarkers = [];

  flights.forEach(f => {
    if (f.latitude == null || f.longitude == null) return;

    const icon   = makePlaneIcon(f.heading || 0, f.on_ground, f.icao24 === fdpSelectedIcao24);
    const marker = L.marker([f.latitude, f.longitude], { icon });

    marker.on("click", () => showFlightDetail(f.icao24));
    marker.addTo(map);
    planeMarkers.push(marker);

    marker._flightData = f;
  });
}


/* ── API fetch ────────────────────────────────────────────────────────── */
/**
 * Fetch flights from the appropriate endpoint (state-specific or all-India),
 * re-render markers, and notify sidebar.js.
 * @param {AbortSignal|null} abortSignal
 */
async function fetchAndRender(abortSignal = null) {
  setSourceBadge("idle", "Fetching…");

  const url = selectedStateSlug
    ? `/api/flights/${selectedStateSlug}`
    : "/api/flights";

  try {
    const fetchOptions = abortSignal ? { signal: abortSignal } : {};
    const res  = await fetch(url, fetchOptions);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    window.flightData = json.flights || [];
    renderFlights(window.flightData);

    if (typeof updateStats      === "function") updateStats(window.flightData);
    if (typeof updateFlightList === "function") updateFlightList(window.flightData);

    // Keep region label in sync (set by onStateClick, cleared by deselectState)
    const regionEl = document.getElementById("region-label");
    if (regionEl && json.state) {
      regionEl.textContent = `Region: ${json.state}`;
    }

    const label = json.source === "cached" ? "cached" : "live";
    const text  = json.source === "cached"
      ? `Cached — ${window.flightData.length} flights`
      : `Live — ${window.flightData.length} flights`;
    setSourceBadge(label, text);

  } catch (err) {
    if (err.name === "AbortError") return;   // intentional cancel — ignore silently
    console.error("fetchAndRender error:", err);
    setSourceBadge("error", "Fetch failed");
  }
}


/* ── Source badge helper ──────────────────────────────────────────────── */
function setSourceBadge(state, text) {
  const el = document.getElementById("data-source");
  if (!el) return;
  el.className = `source-badge source-badge--${state}`;
  el.textContent = text;
}


/* ── Navigate to flight detail (called by sidebar.js click) ──────────── */
function focusFlight(icao24) {
  showFlightDetail(icao24);
}


/* ── Auto-refresh ─────────────────────────────────────────────────────── */
function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshEnabled = true;
  resetCountdown();
  refreshInterval = setInterval(() => {
    if (fetchAbortController) fetchAbortController.abort();
    fetchAbortController = new AbortController();
    fetchAndRender(fetchAbortController.signal);
    resetCountdown();
  }, AUTO_REFRESH_SECONDS * 1000);
}

function stopAutoRefresh() {
  if (refreshInterval !== null) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

function toggleAutoRefresh() {
  autoRefreshEnabled = !autoRefreshEnabled;
  const btn = document.getElementById("btn-toggle");

  if (autoRefreshEnabled) {
    startAutoRefresh();
    if (btn) { btn.textContent = "⏸ Pause"; btn.classList.remove("paused"); }
  } else {
    stopAutoRefresh();
    if (btn) { btn.textContent = "▶ Resume"; btn.classList.add("paused"); }
  }
}

function manualRefresh() {
  if (fetchAbortController) fetchAbortController.abort();
  fetchAbortController = new AbortController();
  fetchAndRender(fetchAbortController.signal);
  if (autoRefreshEnabled) resetCountdown();
}


/* ── Countdown ticker ─────────────────────────────────────────────────── */
let countdownValue = AUTO_REFRESH_SECONDS;

function resetCountdown() {
  countdownValue = AUTO_REFRESH_SECONDS;
  const el = document.getElementById("countdown");
  if (el) el.textContent = countdownValue;
}

setInterval(() => {
  if (!autoRefreshEnabled) return;
  countdownValue = Math.max(0, countdownValue - 1);
  const el = document.getElementById("countdown");
  if (el) el.textContent = countdownValue;
}, 1000);


/* ── State GeoJSON layer ──────────────────────────────────────────────── */

const STATE_STYLE_DEFAULT = {
  color:       "#5c4a2a",
  weight:      1,
  opacity:     0.5,
  fillColor:   "#5c4a2a",
  fillOpacity: 0.01,
};

const STATE_STYLE_HOVER = {
  color:   "#ffffff",
  weight:  2.5,
  opacity: 0.85,
};

const STATE_STYLE_SELECTED = {
  color:       "#ffffff",
  weight:      2.5,
  opacity:     1,
  fillColor:   "#ffffff",
  fillOpacity: 0.08,
};

/**
 * Load india-states.geojson and attach hover/click handlers to each feature.
 * Fails gracefully — map continues in all-India mode if the file is missing.
 */
function initStateLayer() {
  fetch("/static/geo/india-states.geojson")
    .then(r => {
      if (!r.ok) throw new Error(`GeoJSON fetch failed: HTTP ${r.status}`);
      return r.json();
    })
    .then(geojson => {
      stateLayer = L.geoJSON(geojson, {
        style: STATE_STYLE_DEFAULT,
        onEachFeature(feature, layer) {
          layer.on({
            mouseover: onStateHover,
            mouseout:  onStateLeave,
            click:     onStateClick,
          });
        },
      }).addTo(map);

      stateLayer.bringToBack();
    })
    .catch(err => console.warn("State layer disabled:", err));
}

function onStateHover(e) {
  const layer = e.target;
  // When a state is selected, freeze interaction on all other states
  if (selectedStateSlug !== null && layer.feature !== selectedState) return;
  if (layer.feature === selectedState) return;
  layer.setStyle(STATE_STYLE_HOVER);
  layer.bringToFront();
}

function onStateLeave(e) {
  const layer = e.target;
  if (layer.feature === selectedState) return;
  // No hover reset needed for non-selected states while a state is locked
  if (selectedStateSlug !== null) return;
  stateLayer.resetStyle(layer);
}

function onStateClick(e) {
  if (!stateLayer) return;
  const layer   = e.target;
  const feature = layer.feature;
  const name    = feature.properties.NAME_1;
  const slug    = nameToSlug(name);

  // When a state is selected, clicking other states does nothing
  if (selectedStateSlug !== null && slug !== selectedStateSlug) return;

  // Clicking the already-selected state deselects
  if (slug === selectedStateSlug) {
    deselectState();
    return;
  }

  // Cancel any in-flight request
  if (fetchAbortController) fetchAbortController.abort();
  fetchAbortController = new AbortController();

  // Reset previous selection's style
  if (selectedState) {
    stateLayer.eachLayer(l => {
      if (l.feature === selectedState) stateLayer.resetStyle(l);
    });
  }

  // Lock new selection
  selectedState     = feature;
  selectedStateSlug = slug;
  layer.setStyle(STATE_STYLE_SELECTED);
  layer.bringToFront();

  // Zoom to fit the state
  map.fitBounds(layer.getBounds(), { padding: [20, 20] });

  // Show Back button and update region label immediately
  const backBtn  = document.getElementById("btn-back");
  const regionEl = document.getElementById("region-label");
  if (backBtn)  backBtn.hidden     = false;
  if (regionEl) regionEl.textContent = `Region: ${name}`;

  // Fetch state flights
  fetchAndRender(fetchAbortController.signal);
  if (autoRefreshEnabled) resetCountdown();
}

/**
 * Clear the state selection and return to the all-India view.
 * Called by the "← India" button, ESC key, or re-clicking the active state.
 */
function deselectState() {
  if (fetchAbortController) {
    fetchAbortController.abort();
    fetchAbortController = null;
  }

  // Restore selected layer's style
  if (selectedState && stateLayer) {
    stateLayer.eachLayer(l => {
      if (l.feature === selectedState) stateLayer.resetStyle(l);
    });
  }

  selectedState     = null;
  selectedStateSlug = null;

  const backBtn  = document.getElementById("btn-back");
  const regionEl = document.getElementById("region-label");
  if (backBtn)  backBtn.hidden     = true;
  if (regionEl) regionEl.textContent = "";

  map.flyTo([20.5937, 78.9629], 5, { duration: 0.8 });

  fetchAndRender();
  if (autoRefreshEnabled) resetCountdown();
}


/* ── Flight detail panel ──────────────────────────────────────────────── */

let fdpSelectedIcao24   = null;
let fdpOriginMarker     = null;
let fdpDestMarker       = null;
let fdpSolidLine        = null;
let fdpDashedLine       = null;
let fdpRefreshInterval  = null;
let fdpCountdownVal     = 10;
let _fdpCachedOrigin    = null;
let _fdpCachedDest      = null;
let _fdpAirportsFetched = false;
const FDP_REFRESH_SECS  = 10;

function _fdpAirportIcon(type) {
  return L.divIcon({
    html:       `<div class="airport-marker airport-marker--${type}"></div>`,
    iconSize:   [12, 12],
    iconAnchor: [6, 6],
    className:  "",
  });
}

function _fdpSetText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function _fdpSetStatus(state, text) {
  const el = document.getElementById("fdp-status");
  if (!el) return;
  el.className   = `source-badge source-badge--${state}`;
  el.textContent = text;
}

function _fdpClearMapLayers() {
  if (fdpOriginMarker) { map.removeLayer(fdpOriginMarker); fdpOriginMarker = null; }
  if (fdpDestMarker)   { map.removeLayer(fdpDestMarker);   fdpDestMarker   = null; }
  if (fdpSolidLine)    { map.removeLayer(fdpSolidLine);    fdpSolidLine    = null; }
  if (fdpDashedLine)   { map.removeLayer(fdpDashedLine);   fdpDashedLine   = null; }
}

function _fdpRender(data) {
  const pos = data.position;

  _fdpSetText("fdp-callsign",  pos.callsign || pos.icao24 || "—");
  _fdpSetText("fdp-icao24",    pos.icao24   || "—");
  _fdpSetText("fdp-altitude",  pos.altitude_m  != null
    ? Math.round(pos.altitude_m  * 3.28084).toLocaleString() : "—");
  _fdpSetText("fdp-speed",     pos.velocity_ms != null
    ? Math.round(pos.velocity_ms * 3.6).toLocaleString()     : "—");
  _fdpSetText("fdp-heading",   pos.heading     != null
    ? Math.round(pos.heading) + "°" : "—");
  _fdpSetText("fdp-country",   pos.origin_country || "—");
  _fdpSetText("fdp-timestamp", pos.fetched_at
    ? new Date(pos.fetched_at).toLocaleTimeString() : "—");

  if (!_fdpAirportsFetched) {
    _fdpCachedOrigin    = data.origin;
    _fdpCachedDest      = data.destination;
    _fdpAirportsFetched = true;

    const orig = _fdpCachedOrigin;
    const dst  = _fdpCachedDest;
    _fdpSetText("fdp-origin-name", orig ? (orig.name || orig.icao || "—") : "Unknown");
    _fdpSetText("fdp-origin-icao", orig ? orig.icao : "—");
    _fdpSetText("fdp-dest-name",   dst  ? (dst.name  || dst.icao  || "—") : "Unknown");
    _fdpSetText("fdp-dest-icao",   dst  ? dst.icao  : "—");

    if (orig && orig.lat != null) {
      fdpOriginMarker = L.marker([orig.lat, orig.lon], { icon: _fdpAirportIcon("origin") })
        .bindTooltip(`Origin: ${orig.city || orig.icao}`)
        .addTo(map);
    }
    if (dst && dst.lat != null) {
      fdpDestMarker = L.marker([dst.lat, dst.lon], { icon: _fdpAirportIcon("dest") })
        .bindTooltip(`Dest: ${dst.city || dst.icao}`)
        .addTo(map);
    }

    // Fit main map to show the full route on first selection
    const pts = [];
    if (orig && orig.lat != null) pts.push([orig.lat, orig.lon]);
    pts.push([pos.latitude, pos.longitude]);
    if (dst && dst.lat != null) pts.push([dst.lat, dst.lon]);
    if (pts.length > 1) {
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
    } else {
      map.setView([pos.latitude, pos.longitude], 7);
    }
  }

  // Redraw polylines on every refresh
  if (fdpSolidLine)  { map.removeLayer(fdpSolidLine);  fdpSolidLine  = null; }
  if (fdpDashedLine) { map.removeLayer(fdpDashedLine); fdpDashedLine = null; }

  const cur = [pos.latitude, pos.longitude];
  if (_fdpCachedOrigin && _fdpCachedOrigin.lat != null) {
    fdpSolidLine = L.polyline([[_fdpCachedOrigin.lat, _fdpCachedOrigin.lon], cur], {
      color: "#58a6ff", weight: 2, opacity: 0.7,
    }).addTo(map);
  }
  if (_fdpCachedDest && _fdpCachedDest.lat != null) {
    fdpDashedLine = L.polyline([cur, [_fdpCachedDest.lat, _fdpCachedDest.lon]], {
      color: "#8b949e", weight: 2, opacity: 0.5, dashArray: "6 6",
    }).addTo(map);
  }

  _fdpSetStatus("live", "Live");
}

async function _fdpRefresh() {
  _fdpSetStatus("idle", "Fetching…");
  try {
    const res = await fetch(`/api/flight/${fdpSelectedIcao24}`);
    if (res.status === 404) { _fdpSetStatus("error", "Not found"); return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _fdpRender(data);
  } catch (e) {
    console.error("FDP fetch error:", e);
    _fdpSetStatus("error", "Fetch failed");
  }
}

async function showFlightDetail(icao24) {
  // Stop any previous refresh
  if (fdpRefreshInterval) { clearInterval(fdpRefreshInterval); fdpRefreshInterval = null; }

  // Reset all FDP state
  fdpSelectedIcao24   = icao24;
  renderFlights(window.flightData);   // immediately repaint clicked marker orange
  _fdpCachedOrigin    = null;
  _fdpCachedDest      = null;
  _fdpAirportsFetched = false;
  fdpCountdownVal     = FDP_REFRESH_SECS;
  _fdpClearMapLayers();

  // Switch sidebar view
  const overview = document.getElementById("sidebar-overview");
  const detail   = document.getElementById("sidebar-flight-detail");
  if (overview) overview.hidden = true;
  if (detail)   detail.hidden   = false;

  // Initial fetch
  await _fdpRefresh();

  // Start auto-refresh
  fdpRefreshInterval = setInterval(async () => {
    await _fdpRefresh();
    fdpCountdownVal = FDP_REFRESH_SECS;
  }, FDP_REFRESH_SECS * 1000);
}

function closeFlightDetail() {
  if (fdpRefreshInterval) { clearInterval(fdpRefreshInterval); fdpRefreshInterval = null; }
  _fdpClearMapLayers();
  fdpSelectedIcao24   = null;
  renderFlights(window.flightData);   // restore yellow on previously selected marker
  _fdpCachedOrigin    = null;
  _fdpCachedDest      = null;
  _fdpAirportsFetched = false;

  // Return to overview
  const overview = document.getElementById("sidebar-overview");
  const detail   = document.getElementById("sidebar-flight-detail");
  if (overview) overview.hidden = false;
  if (detail)   detail.hidden   = true;

  // Remove flight list highlight
  document.querySelectorAll(".flight-list__item--active").forEach(el =>
    el.classList.remove("flight-list__item--active")
  );
}

// Countdown ticker for FDP auto-refresh
setInterval(() => {
  if (fdpSelectedIcao24 === null) return;
  fdpCountdownVal = Math.max(0, fdpCountdownVal - 1);
  const el = document.getElementById("fdp-countdown");
  if (el) el.textContent = fdpCountdownVal;
}, 1000);


/* ── ESC to deselect ──────────────────────────────────────────────────── */
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (fdpSelectedIcao24 !== null) { closeFlightDetail(); return; }
    if (selectedStateSlug !== null) deselectState();
  }
});


/* ── Bootstrap ────────────────────────────────────────────────────────── */
initStateLayer();
fetchAndRender();
startAutoRefresh();
