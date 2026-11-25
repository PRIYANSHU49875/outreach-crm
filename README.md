# Outreach CRM 📬

A free, self-hosted **outreach & job-search CRM** powered by your own Google account.
Send personalized recruiter/cold emails, track replies and bookings, prep for
interviews, and watch it all on a clean dashboard with light/dark mode — all
running locally on your machine, with your data staying in **your** Google Sheet.

> 🟢 **Live demo (sample data):** _[add your GitHub Pages link here]_
> No data leaves your computer. Each user connects their own Google account.

![dashboard](web/screenshot.png)

---

## ✨ Features

- **Overview command center** — AI next-action, hit list, funnel, company intel, weekly goal
- **Pipeline** — Kanban board: Contacted → Replied → Interview → Offer
- **Contacts** — every recruiter, with auto-researched company intel
- **Bookings** — meetings with Google Meet join links + status (attended/no-show/cancelled)
- **Mail log** — every email sent, with the full personalized message
- **Templates** — reusable cold / follow-up / thank-you emails, one-click copy
- **Interview prep** — company intel + likely questions per upcoming call
- **Analytics** — reply rates, funnels, what's working
- **Goals** — weekly targets, streaks, milestones
- 🌓 **Light / dark mode**
- 🔄 **Live auto-sync** from your Google Sheet (+ optional Apps Script automation)

---

## 🧩 How it works

```
Your Google Sheet  ──►  google_workspace_mcp (local)  ──►  server.py  ──►  web dashboard
     (your data)          (reads Sheet/Gmail/Cal)          (this repo)      (localhost)
```

Everything runs **on your computer**. Your Google credentials and data never
touch anyone else's server.

---

## 🚀 Setup (about 20 minutes, one time)

### Prerequisites
- [uv](https://docs.astral.sh/uv/) installed (`irm https://astral.sh/uv/install.ps1 | iex` on Windows)
- A Google account

### 1. Connect Google (the google_workspace_mcp server)
This repo reads your data through the open-source
[`google_workspace_mcp`](https://github.com/taylorwilsdon/google_workspace_mcp)
server. Follow its quick start to:
1. Create a Google Cloud project + OAuth client (Desktop app).
2. Enable Gmail, Drive, Sheets, Calendar APIs.
3. Run it locally:
   ```bash
   uvx workspace-mcp --transport streamable-http --tools gmail drive docs sheets calendar
   ```
   It listens on `http://localhost:8000/mcp`.

### 2. Create your tracking Google Sheet
Make a Google Sheet with these tabs (or ask your AI assistant to create them):
- **Bookings** — banner rows 1–3, header row 4, columns:
  `Name | Booked Slot | Reply | Message | Join Link | Status | EventID`
- **Mail Log** — `Name | Email | Subject | Message | Date Sent | Status/Type`
- **Contacts** — `Name | Email | Company | Role | Date Emailed | Status | (G) | Company Intel`
- **Profile** — key/value rows (name, intro, skills, weekly goal, booking link)

Copy the Sheet ID from its URL: `.../spreadsheets/d/THIS_IS_THE_ID/edit`.

### 3. Configure this app
```bash
cp config.example.json config.json   # (Windows: copy)
```
Edit `config.json` with your email, Sheet ID, and booking link.

### 4. Run the dashboard
```bash
uv run --python 3.12 server.py
```
Open **http://localhost:7070** 🎉

### 5. (Optional) Automate bookings & follow-ups
Add the Apps Scripts to your Sheet (Extensions → Apps Script):
- `booking-tracker.gs` — auto-records bookings + replies + meeting status
- `outreach-automation.gs` — auto-detects replies + sends follow-ups

---

## 🖼️ Free static demo (GitHub Pages)

The `web/` folder is a static site. Push it to GitHub and enable **Pages** to
host a free public demo (uses the bundled `web/data.json` sample data). This is
great as a **portfolio piece** — no backend needed for the demo.

---

## 🔒 Privacy & security

- Your Google tokens are stored by `google_workspace_mcp` on **your machine**.
- This app only **reads** your Sheet to display it; it never sends your data anywhere.
- **Never commit `config.json`** or any `client_secret.json` (see `.gitignore`).

---

## 📄 License

MIT — free to use, fork, and share.
