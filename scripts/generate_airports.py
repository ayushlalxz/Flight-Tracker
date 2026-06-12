"""
scripts/generate_airports.py — one-time setup script.

Downloads the OurAirports public CSV (CC0 license) and writes
static/data/airports.json keyed by ICAO airport code.

Run once from the project root:
    python scripts/generate_airports.py
"""

import csv
import io
import json
import os
import urllib.request

URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"

KEEP_TYPES = {"large_airport", "medium_airport"}

# All countries whose airports may appear as origin/destination for
# flights transiting Indian airspace (India + neighbours + Gulf hubs +
# major South/Southeast Asian connecting airports).
KEEP_COUNTRIES = {
    "IN", "PK", "BD", "NP", "LK", "MV", "BT", "AF",
    "CN", "MM", "TH", "MY", "SG",
    "AE", "QA", "OM", "BH", "KW", "SA",
    "GB", "DE", "FR", "NL", "US", "AU", "JP", "KR",
}


def main() -> None:
    out_path = os.path.join(
        os.path.dirname(__file__), "..", "static", "data", "airports.json"
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    print(f"Downloading {URL} …")
    raw = urllib.request.urlopen(URL, timeout=30).read().decode("utf-8")

    reader = csv.DictReader(io.StringIO(raw))
    airports: dict = {}

    for row in reader:
        if row.get("type") not in KEEP_TYPES:
            continue
        if row.get("iso_country") not in KEEP_COUNTRIES:
            continue
        icao = row.get("ident", "").strip()
        if len(icao) != 4:
            continue
        lat_str = row.get("latitude_deg", "")
        lon_str = row.get("longitude_deg", "")
        if not lat_str or not lon_str:
            continue
        airports[icao] = {
            "name":    row.get("name", "").strip(),
            "city":    row.get("municipality", "").strip(),
            "country": row.get("iso_country", "").strip(),
            "lat":     float(lat_str),
            "lon":     float(lon_str),
        }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(airports, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Written {len(airports)} airports -> {os.path.abspath(out_path)}")


if __name__ == "__main__":
    main()
