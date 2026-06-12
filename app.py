# app.py — Flask entry point for India Flight Tracker

import re

from flask import Flask, redirect, render_template, url_for
from flask_cors import CORS

from api.flights import flights_bp
from api.flight_detail import flight_detail_bp
from api.state_flights import state_flights_bp
from api.stats import stats_bp
import config

app = Flask(__name__)
CORS(app)

# Register API blueprints
app.register_blueprint(flights_bp)
app.register_blueprint(flight_detail_bp)
app.register_blueprint(state_flights_bp)
app.register_blueprint(stats_bp)


@app.route("/")
def index():
    """Serve the single-page flight tracker UI."""
    return render_template("index.html", refresh=config.AUTO_REFRESH_SECONDS)


@app.route("/flight/<icao24>")
def flight_detail_page(icao24):
    """Render the per-aircraft detail page."""
    if not re.match(r'^[0-9a-fA-F]{6}$', icao24):
        return redirect(url_for('index'))
    return render_template("flight.html", icao24=icao24)


if __name__ == "__main__":
    app.run(debug=config.DEBUG, port=config.PORT)
