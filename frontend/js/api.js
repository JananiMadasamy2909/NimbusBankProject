/* ==========================================================================
   Nimbus Bank — js/api.js
   Thin fetch wrapper around the backend REST API (server/server.js).
   Every call returns parsed JSON on success and throws an Error (with
   .status set) on failure, so pages can await api.xxx() and catch cleanly.
   ========================================================================== */

const AUTH_TOKEN_KEY = "nimbus_auth_token";

function getToken() { return sessionStorage.getItem(AUTH_TOKEN_KEY); }
function setToken(t) { sessionStorage.setItem(AUTH_TOKEN_KEY, t); }
function clearToken() { sessionStorage.removeItem(AUTH_TOKEN_KEY); }

async function apiFetch(path, { method = "GET", body, auth = true, query } = {}) {
  let url = path;
  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") params.set(k, v); });
    const qs = params.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (networkErr) {
    const err = new Error("Could not reach the Nimbus Bank server. Is it running?");
    err.status = 0;
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body is fine */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || ("Request failed with status " + res.status));
    err.status = res.status;
    err.data = data;
    if (res.status === 401) { clearToken(); }
    throw err;
  }
  return data;
}

const api = {
  // auth
  register: (payload) => apiFetch("/api/register", { method: "POST", body: payload, auth: false }),
  login: (username, password) => apiFetch("/api/login", { method: "POST", body: { username, password }, auth: false }),
  otpPeek: (otpToken) => apiFetch("/api/otp/peek", { query: { otpToken }, auth: false }),
  otpResend: (otpToken) => apiFetch("/api/otp/resend", { method: "POST", body: { otpToken }, auth: false }),
  otpVerify: (otpToken, code) => apiFetch("/api/otp/verify", { method: "POST", body: { otpToken, code }, auth: false }),
  logout: () => apiFetch("/api/logout", { method: "POST" }).catch(() => {}),
  me: () => apiFetch("/api/me"),
  updateMe: (payload) => apiFetch("/api/me", { method: "PUT", body: payload }),
  changePassword: (currentPassword, newPassword) => apiFetch("/api/me/password", { method: "PUT", body: { currentPassword, newPassword } }),
  set2fa: (enabled) => apiFetch("/api/me/2fa", { method: "PUT", body: { enabled } }),
  deleteMe: () => apiFetch("/api/me", { method: "DELETE" }),
  loginActivity: () => apiFetch("/api/login-activity"),

  // accounts
  accounts: () => apiFetch("/api/accounts"),
  account: (id) => apiFetch("/api/accounts/" + id),
  openAccount: (payload) => apiFetch("/api/accounts", { method: "POST", body: payload }),
  renameAccount: (id, name) => apiFetch("/api/accounts/" + id, { method: "PATCH", body: { name } }),
  closeAccount: (id) => apiFetch("/api/accounts/" + id, { method: "DELETE" }),
  accountTransactions: (id) => apiFetch(`/api/accounts/${id}/transactions`),

  // transactions (global, filterable)
  transactions: (query) => apiFetch("/api/transactions", { query }),

  // transfers
  transfer: (payload) => apiFetch("/api/transfer", { method: "POST", body: payload }),
  eTransferRecipients: () => apiFetch("/api/etransfer/recipients"),
  addETransferRecipient: (name, contact) => apiFetch("/api/etransfer/recipients", { method: "POST", body: { name, contact } }),
  eTransfer: (payload) => apiFetch("/api/etransfer", { method: "POST", body: payload }),

  // bill pay
  payees: () => apiFetch("/api/payees"),
  addPayee: (payload) => apiFetch("/api/payees", { method: "POST", body: payload }),
  deletePayee: (id) => apiFetch("/api/payees/" + id, { method: "DELETE" }),
  billHistory: () => apiFetch("/api/billpay"),
  payBill: (payload) => apiFetch("/api/billpay", { method: "POST", body: payload }),

  // deposits
  deposit: (payload) => apiFetch("/api/deposits", { method: "POST", body: payload }),

  // investments
  investments: () => apiFetch("/api/investments"),
  trade: (payload) => apiFetch("/api/investments/trade", { method: "POST", body: payload }),

  // loans
  applyLoan: (payload) => apiFetch("/api/loans", { method: "POST", body: payload }),
  loans: () => apiFetch("/api/loans"),

  // notifications
  notifications: () => apiFetch("/api/notifications"),
  markNotifRead: (id) => apiFetch(`/api/notifications/${id}/read`, { method: "POST" }),
  markAllNotifsRead: () => apiFetch("/api/notifications/read-all", { method: "POST" }),

  // admin / testing utility
  resetSandbox: () => apiFetch("/api/admin/reset", { method: "POST", auth: false }),
  health: () => apiFetch("/api/health", { auth: false })
};
