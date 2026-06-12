/**
 * flight.js — Per-aircraft detail page.
 *
 * FLIGHT_ICAO24 is injected by flight.html before this script loads.
 * First refresh fetches origin/destination (cached thereafter).
 * Subsequent 10-second ticks only update the current position marker.
 */

const DETAIL_REFRESH_SECONDS = 10;

let detailMap       = null;
let cachedOrigin    = null;
let cachedDest      = null;
let airportsFetched = false;   // set to true after the first successful refresh

let currentMarker = null;
let originMarker  = null;
let destMarker    = null;
let solidLine     = null;
let dashedLine    = null;

let countdownVal   = DETAIL_REFRESH_SECONDS;


/* ── Map init ─────────────────────────────────────────────────────────── */

function initMap() {
  detailMap = L.map("flight-map", {
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
  ).addTo(detailMap);
}


/* ── Marker icon factories ────────────────────────────────────────────── */

function makeCurrentIcon(heading) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"
       width="28" height="28" viewBox="0 0 32 32"
       style="transform:rotate(${heading}deg);display:block;">
    <path fill="#ff8c00" stroke="rgba(0,0,0,0.55)" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round"
          d="M16 2 L18 7 L18 12 L30 20 L29 22 L19 16
      L20 22 L25 27 L23 29 L18 25 L17 30 L15 30
      L14 25 L9 29 L7 27 L12 22 L13 16 L3 22 L2 20
      L14 12 L14 7 Z"/>
  </svg>`;
  return L.divIcon({
    html:       `<div class="plane-marker plane-marker--current">${svg}</div>`,
    iconSize:   [28, 28],
    iconAnchor: [14, 14],
    className:  "",
  });
}

function makeOriginIcon() {
  return L.divIcon({
    html:       '<div class="airport-marker airport-marker--origin"></div>',
    iconSize:   [12, 12],
    iconAnchor: [6, 6],
    className:  "",
  });
}

function makeDestIcon() {
  return L.divIcon({
    html:       '<div class="airport-marker airport-marker--dest"></div>',
    iconSize:   [12, 12],
    iconAnchor: [6, 6],
    className:  "",
  });
}


/* ── Data fetching ────────────────────────────────────────────────────── */

async function fetchFlightData() {
  try {
    const res = await fetch(`/api/flight/${FLIGHT_ICAO24}`);
    if (res.status === 404) {
      setStatus("error", "Aircraft not found");
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Flight detail fetch error:", err);
    setStatus("error", "Fetch failed");
    return null;
  }
}


/* ── Map rendering ────────────────────────────────────────────────────── */

function renderCurrentMarker(position) {
  const latlng = [position.latitude, position.longitude];
  const icon   = makeCurrentIcon(position.heading || 0);

  if (currentMarker) {
    currentMarker.setLatLng(latlng);
    currentMarker.setIcon(icon);
  } else {
    currentMarker = L.marker(latlng, { icon })
      .bindTooltip(position.callsign || FLIGHT_ICAO24, { permanent: false })
      .addTo(detailMap);
  }

  // Pan to current position only on the very first render
  if (!airportsFetched) {
    detailMap.setView(latlng, 7);
  }
}

function renderAirportMarkers(origin, dest) {
  if (origin && origin.lat != null) {
    originMarker = L.marker([origin.lat, origin.lon], { icon: makeOriginIcon() })
      .bindTooltip(`Origin: ${origin.city || origin.icao}`, { permanent: false })
      .addTo(detailMap);
  }
  if (dest && dest.lat != null) {
    destMarker = L.marker([dest.lat, dest.lon], { icon: makeDestIcon() })
      .bindTooltip(`Dest: ${dest.city || dest.icao}`, { permanent: false })
      .addTo(detailMap);
  }

  // Fit map to show all points after airports are placed
  const pts = [];
  if (origin && origin.lat != null) pts.push([origin.lat, origin.lon]);
  if (currentMarker)                pts.push(currentMarker.getLatLng());
  if (dest   && dest.lat   != null) pts.push([dest.lat,   dest.lon]);
  if (pts.length > 1) {
    detailMap.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
  }
}

function renderPolylines(origin, currentPos, dest) {
  if (solidLine)  { detailMap.removeLayer(solidLine);  solidLine  = null; }
  if (dashedLine) { detailMap.removeLayer(dashedLine); dashedLine = null; }

  const cur = [currentPos.latitude, currentPos.longitude];

  if (origin && origin.lat != null) {
    solidLine = L.polyline([[origin.lat, origin.lon], cur], {
      color:   "#58a6ff",
      weight:  2,
      opacity: 0.7,
    }).addTo(detailMap);
  }

  if (dest && dest.lat != null) {
    dashedLine = L.polyline([cur, [dest.lat, dest.lon]], {
      color:     "#8b949e",
      weight:    2,
      opacity:   0.5,
      dashArray: "6 6",
    }).addTo(detailMap);
  }
}


/* ── Sidebar population ───────────────────────────────────────────────── */

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function populateSidebar(data) {
  const p = data.position;

  setText("fp-callsign", p.callsign || p.icao24 || "—");
  setText("fp-altitude", p.altitude_m  != null
    ? Math.round(p.altitude_m  * 3.28084).toLocaleString() : "—");
  setText("fp-speed",    p.velocity_ms != null
    ? Math.round(p.velocity_ms * 3.6).toLocaleString()     : "—");
  setText("fp-heading",  p.heading     != null ? Math.round(p.heading).toString() : "—");
  setText("fp-country",  p.origin_country || "—");
  setText("fp-timestamp", p.fetched_at
    ? new Date(p.fetched_at).toLocaleTimeString() : "—");

  // Airport info — only populate on first call
  if (!airportsFetched) {
    const orig = data.origin;
    const dst  = data.destination;
    setText("fp-origin-name", orig ? (orig.name || orig.icao || "—") : "Unknown");
    setText("fp-origin-icao", orig ? orig.icao : "—");
    setText("fp-dest-name",   dst  ? (dst.name  || dst.icao  || "—") : "Unknown");
    setText("fp-dest-icao",   dst  ? dst.icao  : "—");
  }
}

function setStatus(state, text) {
  const el = document.getElementById("fp-status");
  if (!el) return;
  el.className   = `source-badge source-badge--${state}`;
  el.textContent = text;
}


/* ── Main refresh cycle ───────────────────────────────────────────────── */

async function refresh() {
  setStatus("idle", "Fetching…");
  const data = await fetchFlightData();
  if (!data) return;

  const position = data.position;

  if (!airportsFetched) {
    cachedOrigin    = data.origin;
    cachedDest      = data.destination;
    airportsFetched = true;
    renderAirportMarkers(cachedOrigin, cachedDest);
  }

  renderCurrentMarker(position);
  renderPolylines(cachedOrigin, position, cachedDest);
  populateSidebar(data);
  setStatus("live", "Live");
}


/* ── Countdown ticker ─────────────────────────────────────────────────── */

function startCountdown() {
  const el = document.getElementById("fp-countdown");
  setInterval(() => {
    countdownVal = Math.max(0, countdownVal - 1);
    if (el) el.textContent = countdownVal;
  }, 1000);
}


/* ── Bootstrap ────────────────────────────────────────────────────────── */
initMap();
refresh();

setInterval(() => {
  refresh();
  countdownVal = DETAIL_REFRESH_SECONDS;
}, DETAIL_REFRESH_SECONDS * 1000);

startCountdown();
