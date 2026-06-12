# api/flights.py — /api/flights endpoint

import logging

from flask import Blueprint, jsonify

from api.helpers import fetch_from_opensky, insert_flights, fetch_last_snapshot
import config

logger = logging.getLogger(__name__)

flights_bp = Blueprint("flights", __name__)


@flights_bp.route("/api/flights")
def get_flights():
    """
    GET /api/flights

    Fetch current state vectors from OpenSky for India's bounding box,
    persist to MySQL, and return as JSON.  Falls back to the most-recent
    DB snapshot if OpenSky is unreachable.
    """
    try:
        flights = fetch_from_opensky(config.INDIA_BBOX)
        insert_flights(flights)
        source = "live"
    except Exception as exc:
        logger.warning("OpenSky unavailable (%s) — serving cached data.", exc)
        flights = fetch_last_snapshot()
        source = "cached"

    return jsonify({"source": source, "count": len(flights), "flights": flights})
