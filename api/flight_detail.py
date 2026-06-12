# api/flight_detail.py — /api/flight/<icao24> endpoint
#
# Loads the airport registry from static/data/airports.json at startup,
# then serves per-aircraft detail: current DB position + OpenSky flight
# history (departure / arrival airports).

import json
import logging
import os
import re
import time

import requests
from flask import Blueprint, jsonify

from api.helpers import fetch_flight_by_icao24
import config

logger = logging.getLogger(__name__)

flight_detail_bp = Blueprint("flight_detail", __name__)

_ICAO24_RE = re.compile(r'^[0-9a-fA-F]{6}$')


# ── Airport registry ──────────────────────────────────────────────────────────

def _load_airports() -> dict:
    path = os.path.join(
        os.path.dirname(__file__), "..", config.AIRPORTS_JSON_PATH
    )
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        logger.info("Airport registry loaded: %d airports.", len(data))
        return data
    except FileNotFoundError:
        logger.warning(
            "airports.json not found at %s — run scripts/generate_airports.py", path
        )
        return {}
    except json.JSONDecodeError as exc:
        logger.error("airports.json parse error: %s", exc)
        return {}


_AIRPORT_REGISTRY: dict = _load_airports()


def _resolve_airport(icao_code: str | None) -> dict | None:
    """
    Look up an ICAO airport code in the registry.
    Returns a dict with icao, name, city, country, lat, lon.
    If code exists but is not in registry, returns a stub with null lat/lon
    so the client can still display the raw ICAO code.
    Returns None if code is absent or empty.
    """
    if not icao_code:
        return None
    code  = icao_code.strip().upper()
    entry = _AIRPORT_REGISTRY.get(code)
    if entry:
        return {"icao": code, **entry}
    return {"icao": code, "name": None, "city": None, "country": None, "lat": None, "lon": None}


# ── Route ─────────────────────────────────────────────────────────────────────

@flight_detail_bp.route("/api/flight/<icao24>")
def get_flight_detail(icao24: str):
    """
    GET /api/flight/<icao24>

    1. Validate hex format.
    2. Fetch current position from DB.
    3. Call OpenSky flight-history API for departure / arrival airports.
    4. Resolve airport ICAO codes from the bundled registry.
    5. Return combined JSON.
    """
    if not _ICAO24_RE.match(icao24):
        return jsonify({"error": "Invalid ICAO24 — must be 6 hex characters"}), 400

    icao24 = icao24.lower()

    position = fetch_flight_by_icao24(icao24)
    if position is None:
        return jsonify({"error": f"Aircraft {icao24} not found"}), 404

    origin_airport = None
    dest_airport   = None

    try:
        now    = int(time.time())
        params = {"icao24": icao24, "begin": now - 86400, "end": now}
        auth   = (config.OPENSKY_USER, config.OPENSKY_PASS) if config.OPENSKY_USER else None

        resp = requests.get(
            config.OPENSKY_FLIGHTS_URL,
            params=params,
            auth=auth,
            timeout=10,
        )

        if resp.status_code == 200:
            history = resp.json()
            if history:
                latest         = history[-1]
                origin_airport = _resolve_airport(latest.get("estDepartureAirport"))
                dest_airport   = _resolve_airport(latest.get("estArrivalAirport"))
        elif resp.status_code not in (404, 429):
            logger.warning("OpenSky flights API returned %s for %s", resp.status_code, icao24)

    except Exception as exc:
        logger.warning("OpenSky flight history unavailable for %s: %s", icao24, exc)

    return jsonify({
        "icao24":      icao24,
        "position":    position,
        "origin":      origin_airport,
        "destination": dest_airport,
    })
