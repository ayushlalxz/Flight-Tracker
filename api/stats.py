# api/stats.py — /api/stats endpoint
#
# Aggregates statistics from today's flight records in MySQL and returns
# them as a JSON object for the sidebar stat-cards.

import logging
from datetime import date

import mysql.connector
from flask import Blueprint, jsonify

import config

logger = logging.getLogger(__name__)

stats_bp = Blueprint("stats", __name__)


def _get_connection():
    """Open and return a new MySQL connection using config credentials."""
    return mysql.connector.connect(
        host=config.DB_HOST,
        user=config.DB_USER,
        password=config.DB_PASSWORD,
        database=config.DB_NAME,
    )


@stats_bp.route("/api/stats")
def get_stats():
    """
    GET /api/stats

    Returns aggregate statistics calculated from today's stored flight
    records:
      - total_today:   distinct ICAO24 addresses seen today
      - avg_altitude:  mean geometric altitude in metres (airborne only)
      - avg_speed:     mean ground speed in m/s (airborne only)
      - top_country:   origin country with the most flights today
    """
    today = date.today().isoformat()

    sql_total = """
        SELECT COUNT(DISTINCT icao24)
        FROM flights
        WHERE DATE(fetched_at) = %s
    """
    sql_avg = """
        SELECT AVG(altitude_m), AVG(velocity_ms)
        FROM flights
        WHERE DATE(fetched_at) = %s
          AND on_ground = FALSE
          AND altitude_m IS NOT NULL
    """
    sql_top_country = """
        SELECT origin_country, COUNT(*) AS cnt
        FROM flights
        WHERE DATE(fetched_at) = %s
          AND origin_country <> ''
        GROUP BY origin_country
        ORDER BY cnt DESC
        LIMIT 1
    """

    result = {
        "total_today":   0,
        "avg_altitude":  None,
        "avg_speed":     None,
        "top_country":   "—",
    }

    try:
        conn = _get_connection()
        cursor = conn.cursor()

        cursor.execute(sql_total, (today,))
        row = cursor.fetchone()
        result["total_today"] = row[0] if row else 0

        cursor.execute(sql_avg, (today,))
        row = cursor.fetchone()
        if row and row[0] is not None:
            result["avg_altitude"] = round(float(row[0]), 1)
            result["avg_speed"]    = round(float(row[1]), 1) if row[1] else None

        cursor.execute(sql_top_country, (today,))
        row = cursor.fetchone()
        if row:
            result["top_country"] = row[0]

    except mysql.connector.Error as exc:
        logger.error("Stats query error: %s", exc)
    finally:
        try:
            cursor.close()
            conn.close()
        except Exception:
            pass

    return jsonify(result)
