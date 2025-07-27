print(">>> SeatScout starting up…")

import sqlite3
from flask import Flask, render_template, request, jsonify
from fetcher import fetch_course_sections

app = Flask(__name__)

def get_db_connection():
    conn = sqlite3.connect("subscriptions.db")
    conn.row_factory = sqlite3.Row
    return conn

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/api/check")
def api_check():
    term   = request.args.get("term",   "3202520")
    course = request.args.get("course", "CHEM-1A03")
    va     = request.args.get("va",     "")
    try:
        sections = fetch_course_sections(term, course, va)
        return jsonify(sections)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/subscribe", methods=["GET", "POST"])
def subscribe():
    if request.method == "POST":
        email    = request.form["email"]
        term     = request.form["term"]
        course   = request.form["course"]
        va       = request.form["va"]
        section  = request.form["section"]

        conn = get_db_connection()
        conn.execute(
            "INSERT INTO subscriptions (email, term, course_code, va, section_disp) "
            "VALUES (?, ?, ?, ?, ?)",
            (email, term, course, va, section)
        )
        conn.commit()
        conn.close()
        return render_template("subscribe.html", message="Subscribed successfully!")
    else:
        return render_template("subscribe.html")

if __name__ == "__main__":
    app.run(debug=True)
