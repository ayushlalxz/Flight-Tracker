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
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  {
    attribution:
      '&copy; <a href="https://carto.com/">CARTO</a> | ' +
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    subdomains: "abcd",
    maxZoom: 19,
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
function makePlaneIcon(heading, onGround) {
  const color = onGround ? "#f0883e" : "#58a6ff";
  const size  = onGround ? 14 : 18;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg"
         width="${size}" height="${size}"
         viewBox="0 0 24 24"
         style="transform:rotate(${heading}deg);display:block;">
      <path fill="${color}"
        d="M12 2
           L8  20 L12 17 L16 20 Z
           M10 10 L4 14 L5 12 L10 8 Z
           M14 10 L20 14 L19 12 L14 8 Z"/>
    </svg>`;

  return L.divIcon({
    html: `<div class="plane-marker">${svg}</div>`,
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

    const icon   = makePlaneIcon(f.heading || 0, f.on_ground);
    const marker = L.marker([f.latitude, f.longitude], { icon });

    marker.bindPopup(buildPopup(f), { maxWidth: 240 });
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


/* ── Pan to plane (called by sidebar.js) ─────────────────────────────── */
function focusFlight(icao24) {
  const marker = planeMarkers.find(m => m._flightData?.icao24 === icao24);
  if (!marker) return;

  const latlng = marker.getLatLng();
  map.flyTo(latlng, Math.max(map.getZoom(), 8), { duration: 0.8 });
  marker.openPopup();
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
  color:       "#3a3f4b",
  weight:      1,
  opacity:     0.6,
  fillColor:   "#ffffff",
  fillOpacity: 0.02,
};

const STATE_STYLE_HOVER = {
  color:   "#F5F0E8",
  weight:  3,
  opacity: 1,
};

const STATE_STYLE_SELECTED = {
  color:       "#F5F0E8",
  weight:      3,
  opacity:     1,
  fillColor:   "#F5F0E8",
  fillOpacity: 0.06,
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


/* ── ESC to deselect ──────────────────────────────────────────────────── */
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && selectedStateSlug !== null) deselectState();
});


/* ── Bootstrap ────────────────────────────────────────────────────────── */
initStateLayer();
fetchAndRender();
startAutoRefresh();
