/* ==========================================================================
   NIMBUS BANK — shared app module (js/app.js)
   Loaded on every page after js/api.js. Provides page chrome, toast, modal,
   and the AI chat widget. All data now comes from the backend API — this
   file no longer touches localStorage for bank data (only the auth token,
   via api.js, and the AI chat transcript live in sessionStorage).
   ========================================================================== */

/* ---------------------------- helpers ---------------------------- */
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function fmt(n) { n = Number(n) || 0; return n < 0 ? "-$" + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function fmtDate(iso) { const d = new Date(iso + "T00:00:00"); return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

/* ---------------------------- toast ---------------------------- */
let toastId = 0;
function toast(msg, type = "info", timeout = 4200) {
  let region = document.getElementById("toast-region");
  if (!region) { region = document.createElement("div"); region.id = "toast-region"; region.setAttribute("aria-live", "polite"); region.setAttribute("role", "status"); document.body.appendChild(region); }
  const id = "toast-" + (++toastId);
  const el = document.createElement("div");
  el.className = "toast " + type; el.id = id; el.setAttribute("data-testid", "toast-" + type);
  const icon = { success: "✓", error: "✕", warning: "!", info: "i" }[type] || "i";
  el.innerHTML = `<strong style="font-size:14px">${icon}</strong><div>${escapeHtml(msg)}</div><button aria-label="Dismiss notification" data-testid="toast-dismiss">✕</button>`;
  region.appendChild(el);
  el.querySelector("button").onclick = () => el.remove();
  if (timeout) setTimeout(() => { if (document.getElementById(id)) el.remove(); }, timeout);
}
function apiErrorToast(err, fallback) { toast((err && err.message) || fallback || "Something went wrong.", "error"); }

/* ---------------------------- modal ---------------------------- */
function ensureModalRoot() { let root = document.getElementById("modal-root"); if (!root) { root = document.createElement("div"); root.id = "modal-root"; document.body.appendChild(root); } return root; }
function openModal(html, onMount) {
  const root = ensureModalRoot();
  root.innerHTML = `<div class="overlay" id="modal-overlay" data-testid="modal-overlay"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const overlay = $("#modal-overlay");
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", escCloseHandler);
  if (onMount) onMount(root);
  const first = root.querySelector("input,button,select,textarea");
  if (first) first.focus();
}
function escCloseHandler(e) { if (e.key === "Escape") closeModal(); }
function closeModal() { const root = document.getElementById("modal-root"); if (root) root.innerHTML = ""; document.removeEventListener("keydown", escCloseHandler); }

/* ---------------------------- auth guards ---------------------------- */
async function requireAuth() {
  const token = getToken();
  if (!token) { window.location.href = "login.html"; return null; }
  try {
    const { user } = await api.me();
    return user;
  } catch (e) {
    window.location.href = "login.html";
    return null;
  }
}
async function redirectIfAuthed() {
  const token = getToken();
  if (!token) return;
  try { await api.me(); window.location.href = "dashboard.html"; }
  catch (e) { clearToken(); }
}

/* ---------------------------- page chrome (sidebar + topbar) ---------------------------- */
const NAV_ITEMS = [
  { group: "Overview", items: [{ id: "dashboard", href: "dashboard.html", label: "Dashboard", ic: "⌂" }] },
  { group: "Banking", items: [
    { id: "accounts", href: "accounts.html", label: "Accounts", ic: "▤" },
    { id: "investments", href: "investments.html", label: "Investments", ic: "◈" },
    { id: "transfer", href: "transfer.html", label: "Transfer / e-Transfer", ic: "⇄" },
    { id: "billpay", href: "billpay.html", label: "Bill Pay", ic: "⎘" },
    { id: "deposit", href: "deposit.html", label: "Deposit Check", ic: "⇓" },
    { id: "transactions", href: "transactions.html", label: "Transaction History", ic: "≡" }
  ] },
  { group: "Grow", items: [
    { id: "open-account", href: "open-account.html", label: "Open New Account", ic: "+" },
    { id: "loan", href: "loan.html", label: "Loan Application", ic: "$" }
  ] },
  { group: "Account", items: [{ id: "profile", href: "profile.html", label: "Profile & Settings", ic: "⚙" }] }
];

// initAuthedPage: verifies session, builds chrome, and returns { user } once ready.
async function initAuthedPage(activeId, title) {
  const user = await requireAuth();
  if (!user) return null;

  let notifications = [];
  try { notifications = (await api.notifications()).notifications; } catch (e) { /* non-fatal */ }

  document.body.insertAdjacentHTML("afterbegin", `<a href="#main-content" class="skip-link">Skip to main content</a>`);

  const theme = localStorage.getItem("nimbus_theme") || "dark";
  document.documentElement.setAttribute("data-theme", theme);

  const shell = document.createElement("div");
  shell.innerHTML = `
  <div class="app-shell">
    <nav class="sidebar" id="sidebar" aria-label="Primary navigation" data-testid="sidebar">
      <a href="dashboard.html" class="brand"><div class="brand-mark">N</div><div class="brand-name">Nimbus Bank</div></a>
      ${NAV_ITEMS.map(g => `
        <div class="nav-group">
          <div class="nav-label">${g.group}</div>
          ${g.items.map(it => `<a class="nav-item ${activeId === it.id ? 'active' : ''}" href="${it.href}" data-testid="nav-${it.id}"><span class="ic">${it.ic}</span>${it.label}</a>`).join("")}
        </div>`).join("")}
      <div style="margin-top:auto;padding-top:14px">
        <button class="nav-item" id="logout-btn" data-testid="nav-logout"><span class="ic">⏻</span>Log out</button>
      </div>
    </nav>
    <div class="main-col">
      <header class="topbar">
        <div class="topbar-left">
          <button class="hamburger" id="hamburger-btn" aria-label="Toggle navigation" data-testid="hamburger">☰</button>
          <h1 class="page-title">${title}</h1>
        </div>
        <div class="topbar-right">
          <button class="btn btn-icon btn-ghost" id="theme-toggle" data-testid="theme-toggle" aria-label="Toggle dark/light theme">${theme === 'dark' ? '☀' : '☾'}</button>
          <div class="dropdown-wrap" id="notif-wrap">
            <button class="btn btn-icon btn-ghost" id="notif-btn" data-testid="notif-bell" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">
              🔔${notifications.some(n => n.unread) ? '<span class="bell-dot" data-testid="notif-unread-dot"></span>' : ''}
            </button>
          </div>
          <div class="dropdown-wrap" id="profile-wrap">
            <button class="avatar" id="profile-btn" data-testid="profile-avatar" aria-haspopup="true" aria-expanded="false">${(user.name || "U").split(" ").map(s => s[0]).join("").slice(0, 2)}</button>
          </div>
        </div>
      </header>
      <main class="view" id="main-content" role="main" tabindex="-1"><div class="view-inner" id="view-root"></div></main>
    </div>
  </div>
  <button id="chat-fab" data-testid="chat-fab" aria-label="Open AI assistant">💬</button>
  <div id="chat-panel-root"></div>
  `;
  document.body.appendChild(shell);

  $("#logout-btn").addEventListener("click", doLogout);
  $("#hamburger-btn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("nimbus_theme", next);
    $("#theme-toggle").textContent = next === 'dark' ? '☀' : '☾';
  });
  $("#notif-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const wrap = $("#notif-wrap");
    const existing = wrap.querySelector(".notif-dropdown");
    closeAllDropdowns();
    if (existing) return;
    wrap.insertAdjacentHTML("beforeend", renderNotifDropdown(notifications));
    $("#notif-btn").setAttribute("aria-expanded", "true");
    bindNotifDropdown();
  });
  $("#profile-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const wrap = $("#profile-wrap");
    const existing = wrap.querySelector(".profile-dropdown");
    closeAllDropdowns();
    if (existing) return;
    wrap.insertAdjacentHTML("beforeend", renderProfileDropdown(user));
    $("#profile-btn").setAttribute("aria-expanded", "true");
    $("#dropdown-logout").addEventListener("click", doLogout);
  });
  document.addEventListener("click", closeAllDropdowns);
  function closeAllDropdowns() {
    $all(".notif-dropdown").forEach(e => e.remove());
    $all(".profile-dropdown").forEach(e => e.remove());
    const nb = $("#notif-btn"); const pb = $("#profile-btn");
    if (nb) nb.setAttribute("aria-expanded", "false");
    if (pb) pb.setAttribute("aria-expanded", "false");
  }

  function bindNotifDropdown() {
    const markAll = $("#mark-all-read");
    if (markAll) markAll.addEventListener("click", async (e) => {
      e.stopPropagation();
      try { await api.markAllNotifsRead(); notifications.forEach(n => n.unread = false); $("#notif-wrap .notif-dropdown").outerHTML = renderNotifDropdown(notifications); bindNotifDropdown(); const dot = $("[data-testid=notif-unread-dot]"); if (dot) dot.remove(); }
      catch (err) { apiErrorToast(err); }
    });
    $all("[data-notif-id]").forEach(el => el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const n = notifications.find(x => x.id == el.dataset.notifId);
      try { await api.markNotifRead(el.dataset.notifId); if (n) n.unread = false; el.classList.remove("unread"); }
      catch (err) { apiErrorToast(err); }
    }));
  }

  $("#chat-fab").addEventListener("click", () => toggleChat());

  return { user };
}

function renderNotifDropdown(notifications) {
  if (!notifications.length) return `<div class="notif-dropdown" data-testid="notif-dropdown"><div style="padding:16px" class="hint">No notifications.</div></div>`;
  return `<div class="notif-dropdown" data-testid="notif-dropdown" role="menu">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border-soft)">
      <strong style="font-size:13.5px">Notifications</strong>
      <button class="btn-link" id="mark-all-read" data-testid="mark-all-read" style="font-size:12px">Mark all read</button>
    </div>
    ${notifications.map(n => `
      <div class="notif-item ${n.unread ? 'unread' : ''}" data-notif-id="${n.id}" data-testid="notif-item-${n.id}">
        <div><strong>${escapeHtml(n.title)}</strong></div>
        <div>${escapeHtml(n.body)}</div>
        <div class="t">${n.time}</div>
      </div>`).join("")}
  </div>`;
}
function renderProfileDropdown(user) {
  return `<div class="profile-dropdown" data-testid="profile-dropdown" style="width:220px">
    <div style="padding:14px"><strong style="font-size:13.5px">${escapeHtml(user.name)}</strong><div style="font-size:12px;color:var(--text-faint)">${escapeHtml(user.email)}</div></div>
    <a class="nav-item" href="profile.html" data-testid="dropdown-profile" style="padding-left:14px">⚙ Profile & Settings</a>
    <button class="nav-item" id="dropdown-logout" data-testid="dropdown-logout" style="padding-left:14px">⏻ Log out</button>
  </div>`;
}

async function doLogout() {
  try { await api.logout(); } catch (e) { /* ignore */ }
  clearToken();
  sessionStorage.removeItem("nimbus_chat_v1");
  toast("You have been logged out.", "info");
  setTimeout(() => window.location.href = "login.html", 300);
}

/* ---------------------------- AI chat widget ---------------------------- */
const CHAT_SUGGESTIONS = ["What's my chequing balance?", "How does e-Transfer work?", "Explain my investment holdings", "How do I reset my password?"];
function getChatMessages() { try { return JSON.parse(sessionStorage.getItem("nimbus_chat_v1")) || [{ role: "bot", text: "Hi! I'm Nova, your Nimbus Bank assistant. Ask me about your accounts, transfers, investments, or how to use this sandbox." }]; } catch (e) { return []; } }
function saveChatMessages(msgs) { sessionStorage.setItem("nimbus_chat_v1", JSON.stringify(msgs)); }
let chatOpenState = false;
function toggleChat() { chatOpenState = !chatOpenState; renderChat(); }
function renderChat() {
  const root = document.getElementById("chat-panel-root");
  const fab = document.getElementById("chat-fab");
  if (!root) return;
  if (!chatOpenState) { root.innerHTML = ""; if (fab) fab.textContent = "💬"; return; }
  if (fab) fab.textContent = "✕";
  const msgs = getChatMessages();
  root.innerHTML = `
  <div id="chat-panel" data-testid="chat-panel" role="dialog" aria-label="AI banking assistant">
    <div class="chat-header"><strong>Nova — AI Assistant</strong><span class="chat-status"><span class="dot"></span>Online</span></div>
    <div class="chat-body" id="chat-body" data-testid="chat-body">
      ${msgs.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'bot'}" data-testid="chat-msg-${m.role}">${escapeHtml(m.text)}</div>`).join("")}
    </div>
    <div class="chat-suggestions">${CHAT_SUGGESTIONS.map(s => `<button class="chip" data-suggestion="${escapeHtml(s)}" data-testid="chat-suggestion">${s}</button>`).join("")}</div>
    <form id="chat-form" class="chat-input-row">
      <input type="text" id="chat-input" placeholder="Ask about your accounts…" data-testid="chat-input" autocomplete="off">
      <button type="submit" class="btn btn-primary btn-icon" data-testid="chat-send" aria-label="Send message">➤</button>
    </form>
    <div class="chat-disclaimer">Nova can make mistakes. This is a sandbox assistant — no real account actions are taken.</div>
  </div>`;
  const body = $("#chat-body"); if (body) body.scrollTop = body.scrollHeight;
  $("#chat-form").addEventListener("submit", (e) => { e.preventDefault(); const input = $("#chat-input"); const text = input.value.trim(); if (!text) return; input.value = ""; sendChatMessage(text); });
  $all("[data-suggestion]").forEach(chip => chip.addEventListener("click", () => sendChatMessage(chip.dataset.suggestion)));
}
async function sendChatMessage(text) {
  let msgs = getChatMessages();
  msgs.push({ role: "user", text }); saveChatMessages(msgs); renderChat();
  const body = $("#chat-body");
  if (body) { body.insertAdjacentHTML("beforeend", `<div class="msg typing" data-testid="chat-typing"><span></span><span></span><span></span></div>`); body.scrollTop = body.scrollHeight; }

  let accountsSummary = "";
  try { const { accounts } = await api.accounts(); accountsSummary = accounts.map(a => `${a.name} (${a.type}): ${fmt(a.balance)}`).join("; "); } catch (e) { /* fine without it */ }

  const systemPrompt = `You are Nova, a friendly AI assistant embedded in "Nimbus Bank", a MOCK banking web app built purely for QA/software-testing practice (not a real bank). Answer general banking questions helpfully and briefly (2-4 sentences). You may reference this mock account data if relevant: ${accountsSummary}. Never claim to execute real transactions — this is a sandbox. Do not give real financial, legal, or investment advice; keep answers educational and generic. Keep responses concise and conversational.`;

  fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 300, system: systemPrompt, messages: [{ role: "user", content: text }] })
  }).then(r => r.json()).then(data => {
    let reply = "Sorry, I couldn't process that right now.";
    try { const blocks = (data.content || []).filter(b => b.type === "text").map(b => b.text); if (blocks.length) reply = blocks.join("\n"); } catch (err) { }
    msgs = getChatMessages(); msgs.push({ role: "bot", text: reply }); saveChatMessages(msgs); renderChat();
  }).catch(() => {
    msgs = getChatMessages(); msgs.push({ role: "bot", text: "I'm having trouble connecting right now. Please try again in a moment." }); saveChatMessages(msgs); renderChat();
  });
}
