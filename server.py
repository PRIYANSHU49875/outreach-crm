"""
Outreach CRM — live backend.

Reads your Google Sheet + Calendar live via a local google_workspace_mcp
server, and serves the dashboard website.

Setup:
  1. Copy config.example.json -> config.json and fill in your values.
  2. Run the google_workspace_mcp server (see README) on the mcpUrl port.
  3. Run this:  uv run --python 3.12 server.py
  4. Open http://localhost:<port>

Demo mode: if config.json is missing OR the MCP server is unreachable,
the dashboard serves bundled sample data so people can preview the UI.
"""
import http.server
import socketserver
import json
import os
import re
import time
import threading
import urllib.request
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
WEBROOT = os.path.join(HERE, "web")


def load_config():
    path = os.path.join(HERE, "config.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f), True
    # Fallback defaults -> triggers demo mode.
    return {
        "ownerEmail": "demo@example.com",
        "spreadsheetId": "",
        "bookingLink": "https://calendar.app.google/DEMO",
        "mcpUrl": "http://localhost:8000/mcp",
        "port": 7070,
        "profile": {"name": "Demo User", "intro": "", "skills": ""},
    }, False


CONFIG, HAS_CONFIG = load_config()
PORT = int(CONFIG.get("port", 7070))
MCP_URL = CONFIG.get("mcpUrl", "http://localhost:8000/mcp")
USER = CONFIG.get("ownerEmail", "")
SPREADSHEET_ID = CONFIG.get("spreadsheetId", "")
BOOKING_LINK = CONFIG.get("bookingLink", "")


# ---------- MCP plumbing ----------
def _post(payload, session_id=None):
    headers = {"Content-Type": "application/json",
               "Accept": "application/json, text/event-stream"}
    if session_id:
        headers["mcp-session-id"] = session_id
    req = urllib.request.Request(MCP_URL, data=json.dumps(payload).encode(), headers=headers)
    resp = urllib.request.urlopen(req, timeout=20)
    sid = resp.headers.get("mcp-session-id")
    raw = resp.read().decode()
    obj = None
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            line = line[5:].strip()
        if line.startswith("{"):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
    return sid, obj


def _new_session():
    sid, _ = _post({
        "jsonrpc": "2.0", "id": 0, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                   "clientInfo": {"name": "outreach-crm", "version": "1.0"}},
    })
    if sid:
        try:
            _post({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}, sid)
        except Exception:
            pass
    return sid


def mcp_call(tool, args):
    sid = _new_session()
    _, obj = _post({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                    "params": {"name": tool, "arguments": args}}, sid)
    if obj and "result" in obj:
        content = obj["result"].get("content", [])
        if content and content[0].get("type") == "text":
            return content[0]["text"]
    return ""


def parse_rows(text):
    rows = []
    for line in text.splitlines():
        m = re.match(r"^(\d+)\t(.*)$", line)
        if m:
            rows.append(m.group(2).split("\t"))
    return rows


def slot_is_past(slot):
    try:
        s = slot.replace("·", " ").replace("–", "-").replace("—", "-")
        m = re.search(r"(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*([AaPp][Mm])", s)
        if not m:
            return False
        day, mon, _s, end, ampm = m.groups()
        now = datetime.datetime.now()
        end_dt = datetime.datetime.strptime(f"{day} {mon} {now.year} {end} {ampm.upper()}", "%d %b %Y %I:%M %p")
        if (end_dt - now).days > 180:
            end_dt = end_dt.replace(year=now.year - 1)
        return end_dt < now
    except Exception:
        return False


# ---------- Demo data ----------
def demo_data():
    return {
        "generatedAt": datetime.datetime.now().astimezone().isoformat(),
        "owner": "demo@example.com",
        "demo": True,
        "bookings": [
            {"name": "Alex Recruiter", "slot": "28 Nov · 3:00–3:15 PM", "reply": "Replied",
             "replyMessage": "Sounds great!", "meetingLink": "https://meet.google.com/demo",
             "status": "🟢 Scheduled", "isPast": False},
        ],
        "mailLog": [
            {"name": "Alex Recruiter", "email": "alex@acme.com", "subject": "Ex-Groww growth intern → Acme?",
             "message": "Hi Alex,\n\nShort personalized pitch...\n\nThanks,\nYou", "dateSent": "26 Nov 2026",
             "status": "Sent", "type": "Cold"},
            {"name": "Sam Lead", "email": "sam@beta.io", "subject": "Quick chat about growth?",
             "message": "Hi Sam,\n\n...", "dateSent": "25 Nov 2026", "status": "Sent", "type": "Follow-up"},
        ],
        "contacts": [
            {"name": "Alex Recruiter", "email": "alex@acme.com", "company": "Acme",
             "role": "Recruiter", "dateEmailed": "26 Nov 2026", "status": "↩️ Replied",
             "intel": "Acme is a fast-growing SaaS startup hiring for growth. Great fit for your pitch."},
            {"name": "Sam Lead", "email": "sam@beta.io", "company": "Beta",
             "role": "Hiring Mgr", "dateEmailed": "25 Nov 2026", "status": "📧 Emailed", "intel": ""},
        ],
        "profile": {"🎯 Weekly Goal (emails)": "10"},
        "analytics": {
            "byType": {"Cold": 1, "Follow-up": 1},
            "bySubject": {"Ex-Groww growth intern → Acme?": {"sent": 1}, "Quick chat about growth?": {"sent": 1}},
            "funnel": {"sent": 2, "replied": 1, "booked": 1},
        },
    }


