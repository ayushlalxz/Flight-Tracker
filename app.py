# app.py — Flask entry point for India Flight Tracker

from flask import Flask, render_template
from flask_cors import CORS

from api.flights import flights_bp
from api.state_flights import state_flights_bp
from api.stats import stats_bp
import config

app = Flask(__name__)
CORS(app)

# Register API blueprints
app.register_blueprint(flights_bp)
app.register_blueprint(state_flights_bp)
app.register_blueprint(stats_bp)


@app.route("/")
def index():
    """Serve the single-page flight tracker UI."""
    return render_template("index.html", refresh=config.AUTO_REFRESH_SECONDS)


if __name__ == "__main__":
    app.run(debug=config.DEBUG, port=config.PORT)
