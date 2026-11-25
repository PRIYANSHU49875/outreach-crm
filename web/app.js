// Shared data loader + helpers for all pages.
window.DASH = { data: { bookings: [], mailLog: [] } };

// ---- Theme ----
(function initTheme() {
  const saved = localStorage.getItem("crm-theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
})();
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("crm-theme", next);
  const btn = document.getElementById("themeBtn");
  if (btn) btn.textContent = next === "dark" ? "☀ Light" : "☾ Dark";
}

function renderNav(active) {
  const items = [
    ["index.html", "◇", "Overview"],
    ["pipeline.html", "▤", "Pipeline"],
    ["contacts.html", "◉", "Contacts"],
    ["bookings.html", "▦", "Bookings"],
    ["mail.html", "✉", "Mail"],
    ["templates.html", "❏", "Templates"],
    ["prep.html", "✸", "Prep"],
    ["analytics.html", "◪", "Analytics"],
    ["goals.html", "◎", "Goals"],
    ["settings.html", "⚙", "Settings"],
  ];
  const theme = localStorage.getItem("crm-theme") || "light";
  const owner = (window.DASH && window.DASH.data && window.DASH.data.owner) || "";
  return `<nav class="side">
    <div class="brand">Outreach CRM<span id="navOwner">${owner}</span></div>
    ${items.map(i => `<a href="${i[0]}" class="${i[0] === active ? "active" : ""}"><span class="ic">${i[1]}</span>${i[2]}</a>`).join("")}
    <button id="themeBtn" class="theme-toggle" onclick="toggleTheme()">${theme === "dark" ? "☀ Light" : "☾ Dark"}</button>
  </nav>`;
}

function tag(text, cls) { return `<span class="tag ${cls || ""}">${text}</span>`; }

function stats(d) {
  const ml = d.mailLog || [], bk = d.bookings || [];
  const sent = ml.length;
  const booked = bk.filter(b => b.slot && b.slot.trim()).length;
  const replied = bk.filter(b => /replied/i.test(b.reply || "")).length;
  const awaiting = bk.filter(b => /await/i.test(b.reply || "")).length;
  const rate = sent ? Math.round(replied / sent * 100) : 0;
  return { sent, booked, replied, awaiting, rate };
}

function loadData() {
  // Live backend endpoint; falls back to bundled demo data.json (for static hosting).
  return fetch("/api/data?t=" + Date.now())
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .catch(() => fetch("data.json?t=" + Date.now()).then(r => r.json()))
    .then(d => {
      window.DASH.data = d;
      // Update the owner label + demo banner once data arrives.
      const own = document.getElementById("navOwner");
      if (own && d.owner) own.textContent = d.owner;
      if (d.demo) showDemoBanner();
      return d;
    });
}

function showDemoBanner() {
  if (document.getElementById("demoBanner")) return;
  const b = document.createElement("div");
  b.id = "demoBanner";
  b.style.cssText = "background:var(--accent-soft);color:var(--accent);padding:8px 16px;font-size:13px;text-align:center;font-weight:500;border-bottom:1px solid var(--border)";
  b.textContent = "Demo mode — showing sample data. Connect your own Google account (see README) to go live.";
  document.body.prepend(b);
}

// Auto-refresh: re-run the page's render every 30s with fresh live data.
window.DASH.startAutoRefresh = function (renderFn) {
  setInterval(() => {
    loadData().then(d => renderFn(d)).catch(() => {});
  }, 60000);
};

// modal for mail body
function openModal(subject, who, body) {
  let m = document.getElementById("modal");
  document.getElementById("mName").textContent = subject;
  document.getElementById("mEmail").textContent = who;
  document.getElementById("mBody").textContent = body;
  m.classList.add("open");
}
function closeModal() { document.getElementById("modal").classList.remove("open"); }
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