# ---------- Live data ----------
def build_data():
    if not HAS_CONFIG or not SPREADSHEET_ID:
        return demo_data()
    try:
        bookings, mail = [], []
        bt = mcp_call("read_sheet_values", {"user_google_email": USER,
                      "spreadsheet_id": SPREADSHEET_ID, "range_name": "Bookings!A5:G100"})
        for c in parse_rows(bt):
            c += [""] * (7 - len(c))
            name = c[0].strip()
            if not name:
                continue
            reply = c[2]
            bookings.append({
                "name": name, "slot": c[1], "meetingLink": c[4].strip(),
                "reply": "Replied" if "Replied" in reply else ("Awaiting" if "Await" in reply else reply),
                "replyMessage": c[3], "status": c[5], "isPast": slot_is_past(c[1]),
            })
        mt = mcp_call("read_sheet_values", {"user_google_email": USER,
                      "spreadsheet_id": SPREADSHEET_ID, "range_name": "Mail Log!A2:F100"})
        for c in parse_rows(mt):
            c += [""] * (6 - len(c))
            st = c[5]
            typ = next((t for t in ("Cold", "Follow-up", "Booking") if t in st), "Other")
            mail.append({"name": c[0], "email": c[1], "subject": c[2],
                         "message": c[3].replace("\\n", "\n"), "dateSent": c[4],
                         "status": "Sent" if "Sent" in st else st, "type": typ})
        contacts = []
        ct = mcp_call("read_sheet_values", {"user_google_email": USER,
                      "spreadsheet_id": SPREADSHEET_ID, "range_name": "Contacts!A2:H200"})
        for c in parse_rows(ct):
            c += [""] * (8 - len(c))
            if c[0] or c[1]:
                contacts.append({"name": c[0], "email": c[1], "company": c[2], "role": c[3],
                                 "dateEmailed": c[4], "status": c[5], "intel": c[7]})
        profile = {}
        pt = mcp_call("read_sheet_values", {"user_google_email": USER,
                      "spreadsheet_id": SPREADSHEET_ID, "range_name": "Profile!A3:B20"})
        for c in parse_rows(pt):
            c += [""] * (2 - len(c))
            if c[0]:
                profile[c[0]] = c[1]
        analytics = {"byType": {}, "bySubject": {}, "funnel": {}}
        for m in mail:
            analytics["byType"][m["type"]] = analytics["byType"].get(m["type"], 0) + 1
            analytics["bySubject"].setdefault(m["subject"][:40], {"sent": 0})
            analytics["bySubject"][m["subject"][:40]]["sent"] += 1
        analytics["funnel"] = {
            "sent": len(mail),
            "replied": sum(1 for b in bookings if "Replied" in (b.get("reply") or "")),
            "booked": sum(1 for b in bookings if b.get("slot")),
        }
        return {"generatedAt": datetime.datetime.now().astimezone().isoformat(),
                "owner": USER, "bookings": bookings, "mailLog": mail,
                "profile": profile, "contacts": contacts, "analytics": analytics}
    except Exception as e:
        print("Live fetch failed, serving demo data:", e)
        d = demo_data()
        d["note"] = "Backend unreachable — showing demo data."
        return d


# ---------- Cache (stale-while-revalidate) ----------
_CACHE = {"data": None, "ts": 0}
_CACHE_TTL = 60
_lock = threading.Lock()


def _refresh():
    if _lock.acquire(blocking=False):
        try:
            _CACHE["data"] = build_data()
            _CACHE["ts"] = time.time()
        finally:
            _lock.release()


def get_data():
    if _CACHE["data"] is None:
        _refresh()
        return _CACHE["data"]
    if time.time() - _CACHE["ts"] > _CACHE_TTL:
        threading.Thread(target=_refresh, daemon=True).start()
    return _CACHE["data"]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=WEBROOT, **k)

    def do_GET(self):
        try:
            if self.path.startswith("/api/refresh"):
                _CACHE["ts"] = 0
            if self.path.startswith("/api/data") or self.path.startswith("/data.json") or self.path.startswith("/api/refresh"):
                body = json.dumps(get_data()).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            return super().do_GET()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass

    def log_message(self, *a):
        pass


class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    mode = "LIVE" if (HAS_CONFIG and SPREADSHEET_ID) else "DEMO"
    print(f"Outreach CRM [{mode}] — http://localhost:{PORT}")
    try:
        get_data()
    except Exception as e:
        print("warm failed:", e)
    with ThreadedServer(("", PORT), Handler) as httpd:
        httpd.serve_forever()
