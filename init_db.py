import sqlite3

def init_db():
    conn = sqlite3.connect("subscriptions.db")
    cur = conn.cursor()
    # Create table: email, term, course_code, va, section_disp, notified (bool)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        term TEXT NOT NULL,
        course_code TEXT NOT NULL,
        va TEXT NOT NULL,
        section_disp TEXT NOT NULL,
        last_open INTEGER DEFAULT 0
    )
    """)
    conn.commit()
    conn.close()
    print("Initialized subscriptions.db with table `subscriptions`.")

if __name__ == "__main__":
    init_db()
