# api/helpers.py — shared DB and OpenSky utilities
#
# Extracted from flights.py so both flights.py and state_flights.py can
# import without duplication or circular dependencies.

import logging
from datetime import datetime

import mysql.connector
import requests

import config

logger = logging.getLogger(__name__)

# ── DB ─────────────────────────────────────────────────────────────────────

def get_connection():
    return mysql.connector.connect(
        host=config.DB_HOST,
        user=config.DB_USER,
        password=config.DB_PASSWORD,
        database=config.DB_NAME,
    )


def insert_flights(flights: list[dict]) -> None:
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
        conn = get_connection()
        cursor = conn.cursor()
        cursor.executemany(sql, flights)
        conn.commit()
    except mysql.connector.Error as exc:
        logger.error("DB insert error: %s", exc)
    finally:
        cursor.close()
        conn.close()


def fetch_last_snapshot() -> list[dict]:
    sql = """
        SELECT icao24, callsign, origin_country, longitude, latitude,
               altitude_m, velocity_ms, heading, on_ground, fetched_at
        FROM flights
        WHERE fetched_at = (SELECT MAX(fetched_at) FROM flights)
        LIMIT 500
    """
    try:
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(sql)
        rows = cursor.fetchall()
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


# ── OpenSky ─────────────────────────────────────────────────────────────────

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
        "altitude_m":     sv[_COL["geo_altitude"]],
        "velocity_ms":    sv[_COL["velocity"]],
        "heading":        sv[_COL["true_track"]] or 0,
        "on_ground":      bool(sv[_COL["on_ground"]]),
    }


def fetch_from_opensky(bbox: dict) -> list[dict]:
    """
    Fetch state vectors from OpenSky for an arbitrary bounding box.
    bbox must have keys: lamin, lomin, lamax, lomax.
    Returns a list of parsed flight dicts, or raises on network/HTTP error.
    """
    params = {
        "lamin": bbox["lamin"],
        "lomin": bbox["lomin"],
        "lamax": bbox["lamax"],
        "lomax": bbox["lomax"],
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

    states = response.json().get("states") or []
    return [f for f in (_parse_state(sv) for sv in states) if f is not None]
