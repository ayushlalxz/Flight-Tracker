# config.py — centralised settings for India Flight Tracker

# ── MySQL ──────────────────────────────────────────────────────────────────
DB_HOST     = "localhost"
DB_USER     = "root"
DB_PASSWORD = "ayushlal20"
DB_NAME     = "flight_tracker"

# ── OpenSky Network REST API ───────────────────────────────────────────────
# Anonymous limit: ~400 requests/day. Authenticated users get more quota.
# Docs: https://openskynetwork.github.io/opensky-api/rest.html
OPENSKY_URL         = "https://opensky-network.org/api/states/all"
OPENSKY_FLIGHTS_URL = "https://opensky-network.org/api/flights/aircraft"
OPENSKY_USER        = ""   # optional: set for higher rate limits
OPENSKY_PASS        = ""   # optional

AIRPORTS_JSON_PATH  = "static/data/airports.json"

# Bounding box covering the Indian subcontinent
INDIA_BBOX = {
    "lamin": 6.5,   # southern tip (Cape Comorin)
    "lomin": 68.1,  # western edge (Gujarat coast)
    "lamax": 37.0,  # northern tip (Ladakh)
    "lomax": 97.4,  # eastern edge (Arunachal Pradesh)
}

# ── Frontend auto-refresh ──────────────────────────────────────────────────
AUTO_REFRESH_SECONDS = 1

# ── Flask ──────────────────────────────────────────────────────────────────
DEBUG = True
PORT  = 5000
