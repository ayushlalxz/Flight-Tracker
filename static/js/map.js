/**
 * map.js — Leaflet map initialisation and flight marker management
 *
 * Responsibilities:
 *  - Initialise the map centred on India with a dark tile layer
 *  - Render plane markers (SVG, rotated to heading) for each flight
 *  - Fetch /api/flights, store result in window.flightData, call sidebar
 *  - Auto-refresh on a configurable interval (AUTO_REFRESH_SECONDS from template)
 */

/* ── Map init ─────────────────────────────────────────────────────────── */
const map = L.map("map", {
  center: [20.5937, 78.9629],   // geographic centre of India
  zoom: 5,
  zoomControl: true,
  attributionControl: true,
});

// CartoDB Dark Matter — no API key required
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

/* ── State ────────────────────────────────────────────────────────────── */
/** @type {L.Marker[]} — current set of plane markers on the map */
let planeMarkers = [];

/** @type {number|null} — setInterval handle for auto-refresh */
let refreshInterval = null;

/** @type {boolean} */
let autoRefreshEnabled = true;

/** Shared flight data — sidebar.js reads this via window.flightData */
window.flightData = [];


/* ── SVG plane icon ───────────────────────────────────────────────────── */
/**
 * Build an L.DivIcon containing an SVG plane rotated to the given heading.
 * @param {number} heading — true track in degrees (0=N, 90=E …)
 * @param {boolean} onGround
 * @returns {L.DivIcon}
 */
function makePlaneIcon(heading, onGround) {
  const color  = onGround ? "#f0883e" : "#58a6ff";
  const size   = onGround ? 14 : 18;

  // Simple arrow/plane shape — points upward (north = 0°)
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
    className:  "",  // disable leaflet-div-icon default white box
  });
}


/* ── Popup content ────────────────────────────────────────────────────── */
/**
 * Build HTML for a Leaflet popup given a flight object.
 * @param {Object} f — flight data object from the API
 * @returns {string} HTML string
 */
function buildPopup(f) {
  const altFt  = f.altitude_m != null ? Math.round(f.altitude_m * 3.28084).toLocaleString() : "—";
  const spdKmh = f.velocity_ms != null ? Math.round(f.velocity_ms * 3.6).toLocaleString() : "—";
  const hdg    = f.heading != null ? `${Math.round(f.heading)}°` : "—";

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
/**
 * Clear existing markers and re-draw all flights on the map.
 * @param {Object[]} flights — array of flight objects from /api/flights
 */
function renderFlights(flights) {
  // Remove old markers
  planeMarkers.forEach(m => map.removeLayer(m));
  planeMarkers = [];

  flights.forEach(f => {
    if (f.latitude == null || f.longitude == null) return;

    const icon   = makePlaneIcon(f.heading || 0, f.on_ground);
    const marker = L.marker([f.latitude, f.longitude], { icon });

    marker.bindPopup(buildPopup(f), { maxWidth: 240 });
    marker.addTo(map);
    planeMarkers.push(marker);

    // Expose a programmatic focus method so sidebar rows can fly to plane
    marker._flightData = f;
  });
}


/* ── API fetch ────────────────────────────────────────────────────────── */
/**
 * Fetch /api/flights, update window.flightData, re-render markers,
 * and notify sidebar.js.
 */
async function fetchAndRender() {
  setSourceBadge("idle", "Fetching…");

  try {
    const res  = await fetch("/api/flights");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    window.flightData = json.flights || [];
    renderFlights(window.flightData);

    // Notify sidebar (defined in sidebar.js)
    if (typeof updateStats     === "function") updateStats(window.flightData);
    if (typeof updateFlightList === "function") updateFlightList(window.flightData);

    const label = json.source === "cached" ? "cached" : "live";
    const text  = json.source === "cached"
      ? `Cached — ${window.flightData.length} flights`
      : `Live — ${window.flightData.length} flights`;
    setSourceBadge(label, text);

  } catch (err) {
    console.error("fetchAndRender error:", err);
    setSourceBadge("error", "Fetch failed");
  }
}


/* ── Source badge helper ──────────────────────────────────────────────── */
/**
 * Update the data-source badge in the sidebar.
 * @param {"idle"|"live"|"cached"|"error"} state
 * @param {string} text
 */
function setSourceBadge(state, text) {
  const el = document.getElementById("data-source");
  if (!el) return;
  el.className = `source-badge source-badge--${state}`;
  el.textContent = text;
}


/* ── Pan to plane (called by sidebar.js) ─────────────────────────────── */
/**
 * Pan and zoom the map to a specific flight by ICAO24.
 * @param {string} icao24
 */
function focusFlight(icao24) {
  const marker = planeMarkers.find(m => m._flightData?.icao24 === icao24);
  if (!marker) return;

  const latlng = marker.getLatLng();
  map.flyTo(latlng, Math.max(map.getZoom(), 8), { duration: 0.8 });
  marker.openPopup();
}


/* ── Auto-refresh ─────────────────────────────────────────────────────── */
/** Start (or restart) the countdown and setInterval. */
function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshEnabled = true;
  resetCountdown();
  refreshInterval = setInterval(() => {
    fetchAndRender();
    resetCountdown();
  }, AUTO_REFRESH_SECONDS * 1000);
}

function stopAutoRefresh() {
  if (refreshInterval !== null) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

/** Exposed to index.html toggle button */
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

/** Exposed to index.html manual-refresh button */
function manualRefresh() {
  fetchAndRender();
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


/* ── Bootstrap ────────────────────────────────────────────────────────── */
fetchAndRender();
startAutoRefresh();
