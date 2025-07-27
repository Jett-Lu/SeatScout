import requests
import xml.etree.ElementTree as ET

def fetch_course_sections(term, course_code, va, t=291, e=57):
    """
    Fetch sections for a given course from the MyTimetable XML API.
    Returns a list of dicts: [{ "va": "...", "section": "...", "open": X, "capacity": Y }, ...]
    """
    url = "https://mytimetable.mcmaster.ca/api/class-data"
    params = {
        "term":        term,
        "course_0_0":  course_code,
        "va_0_0":      va,
        "rq_0_0":      "",
        "t":           t,
        "e":           e,
        "nouser":      1,
        "_":           ""   # cache‑buster (can leave blank)
    }
    resp = requests.get(url, params=params)
    resp.raise_for_status()

    root = ET.fromstring(resp.text)
    sections = []
    for sel in root.findall(".//selection"):
        sel_va = sel.get("va")
        for block in sel.findall("block"):
            sections.append({
                "va":       sel_va,
                "section":  block.get("disp"),
                "open":     int(block.get("os")),
                "capacity": int(block.get("csme"))
            })
    return sections
