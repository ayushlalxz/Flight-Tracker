/**
 * sidebar.js — stat cards, flight list, and live clock
 *
 * Reads window.flightData (populated by map.js) and updates the UI.
 * Also controls the auto-refresh toggle state copy in the sidebar.
 */

/* ── Live clock ───────────────────────────────────────────────────────── */
/**
 * Write the current local time to #clock in HH:MM:SS format.
 * Called every second via setInterval.
 */
function updateClock() {
  const now  = new Date();
  const pad  = n => String(n).padStart(2, "0");
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const el = document.getElementById("clock");
  if (el) el.textContent = time;
}

setInterval(updateClock, 1000);
updateClock(); // immediate first tick


/* ── Stat cards ───────────────────────────────────────────────────────── */
/**
 * Calculate summary stats from an array of flight objects and update the
 * four stat-card elements.
 *
 * @param {Object[]} flights
 */
function updateStats(flights) {
  // Active flights
  const activeEl = document.getElementById("stat-active");
  if (activeEl) activeEl.textContent = flights.length;

  // Airborne-only subset for averages
  const airborne = flights.filter(f => !f.on_ground && f.altitude_m != null);

  // Avg altitude (m → ft)
  const altEl = document.getElementById("stat-altitude");
  if (altEl) {
    if (airborne.length === 0) {
      altEl.textContent = "—";
    } else {
      const avgAltM  = airborne.reduce((s, f) => s + f.altitude_m, 0) / airborne.length;
      const avgAltFt = Math.round(avgAltM * 3.28084);
      altEl.textContent = avgAltFt.toLocaleString();
    }
  }

  // Avg speed (m/s → km/h)
  const spdEl = document.getElementById("stat-speed");
  if (spdEl) {
    const withSpeed = airborne.filter(f => f.velocity_ms != null);
    if (withSpeed.length === 0) {
      spdEl.textContent = "—";
    } else {
      const avgMs  = withSpeed.reduce((s, f) => s + f.velocity_ms, 0) / withSpeed.length;
      const avgKmh = Math.round(avgMs * 3.6);
      spdEl.textContent = avgKmh.toLocaleString();
    }
  }

  // Top origin country
  const countryEl = document.getElementById("stat-country");
  if (countryEl) {
    const freq = {};
    flights.forEach(f => {
      if (f.origin_country) {
        freq[f.origin_country] = (freq[f.origin_country] || 0) + 1;
      }
    });
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    countryEl.textContent = top ? top[0] : "—";
  }
}


/* ── Flight list ──────────────────────────────────────────────────────── */
/** Track the currently highlighted list item */
let activeListItem = null;

/**
 * Re-render the scrollable flight list.
 * Each row pans the map to that plane when clicked.
 *
 * @param {Object[]} flights
 */
function updateFlightList(flights) {
  const ul = document.getElementById("flight-list");
  if (!ul) return;

  if (flights.length === 0) {
    ul.innerHTML = '<li class="flight-list__empty">No flights in range.</li>';
    return;
  }

  // Sort airborne first, then alphabetically by callsign
  const sorted = [...flights].sort((a, b) => {
    if (a.on_ground !== b.on_ground) return a.on_ground ? 1 : -1;
    return (a.callsign || "").localeCompare(b.callsign || "");
  });

  ul.innerHTML = "";

  sorted.forEach(f => {
    const label  = f.callsign || f.icao24 || "?";
    const altFt  = f.altitude_m  != null ? Math.round(f.altitude_m  * 3.28084).toLocaleString() : "—";
    const spdKmh = f.velocity_ms != null ? Math.round(f.velocity_ms * 3.6).toLocaleString()     : "—";

    const li = document.createElement("li");
    li.className = "flight-list__item";
    li.setAttribute("role", "listitem");
    li.setAttribute("tabindex", "0");
    li.dataset.icao24 = f.icao24 || "";

    li.innerHTML = `
      <span class="flight-list__callsign">${label}</span>
      <span class="flight-list__country">${f.origin_country || "—"}</span>
      <span class="flight-list__alt">${altFt}</span>
      <span class="flight-list__spd">${spdKmh}</span>`;

    // Click: pan map to this plane
    li.addEventListener("click", () => selectFlight(li, f.icao24));

    // Keyboard: Enter / Space also selects
    li.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectFlight(li, f.icao24);
      }
    });

    ul.appendChild(li);
  });
}


/**
 * Highlight a list row and tell map.js to pan to that plane.
 * @param {HTMLElement} li
 * @param {string} icao24
 */
function selectFlight(li, icao24) {
  // Remove previous highlight
  if (activeListItem) activeListItem.classList.remove("flight-list__item--active");
  activeListItem = li;
  li.classList.add("flight-list__item--active");

  // Delegate map pan to map.js (function defined there)
  if (typeof focusFlight === "function") {
    focusFlight(icao24);
  }
}
