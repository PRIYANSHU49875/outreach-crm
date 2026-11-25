# Deploying the free demo site 🌐

The `web/` folder is a **static site** that works with bundled sample data
(`web/data.json`), so you can host it **free** as a public demo or portfolio
piece. No backend needed for the demo.

> The demo shows sample data. The full live version (reading your real Google
> Sheet) runs locally via `server.py` — see the main README.

---

## Option A — GitHub Pages (simplest, 100% free)

Best if your code is already on GitHub.

1. Create a **public** GitHub repo and push this project.
2. In the repo: **Settings → Pages**.
3. Under "Build and deployment":
   - Source: **Deploy from a branch**
   - Branch: `main`, folder: **`/web`** (if offered) — otherwise move the
     contents of `web/` to the repo root, or use a `docs/` folder.
4. Save. Your demo goes live at:
   `https://YOUR_USERNAME.github.io/YOUR_REPO/`
5. Add that link to the top of `README.md`.

> GitHub Pages serves `/web` as the site root. All the pages link relatively
> (e.g. `href="pipeline.html"`), so they work as-is.

---

## Option B — Cloudflare Pages (most generous, unlimited bandwidth)

1. Create a free [Cloudflare](https://dash.cloudflare.com/) account.
2. **Workers & Pages → Create → Pages → Upload assets** (or connect your Git repo).
3. Upload the **`web/`** folder (drag & drop).
4. Deploy. You get a free `*.pages.dev` URL with HTTPS.

Cloudflare Pages has **no bandwidth limit** on the free tier — ideal if the
demo gets shared widely.

---

## Option C — Netlify Drop (fastest, no account steps)

1. Go to <https://app.netlify.com/drop>.
2. Drag the **`web/`** folder onto the page.
3. Get an instant live link.

---

## Quick note on the demo vs live

| | Demo (hosted) | Live (local) |
|---|---|---|
| Data | Sample `web/data.json` | Your real Google Sheet |
| Backend | None needed | `server.py` + google_workspace_mcp |
| Who sees it | Anyone with the link | Only you (localhost) |
| Cost | Free | Free |

This keeps your real data private (local only) while letting you showcase the
product publicly for free. 🎉
