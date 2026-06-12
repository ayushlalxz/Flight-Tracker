/**
 * search.js — Flight search overlay on the main map.
 *
 * Reads window.flightData (populated by map.js after each fetch).
 * Navigates to /flight/<icao24> on selection.
 */

const _SEARCH_INPUT    = document.getElementById("search-input");
const _SEARCH_DROPDOWN = document.getElementById("search-dropdown");
const _SEARCH_WRAP     = document.getElementById("search-wrap");

const _MIN_CHARS   = 2;
const _MAX_RESULTS = 8;

let _activeIndex   = -1;
let _currentResults = [];


/* ── Filtering ────────────────────────────────────────────────────────── */

function filterFlights(query) {
  const q = query.toLowerCase();
  const matches = (window.flightData || []).filter(f => {
    const cs   = (f.callsign || "").toLowerCase();
    const icao = (f.icao24   || "").toLowerCase();
    return cs.includes(q) || icao.includes(q);
  });

  // Prefix matches on callsign float to the top
  matches.sort((a, b) => {
    const aPre = (a.callsign || "").toLowerCase().startsWith(q) ? 0 : 1;
    const bPre = (b.callsign || "").toLowerCase().startsWith(q) ? 0 : 1;
    return aPre - bPre;
  });

  return matches.slice(0, _MAX_RESULTS);
}


/* ── Dropdown rendering ───────────────────────────────────────────────── */

function renderDropdown(results) {
  _SEARCH_DROPDOWN.innerHTML = "";
  _activeIndex = -1;

  if (!results.length) {
    closeDropdown();
    return;
  }

  results.forEach((f, i) => {
    const li = document.createElement("li");
    li.className      = "search-dropdown__item";
    li.role           = "option";
    li.dataset.icao24 = f.icao24;
    li.dataset.index  = i;

    const altFt = f.altitude_m != null
      ? Math.round(f.altitude_m * 3.28084).toLocaleString() + " ft"
      : "on ground";
    const label = f.callsign || f.icao24 || "?";

    li.innerHTML =
      `<span class="search-dropdown__callsign">${label}</span>` +
      `<span class="search-dropdown__meta">${f.icao24} &middot; ${altFt}</span>`;

    // mousedown + preventDefault keeps focus on input until navigation fires
    li.addEventListener("mousedown", e => {
      e.preventDefault();
      navigateToFlight(f.icao24);
    });
    li.addEventListener("mouseover", () => setActiveIndex(i));

    _SEARCH_DROPDOWN.appendChild(li);
  });

  _SEARCH_DROPDOWN.hidden = false;
  _SEARCH_INPUT.setAttribute("aria-expanded", "true");
  _currentResults = results;
}

function setActiveIndex(index) {
  const items = _SEARCH_DROPDOWN.querySelectorAll(".search-dropdown__item");
  items.forEach(el => el.classList.remove("search-dropdown__item--active"));
  _activeIndex = index;
  if (index >= 0 && index < items.length) {
    items[index].classList.add("search-dropdown__item--active");
    items[index].scrollIntoView({ block: "nearest" });
  }
}

function closeDropdown() {
  _SEARCH_DROPDOWN.hidden = true;
  _SEARCH_INPUT.setAttribute("aria-expanded", "false");
  _activeIndex    = -1;
  _currentResults = [];
}

function navigateToFlight(icao24) {
  if (!icao24) return;
  closeDropdown();
  if (typeof showFlightDetail === "function") {
    showFlightDetail(icao24);
  } else {
    window.location.href = "/flight/" + icao24;
  }
}


/* ── Event listeners ──────────────────────────────────────────────────── */

if (_SEARCH_INPUT) {
  _SEARCH_INPUT.addEventListener("input", () => {
    const q = _SEARCH_INPUT.value.trim();
    if (q.length < _MIN_CHARS) { closeDropdown(); return; }
    renderDropdown(filterFlights(q));
  });

  _SEARCH_INPUT.addEventListener("keydown", e => {
    if (_SEARCH_DROPDOWN.hidden) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(Math.min(_activeIndex + 1, _currentResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(Math.max(_activeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = _activeIndex >= 0
        ? _currentResults[_activeIndex]
        : _currentResults.length === 1 ? _currentResults[0] : null;
      if (target) navigateToFlight(target.icao24);
    } else if (e.key === "Escape") {
      closeDropdown();
      _SEARCH_INPUT.blur();
    }
  });
}

document.addEventListener("click", e => {
  if (_SEARCH_WRAP && !_SEARCH_WRAP.contains(e.target)) {
    closeDropdown();
  }
});
