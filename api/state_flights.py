# api/state_flights.py — /api/flights/<state_slug> endpoint
#
# Builds a registry of Indian states from india-states.geojson at startup.
# Each request uses the state's tight bounding box for the OpenSky call, then
# applies a Shapely point-in-polygon filter to drop aircraft in neighbouring
# states that fall inside the rectangular bbox.

import json
import logging
import os
import re

from flask import Blueprint, jsonify
from shapely.geometry import Point, shape

from api.helpers import fetch_from_opensky, insert_flights, fetch_last_snapshot

logger = logging.getLogger(__name__)

state_flights_bp = Blueprint("state_flights", __name__)


# ── Registry ─────────────────────────────────────────────────────────────────

def _name_to_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")


def _build_registry() -> dict:
    """
    Read india-states.geojson once at startup and return a slug-keyed dict:
        { "maharashtra": {"name": ..., "bbox": {...}, "geometry": <Shapely>}, ... }
    Bboxes are derived from each geometry's bounds — no hardcoded values needed.
    """
    geojson_path = os.path.join(
        os.path.dirname(__file__), "..", "static", "geo", "india-states.geojson"
    )
    with open(geojson_path, encoding="utf-8") as f:
        data = json.load(f)

    registry = {}
    for feature in data["features"]:
        name = feature["properties"].get("NAME_1", "").strip()
        if not name:
            continue
        slug = _name_to_slug(name)
        geom = shape(feature["geometry"])
        minx, miny, maxx, maxy = geom.bounds   # lon_min, lat_min, lon_max, lat_max
        registry[slug] = {
            "name":     name,
            "bbox":     {"lomin": minx, "lamin": miny, "lomax": maxx, "lamax": maxy},
            "geometry": geom,
        }

    logger.info("State registry built: %d states loaded.", len(registry))
    return registry


_STATE_REGISTRY: dict = _build_registry()


# ── Route ─────────────────────────────────────────────────────────────────────

@state_flights_bp.route("/api/flights/<state_slug>")
def get_state_flights(state_slug: str):
    """
    GET /api/flights/<state_slug>

    1. Validate slug against the registry.
    2. Fetch from OpenSky using the state's tight bounding box.
    3. Post-filter with Shapely point-in-polygon (handles concave shapes).
    4. Persist matching flights to MySQL.
    5. Return same JSON shape as /api/flights plus a "state" field.

    Falls back to the India-wide DB snapshot (filtered in-memory) on error.
    """
    entry = _STATE_REGISTRY.get(state_slug)
    if entry is None:
        return jsonify({"error": f"Unknown state: {state_slug}"}), 404

    state_name = entry["name"]
    state_geom = entry["geometry"]
    bbox       = entry["bbox"]

    def _in_state(f: dict) -> bool:
        lon, lat = f.get("longitude"), f.get("latitude")
        if lon is None or lat is None:
            return False
        return state_geom.contains(Point(lon, lat))

    try:
        candidates = fetch_from_opensky(bbox)
        flights    = [f for f in candidates if _in_state(f)]
        insert_flights(flights)
        source = "live"
    except Exception as exc:
        logger.warning(
            "OpenSky unavailable for %s (%s) — serving cached data.", state_name, exc
        )
        all_cached = fetch_last_snapshot()
        flights    = [f for f in all_cached if _in_state(f)]
        source     = "cached"

    return jsonify({
        "source":  source,
        "state":   state_name,
        "count":   len(flights),
        "flights": flights,
    })
