# api/flights.py — /api/flights endpoint
#
# Fetches live state vectors from the OpenSky Network for the Indian
# bounding box, persists them to MySQL, and returns the current snapshot
# as a JSON array. Falls back to the most-recent DB records if OpenSky
# is unreachable.

import logging
from datetime import datetime

import mysql.connector
import requests
from flask import Blueprint, jsonify

import config

logger = logging.getLogger(__name__)

flights_bp = Blueprint("flights", __name__)


# ── DB helpers ─────────────────────────────────────────────────────────────

def _get_connection():
    """Open and return a new MySQL connection using config credentials."""
    return mysql.connector.connect(
        host=config.DB_HOST,
        user=config.DB_USER,
        password=config.DB_PASSWORD,
        database=config.DB_NAME,
    )


def _insert_flights(flights: list[dict]) -> None:
    """Bulk-insert a list of flight dicts into the flights table."""
    if not flights:
        return

    sql = """
        INSERT INTO flights
            (icao24, callsign, origin_country, longitude, latitude,
             altitude_m, velocity_ms, heading, on_ground)
        VALUES
            (%(icao24)s, %(callsign)s, %(origin_country)s, %(longitude)s,
             %(latitude)s, %(altitude_m)s, %(velocity_ms)s, %(heading)s,
             %(on_ground)s)
    """
    try:
        conn = _get_connection()
        cursor = conn.cursor()
        cursor.executemany(sql, flights)
        conn.commit()
    except mysql.connector.Error as exc:
        logger.error("DB insert error: %s", exc)
    finally:
        cursor.close()
        conn.close()


def _fetch_last_snapshot() -> list[dict]:
    """Return the most-recent batch of flights stored in the DB."""
    sql = """
        SELECT icao24, callsign, origin_country, longitude, latitude,
               altitude_m, velocity_ms, heading, on_ground, fetched_at
        FROM flights
        WHERE fetched_at = (SELECT MAX(fetched_at) FROM flights)
        LIMIT 500
    """
    try:
        conn = _get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(sql)
        rows = cursor.fetchall()
        # Convert datetime to ISO string for JSON serialisation
        for r in rows:
            if isinstance(r.get("fetched_at"), datetime):
                r["fetched_at"] = r["fetched_at"].isoformat()
        return rows
    except mysql.connector.Error as exc:
        logger.error("DB read error: %s", exc)
        return []
    finally:
        cursor.close()
        conn.close()


# ── OpenSky helpers ────────────────────────────────────────────────────────

# OpenSky state-vector column indices (as per their REST docs)
_COL = {
    "icao24":         0,
    "callsign":       1,
    "origin_country": 2,
    "time_position":  3,
    "last_contact":   4,
    "longitude":      5,
    "latitude":       6,
    "baro_altitude":  7,
    "on_ground":      8,
    "velocity":       9,
    "true_track":     10,
    "vertical_rate":  11,
    "sensors":        12,
    "geo_altitude":   13,
    "squawk":         14,
    "spi":            15,
    "position_source":16,
}


def _parse_state(sv: list) -> dict | None:
    """
    Convert a raw OpenSky state-vector list to a flight dict.
    Returns None if lat/lon is missing (aircraft not broadcasting position).
    """
    lat = sv[_COL["latitude"]]
    lon = sv[_COL["longitude"]]
    if lat is None or lon is None:
        return None

    return {
        "icao24":         (sv[_COL["icao24"]] or "").strip(),
        "callsign":       (sv[_COL["callsign"]] or "").strip(),
        "origin_country": (sv[_COL["origin_country"]] or "").strip(),
        "longitude":      lon,
        "latitude":       lat,
        "altitude_m":     sv[_COL["geo_altitude"]],   # geometric altitude (m)
        "velocity_ms":    sv[_COL["velocity"]],        # m/s
        "heading":        sv[_COL["true_track"]] or 0,
        "on_ground":      bool(sv[_COL["on_ground"]]),
    }


def _fetch_from_opensky() -> list[dict]:
    """
    Call the OpenSky REST API for the India bounding box.
    Returns a list of parsed flight dicts, or raises on network error.
    """
    params = {
        "lamin": config.INDIA_BBOX["lamin"],
        "lomin": config.INDIA_BBOX["lomin"],
        "lamax": config.INDIA_BBOX["lamax"],
        "lomax": config.INDIA_BBOX["lomax"],
    }
    auth = None
    if config.OPENSKY_USER and config.OPENSKY_PASS:
        auth = (config.OPENSKY_USER, config.OPENSKY_PASS)

    response = requests.get(
        config.OPENSKY_URL,
        params=params,
        auth=auth,
        timeout=15,
    )
    response.raise_for_status()

    data = response.json()
    states = data.get("states") or []
    flights = [_parse_state(sv) for sv in states]
    return [f for f in flights if f is not None]


# ── Route ──────────────────────────────────────────────────────────────────

@flights_bp.route("/api/flights")
def get_flights():
    """
    GET /api/flights

    1. Fetch current state vectors from OpenSky for India's bounding box.
    2. Persist them to MySQL.
    3. Return the list as JSON.

    If OpenSky is unreachable (rate-limited / network error), return the
    most-recent snapshot from the database instead.
    """
    try:
        flights = _fetch_from_opensky()
        _insert_flights(flights)
        source = "live"
    except Exception as exc:
        logger.warning("OpenSky unavailable (%s) — serving cached data.", exc)
        flights = _fetch_last_snapshot()
        source = "cached"

    return jsonify({"source": source, "count": len(flights), "flights": flights})
