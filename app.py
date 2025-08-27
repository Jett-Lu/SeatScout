print(">>> SeatScout starting up…")


import os
import smtplib
from email.message import EmailMessage
from dotenv import load_dotenv
from flask_apscheduler import APScheduler
import sqlite3
from flask import Flask, render_template, request, jsonify
from fetcher import fetch_course_sections

load_dotenv()  # reads .env into os.environ

# Scheduler settings
class Config:
    SCHEDULER_API_ENABLED = True

app.config.from_object(Config())
scheduler = APScheduler()
scheduler.init_app(app)
scheduler.start()

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

def send_email(to_addr, subject, body):
    msg = EmailMessage()
    msg["From"]    = os.environ["ALERT_FROM"]
    msg["To"]      = to_addr
    msg["Subject"] = subject
    msg.set_content(body)

    with smtplib.SMTP(os.environ["SMTP_SERVER"], int(os.environ["SMTP_PORT"])) as smtp:
        smtp.starttls()
        smtp.login(os.environ["SMTP_USERNAME"], os.environ["SMTP_PASSWORD"])
        smtp.send_message(msg)

def check_subscriptions():
    conn = get_db_connection()
    subs = conn.execute("SELECT * FROM subscriptions").fetchall()
    for sub in subs:
        term, course, va, sect_name, last = (
            sub["term"], sub["course_code"],
            sub["va"],  sub["section_disp"],
            sub["last_open"]
        )
        try:
            sections = fetch_course_sections(term, course, va)
            # find the one matching our section
            for sec in sections:
                if sec["section"] == sect_name:
                    if sec["open"] > last:
                        # new seats opened!
                        subject = f"SeatScout: {course} {sect_name} now has {sec['open']} open"
                        body = (f"Good news! {course} {sect_name} has {sec['open']} of "
                                f"{sec['capacity']} seats available.\n\n"
                                f"Visit the registration portal to enroll.")
                        send_email(sub["email"], subject, body)
                        # update last_open
                        conn.execute(
                            "UPDATE subscriptions SET last_open = ? WHERE id = ?",
                            (sec["open"], sub["id"])
                        )
                        conn.commit()
                    break
        except Exception as e:
            print("Error checking", sub["id"], e)
    conn.close()

# Schedule the job to run every minute
scheduler.add_job(
    id="seat_check",
    func=check_subscriptions,
    trigger="interval",
    minutes=1
)

def send_email(to_addr, subject, body):
    msg = EmailMessage()
    msg["From"]    = os.environ["ALERT_FROM"]
    msg["To"]      = to_addr
    msg["Subject"] = subject
    msg.set_content(body)

    with smtplib.SMTP(os.environ["SMTP_SERVER"], int(os.environ["SMTP_PORT"])) as smtp:
        smtp.starttls()
        smtp.login(os.environ["SMTP_USERNAME"], os.environ["SMTP_PASSWORD"])
        smtp.send_message(msg)

def check_subscriptions():
    conn = get_db_connection()
    subs = conn.execute("SELECT * FROM subscriptions").fetchall()
    for sub in subs:
        term, course, va, sect_name, last = (
            sub["term"], sub["course_code"],
            sub["va"],  sub["section_disp"],
            sub["last_open"]
        )
        try:
            sections = fetch_course_sections(term, course, va)
            for sec in sections:
                if sec["section"] == sect_name and sec["open"] > last:
                    subject = f"SeatScout: {course} {sect_name} now has {sec['open']} open"
                    body = (f"Good news! {course} {sect_name} has {sec['open']} of "
                            f"{sec['capacity']} seats available.\n\n"
                            f"Visit the registration portal to enroll.")
                    send_email(sub["email"], subject, body)
                    conn.execute(
                        "UPDATE subscriptions SET last_open = ? WHERE id = ?",
                        (sec["open"], sub["id"])
                    )
                    conn.commit()
                    break
        except Exception as e:
            print("Error checking", sub["id"], e)
    conn.close()

# run every minute
scheduler.add_job(
    id="seat_check",
    func=check_subscriptions,
    trigger="interval",
    minutes=1
)

if __name__ == "__main__":
    app.run(debug=True)

class Config:
    SCHEDULER_API_ENABLED = True

app.config.from_object(Config())

scheduler = APScheduler()
scheduler.init_app(app)
scheduler.start()
