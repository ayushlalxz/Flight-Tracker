# India Flight Tracker ✈

A real-time flight visualisation app showing live aircraft over India, built with **Flask**, **MySQL**, **Leaflet.js**, and the **OpenSky Network** free API.

---

## Features

- 🗺 **Dark aviation map** centred on India (CartoDB Dark Matter tile layer)
- ✈ **Live plane markers** rotated to each aircraft's true heading
- 📊 **Sidebar stats**: active flights, avg altitude, avg speed, top origin country
- 🔄 **Auto-refresh** every 60 seconds with a manual override button
- 💾 **MySQL persistence** — if OpenSky is unreachable, the last snapshot is served from the DB
- 📱 **Responsive** — sidebar stacks below map on mobile

---

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.10 + |
| MySQL  | 8.0 +  |
| pip    | any     |

---

## Setup

### 1. Clone / download

```bash
git clone https://github.com/you/india-flight-tracker.git
cd india-flight-tracker
```

### 2. Create a Python virtual environment

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Create the MySQL database and table

```bash
mysql -u root -p < schema.sql
```

This creates the `flight_tracker` database and the `flights` table.

### 4. Configure credentials

Open **`config.py`** and set your MySQL details:

```python
DB_HOST     = "localhost"
DB_USER     = "root"
DB_PASSWORD = "your_password_here"   # ← change this
DB_NAME     = "flight_tracker"
```

**Optional — OpenSky authenticated account** (higher rate limits):

```python
OPENSKY_USER = "your_opensky_username"
OPENSKY_PASS = "your_opensky_password"
```

Leave both as empty strings `""` for anonymous access.

### 5. Run the Flask development server

```bash
python app.py
```

Open your browser at **http://localhost:5000**.

---

## Project structure

```
india-flight-tracker/
├── app.py                    # Flask entry point, route /
├── config.py                 # DB credentials, API settings
├── requirements.txt
├── schema.sql                # MySQL schema
├── api/
│   ├── __init__.py
│   ├── flights.py            # GET /api/flights  — fetch, store, return
│   └── stats.py              # GET /api/stats    — aggregate DB stats
├── static/
│   ├── css/style.css         # Dark aviation theme
│   └── js/
│       ├── map.js            # Leaflet map, markers, auto-refresh
│       └── sidebar.js        # Stat cards, flight list, clock
└── templates/
    └── index.html            # Single-page layout
```

---

## API endpoints

### `GET /api/flights`

Fetches current state vectors from OpenSky for India's bounding box, inserts them into MySQL, and returns:

```json
{
  "source":  "live",
  "count":   87,
  "flights": [
    {
      "icao24": "800a47",
      "callsign": "AIQ504",
      "origin_country": "India",
      "longitude": 77.1,
      "latitude": 28.6,
      "altitude_m": 10668.0,
      "velocity_ms": 245.3,
      "heading": 215.0,
      "on_ground": false
    },
    ...
  ]
}
```

`source` is `"live"` when OpenSky responded successfully, or `"cached"` when the DB fallback was used.

### `GET /api/stats`

Queries the DB for today's records:

```json
{
  "total_today":   342,
  "avg_altitude":  9842.5,
  "avg_speed":     231.4,
  "top_country":   "India"
}
```

---

## OpenSky rate limits

The OpenSky Network enforces API quotas:

| Access type | Limit |
|-------------|-------|
| Anonymous   | ~400 requests / day |
| Authenticated (free account) | ~4 000 requests / day |
| Institutional / premium | higher |

With **AUTO_REFRESH_SECONDS = 60** the app makes **1 440 requests/day** — slightly over the anonymous daily cap. To stay well within limits, either:

- Register a free account at [opensky-network.org](https://opensky-network.org) and set `OPENSKY_USER` / `OPENSKY_PASS` in `config.py`.
- Increase `AUTO_REFRESH_SECONDS` to 300 (5 min) to stay under 288 requests/day anonymously.

When the limit is hit, OpenSky returns a `429 Too Many Requests` and the app automatically serves the most-recent DB snapshot instead.

---

## Production deployment notes

- Replace `app.run(debug=True)` with a proper WSGI server (Gunicorn, uWSGI).
- Store `DB_PASSWORD` and OpenSky credentials in environment variables, not in `config.py`.
- Consider rate-limiting `/api/flights` at the reverse-proxy layer to prevent client-side abuse.
- The `flights` table will grow indefinitely — add a cron job to purge rows older than N days:
  ```sql
  DELETE FROM flights WHERE fetched_at < NOW() - INTERVAL 7 DAY;
  ```

---

## License

MIT
