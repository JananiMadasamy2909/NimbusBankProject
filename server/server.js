/* ==========================================================================
   Nimbus Bank — server/server.js
   A small, real REST API in front of a file-backed store, plus static
   hosting for the frontend. Run:  npm install && npm start
   ========================================================================== */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const dbModule = require("./db");
const chatbot = require("./chatbot");

const PORT = process.env.PORT || 8000;
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const OTP_TTL_MS = 10 * 60 * 1000;       // 10 minutes
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 60 * 1000;         // 60 second cool-down after too many bad logins

let db = dbModule.load();
const tokens = new Map();       // token -> { username, expires }
const otps = new Map();         // otpToken -> { username, code, expires }
const failedLogins = new Map(); // username -> { count, lockUntil }

function persist() { dbModule.save(db); }
function genToken() { return crypto.randomBytes(24).toString("hex"); }
function genOtp() { return String(Math.floor(100000 + Math.random() * 900000)); }
function publicUser(u, username) {
  return { username, customerId: u.customerId, name: u.name, email: u.email, phone: u.phone, requires2fa: !!u.requires2fa };
}
function maskEmail(email) { return (email || "you@example.com").replace(/^(.{2}).+(@.+)$/, "$1•••$2"); }

const app = express();
app.use(cors());
app.use(express.json());

// ---- request log (handy while running Selenium/Playwright against this) ----
app.use((req, res, next) => { console.log(new Date().toISOString(), req.method, req.path); next(); });

// ---- auth middleware ----
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized: missing bearer token" });
  const record = tokens.get(token);
  if (!record || record.expires < Date.now()) { tokens.delete(token); return res.status(401).json({ error: "Unauthorized: invalid or expired token" }); }
  const user = db.users[record.username];
  if (!user) return res.status(401).json({ error: "Unauthorized: user no longer exists" });
  req.username = record.username;
  req.user = user;
  next();
}
function ownsAccount(req, res, next) {
  const acct = db.accounts.find(a => a.id === req.params.id);
  if (!acct) return res.status(404).json({ error: "Account not found" });
  if (acct.ownerUsername !== req.username) return res.status(403).json({ error: "Forbidden: not your account" });
  req.account = acct;
  next();
}

// ============================================================
// Health / admin
// ============================================================
app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.post("/api/admin/reset", (req, res) => {
  db = dbModule.reset();
  tokens.clear(); otps.clear(); failedLogins.clear();
  res.json({ status: "reset" });
});

// ============================================================
// Auth
// ============================================================
app.post("/api/register", (req, res) => {
  const { fullname, email, phone, username, password, dob } = req.body || {};
  if (!fullname || !email || !phone || !username || !password) return res.status(400).json({ error: "All fields are required." });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Invalid email address." });
  if (username.length < 4) return res.status(400).json({ error: "Username must be at least 4 characters." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (dob) {
    const age = (new Date() - new Date(dob)) / (365.25 * 24 * 3600 * 1000);
    if (age < 18) return res.status(400).json({ error: "You must be 18 or older to register." });
  }
  if (db.users[username]) return res.status(409).json({ error: "Username already exists." });
  const customerId = db.nextCustomerId++;
  db.users[username] = { customerId, password, requires2fa: false, name: fullname, email, phone, locked: false };
  persist();
  res.status(201).json({ user: publicUser(db.users[username], username) });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

  const lock = failedLogins.get(username);
  if (lock && lock.lockUntil && lock.lockUntil > Date.now()) {
    return res.status(429).json({ error: "Too many failed attempts. Try again in a minute." });
  }
  const user = db.users[username];
  if (!user || user.password !== password) {
    const rec = failedLogins.get(username) || { count: 0 };
    rec.count++;
    if (rec.count >= LOGIN_MAX_ATTEMPTS) { rec.lockUntil = Date.now() + LOGIN_LOCK_MS; rec.count = 0; }
    failedLogins.set(username, rec);
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  failedLogins.delete(username);
  if (user.locked) return res.status(403).json({ error: "This account is locked. Contact support to unlock it." });

  if (user.requires2fa) {
    const otpToken = genToken();
    otps.set(otpToken, { username, code: genOtp(), expires: Date.now() + OTP_TTL_MS });
    return res.json({ otpRequired: true, otpToken, maskedEmail: maskEmail(user.email) });
  }
  const token = genToken();
  tokens.set(token, { username, expires: Date.now() + TOKEN_TTL_MS });
  res.json({ token, user: publicUser(user, username) });
});

app.get("/api/otp/peek", (req, res) => {
  // Test-only endpoint: stands in for "reading the verification email" so
  // automated tests can retrieve the code the same way a human reads their inbox.
  const rec = otps.get(req.query.otpToken);
  if (!rec) return res.status(404).json({ error: "No pending OTP for that token." });
  if (rec.expires < Date.now()) return res.status(410).json({ error: "OTP expired." });
  res.json({ code: rec.code, maskedEmail: maskEmail(db.users[rec.username]?.email) });
});

app.post("/api/otp/resend", (req, res) => {
  const { otpToken } = req.body || {};
  const rec = otps.get(otpToken);
  if (!rec) return res.status(404).json({ error: "No pending OTP for that token." });
  rec.code = genOtp(); rec.expires = Date.now() + OTP_TTL_MS;
  res.json({ maskedEmail: maskEmail(db.users[rec.username]?.email) });
});

app.post("/api/otp/verify", (req, res) => {
  const { otpToken, code } = req.body || {};
  const rec = otps.get(otpToken);
  if (!rec) return res.status(404).json({ error: "No pending OTP for that token." });
  if (rec.expires < Date.now()) { otps.delete(otpToken); return res.status(410).json({ error: "OTP expired, please log in again." }); }
  if (!code || code.length !== 6) return res.status(400).json({ error: "Enter all 6 digits." });
  if (code !== rec.code) return res.status(401).json({ error: "Incorrect code." });
  otps.delete(otpToken);
  const token = genToken();
  tokens.set(token, { username: rec.username, expires: Date.now() + TOKEN_TTL_MS });
  res.json({ token, user: publicUser(db.users[rec.username], rec.username) });
});

app.post("/api/logout", requireAuth, (req, res) => {
  const header = req.headers.authorization || "";
  tokens.delete(header.slice(7));
  res.json({ status: "logged out" });
});

// ============================================================
// Current user / profile
// ============================================================
app.get("/api/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user, req.username) }));

app.put("/api/me", requireAuth, (req, res) => {
  const { name, email, phone } = req.body || {};
  if (name) req.user.name = name;
  if (email) req.user.email = email;
  if (phone) req.user.phone = phone;
  persist();
  res.json({ user: publicUser(req.user, req.username) });
});

app.put("/api/me/password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (req.user.password !== currentPassword) return res.status(401).json({ error: "Current password is incorrect." });
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });
  req.user.password = newPassword;
  persist();
  res.json({ status: "password updated" });
});

app.put("/api/me/2fa", requireAuth, (req, res) => {
  req.user.requires2fa = !!(req.body && req.body.enabled);
  persist();
  res.json({ requires2fa: req.user.requires2fa });
});

app.delete("/api/me", requireAuth, (req, res) => {
  delete db.users[req.username];
  persist();
  const header = req.headers.authorization || "";
  tokens.delete(header.slice(7));
  res.json({ status: "account deleted" });
});

app.get("/api/login-activity", requireAuth, (req, res) => {
  res.json({ activity: db.loginActivity.filter(l => l.ownerUsername === req.username) });
});

// ============================================================
// Customers (Parabank-style aliases — mirror your Playwright API suite 1:1)
// ============================================================
app.get("/api/customers/:id", requireAuth, (req, res) => {
  if (Number(req.params.id) !== req.user.customerId) return res.status(403).json({ error: "Forbidden: not your customer record" });
  res.json({ customer: publicUser(req.user, req.username) });
});
app.get("/api/customers/:id/accounts", requireAuth, (req, res) => {
  if (Number(req.params.id) !== req.user.customerId) return res.status(403).json({ error: "Forbidden: not your customer record" });
  res.json({ accounts: db.accounts.filter(a => a.ownerUsername === req.username) });
});

// ============================================================
// Accounts
// ============================================================
app.get("/api/accounts", requireAuth, (req, res) => {
  res.json({ accounts: db.accounts.filter(a => a.ownerUsername === req.username) });
});
app.get("/api/accounts/:id", requireAuth, ownsAccount, (req, res) => res.json({ account: req.account }));

app.post("/api/accounts", requireAuth, (req, res) => {
  const { type, nickname, initialDeposit } = req.body || {};
  const allowed = ["chequing", "savings", "investment", "credit"];
  if (!allowed.includes(type)) return res.status(400).json({ error: "Invalid account type." });
  if (!nickname) return res.status(400).json({ error: "Nickname is required." });
  const newAcct = {
    id: crypto.randomUUID(), ownerUsername: req.username, type, name: nickname,
    number: String(Math.floor(1000 + Math.random() * 8999)),
    full: "1234-" + Math.floor(1000 + Math.random() * 8999) + "-" + Math.floor(1000 + Math.random() * 8999),
    balance: parseFloat(initialDeposit) || 0
  };
  if (type === "credit") newAcct.limit = 3000;
  if (type === "investment") newAcct.holdings = [];
  db.accounts.push(newAcct);
  persist();
  res.status(201).json({ account: newAcct });
});

app.patch("/api/accounts/:id", requireAuth, ownsAccount, (req, res) => {
  if (req.body && req.body.name) req.account.name = req.body.name;
  persist();
  res.json({ account: req.account });
});
app.delete("/api/accounts/:id", requireAuth, ownsAccount, (req, res) => {
  db.accounts = db.accounts.filter(a => a.id !== req.params.id);
  persist();
  res.json({ status: "closed" });
});

app.get("/api/accounts/:id/transactions", requireAuth, ownsAccount, (req, res) => {
  const rows = db.transactions.filter(t => t.account === req.params.id && t.ownerUsername === req.username);
  res.json({ transactions: rows });
});

// ============================================================
// Transactions (global view across all of the user's accounts, with filters)
// GET /api/transactions?accountType=&accountId=&category=&from=&to=&q=&min=&max=&sort=&dir=&page=&perPage=
// ============================================================
app.get("/api/transactions", requireAuth, (req, res) => {
  const q = req.query;
  const myAccountIds = new Set(db.accounts.filter(a => a.ownerUsername === req.username).map(a => a.id));
  let rows = db.transactions.filter(t => t.ownerUsername === req.username && myAccountIds.has(t.account));

  if (q.accountType && q.accountType !== "all") {
    const idsOfType = new Set(db.accounts.filter(a => a.type === q.accountType).map(a => a.id));
    rows = rows.filter(t => idsOfType.has(t.account));
  }
  if (q.accountId && q.accountId !== "all") rows = rows.filter(t => t.account === q.accountId);
  if (q.category && q.category !== "all") rows = rows.filter(t => t.category === q.category);
  if (q.from) rows = rows.filter(t => t.date >= q.from);
  if (q.to) rows = rows.filter(t => t.date <= q.to);
  if (q.q) rows = rows.filter(t => t.description.toLowerCase().includes(String(q.q).toLowerCase()));
  if (q.min !== undefined && q.min !== "") rows = rows.filter(t => Math.abs(t.amount) >= parseFloat(q.min));
  if (q.max !== undefined && q.max !== "") rows = rows.filter(t => Math.abs(t.amount) <= parseFloat(q.max));

  const sortCol = q.sort || "date";
  const dir = q.dir === "asc" ? 1 : -1;
  rows = rows.slice().sort((a, b) => (a[sortCol] < b[sortCol] ? -dir : a[sortCol] > b[sortCol] ? dir : 0));

  const page = parseInt(q.page) || 1;
  const perPage = parseInt(q.perPage) || 8;
  const total = rows.length;
  const paged = rows.slice((page - 1) * perPage, page * perPage);
  res.json({ transactions: paged, total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) });
});

// ============================================================
// Transfers
// ============================================================
app.post("/api/transfer", requireAuth, (req, res) => {
  const { fromAccountId, toAccountId, externalAccount, amount, memo } = req.body || {};
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: "Amount must be greater than 0." });
  const from = db.accounts.find(a => a.id === fromAccountId && a.ownerUsername === req.username);
  if (!from) return res.status(404).json({ error: "Source account not found." });
  if (from.type !== "credit" && amt > from.balance) return res.status(422).json({ error: "Insufficient funds." });

  let to = null;
  if (toAccountId && toAccountId !== "external") {
    to = db.accounts.find(a => a.id === toAccountId);
    if (!to) return res.status(404).json({ error: "Destination account not found." });
  } else if (toAccountId === "external" && !externalAccount) {
    return res.status(400).json({ error: "External account number is required." });
  }

  from.balance = +(from.balance - amt).toFixed(2);
  if (to) to.balance = +(to.balance + amt).toFixed(2);

  const txn = { id: db.nextIds.txn++, ownerUsername: req.username, date: new Date().toISOString().slice(0, 10), description: "Transfer — " + (memo || "Funds transfer"), category: "Transfer", account: from.id, amount: -amt, status: "Posted" };
  db.transactions.unshift(txn);
  persist();
  res.json({ transaction: txn, fromBalance: from.balance, toBalance: to ? to.balance : null, confirmation: "NB-" + Math.floor(100000 + Math.random() * 900000) });
});

app.get("/api/etransfer/recipients", requireAuth, (req, res) => {
  res.json({ recipients: db.eTransferRecipients.filter(r => r.ownerUsername === req.username) });
});
app.post("/api/etransfer/recipients", requireAuth, (req, res) => {
  const { name, contact } = req.body || {};
  if (!name || !contact) return res.status(400).json({ error: "Recipient name and contact are required." });
  const rec = { id: db.nextIds.recipient++, ownerUsername: req.username, name, contact };
  db.eTransferRecipients.push(rec);
  persist();
  res.status(201).json({ recipient: rec });
});

app.post("/api/etransfer", requireAuth, (req, res) => {
  const { fromAccountId, recipientId, amount, autodeposit, securityAnswer } = req.body || {};
  const amt = parseFloat(amount);
  const from = db.accounts.find(a => a.id === fromAccountId && a.ownerUsername === req.username);
  if (!from) return res.status(404).json({ error: "Source account not found." });
  if (!amt || amt <= 0) return res.status(400).json({ error: "Amount must be greater than 0." });
  if (amt > 3000) return res.status(422).json({ error: "e-Transfer amount exceeds the $3,000 limit." });
  if (amt > from.balance) return res.status(422).json({ error: "Insufficient funds." });
  const recipient = db.eTransferRecipients.find(r => r.id === recipientId && r.ownerUsername === req.username);
  if (!recipient) return res.status(404).json({ error: "Recipient not found." });
  if (!autodeposit && !securityAnswer) return res.status(400).json({ error: "Security answer required when Autodeposit is off." });

  from.balance = +(from.balance - amt).toFixed(2);
  const txn = { id: db.nextIds.txn++, ownerUsername: req.username, date: new Date().toISOString().slice(0, 10), description: "e-Transfer to " + recipient.name, category: "e-Transfer", account: from.id, amount: -amt, status: autodeposit ? "Posted" : "Pending" };
  db.transactions.unshift(txn);
  persist();
  res.json({ transaction: txn, fromBalance: from.balance, confirmation: "ET-" + Math.floor(100000 + Math.random() * 900000) });
});

// ============================================================
// Bill pay
// ============================================================
app.get("/api/payees", requireAuth, (req, res) => res.json({ payees: db.payees.filter(p => p.ownerUsername === req.username) }));
app.post("/api/payees", requireAuth, (req, res) => {
  const { name, category, account } = req.body || {};
  if (!name || !account) return res.status(400).json({ error: "Payee name and account number are required." });
  const p = { id: db.nextIds.payee++, ownerUsername: req.username, name, category: category || "Other", account: "**** " + String(account).slice(-4) };
  db.payees.push(p);
  persist();
  res.status(201).json({ payee: p });
});
app.delete("/api/payees/:id", requireAuth, (req, res) => {
  db.payees = db.payees.filter(p => !(p.id == req.params.id && p.ownerUsername === req.username));
  persist();
  res.json({ status: "deleted" });
});

app.get("/api/billpay", requireAuth, (req, res) => res.json({ payments: db.billPayments.filter(b => b.ownerUsername === req.username) }));
app.post("/api/billpay", requireAuth, (req, res) => {
  const { payeeId, amount, date } = req.body || {};
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: "Enter a valid amount." });
  const payee = db.payees.find(p => p.id == payeeId && p.ownerUsername === req.username);
  if (!payee) return res.status(404).json({ error: "Payee not found." });
  const payment = { id: db.nextIds.bill++, ownerUsername: req.username, payee: payee.name, amount: amt, date: date || new Date().toISOString().slice(0, 10), status: "Pending" };
  db.billPayments.unshift(payment);
  persist();
  res.status(201).json({ payment });
});

// ============================================================
// Deposits
// ============================================================
app.post("/api/deposits", requireAuth, (req, res) => {
  const { accountId, amount } = req.body || {};
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: "Enter a valid check amount." });
  const acct = db.accounts.find(a => a.id === accountId && a.ownerUsername === req.username);
  if (!acct) return res.status(404).json({ error: "Account not found." });
  if (amt > 10000) return res.status(202).json({ status: "flagged", message: "Deposits over $10,000 require manual review." });
  acct.balance = +(acct.balance + amt).toFixed(2);
  const txn = { id: db.nextIds.txn++, ownerUsername: req.username, date: new Date().toISOString().slice(0, 10), description: "Mobile check deposit", category: "Deposit", account: acct.id, amount: amt, status: "Pending" };
  db.transactions.unshift(txn);
  persist();
  res.status(201).json({ status: "success", transaction: txn, balance: acct.balance });
});

// ============================================================
// Investments
// ============================================================
app.get("/api/investments", requireAuth, (req, res) => {
  const acct = db.accounts.find(a => a.type === "investment" && a.ownerUsername === req.username);
  if (!acct) return res.status(404).json({ error: "No investment account found." });
  res.json({ account: acct });
});
app.post("/api/investments/trade", requireAuth, (req, res) => {
  const { symbol, side, shares } = req.body || {};
  const n = parseInt(shares);
  const acct = db.accounts.find(a => a.type === "investment" && a.ownerUsername === req.username);
  if (!acct) return res.status(404).json({ error: "No investment account found." });
  const holding = (acct.holdings || []).find(h => h.symbol === symbol);
  if (!holding) return res.status(404).json({ error: "Unknown symbol." });
  if (!n || n <= 0) return res.status(400).json({ error: "Enter a valid number of shares." });
  if (side === "sell" && n > holding.shares) return res.status(422).json({ error: "Not enough shares to sell that amount." });
  const cost = n * holding.price;
  if (side === "buy") { holding.shares += n; acct.balance = +(acct.balance + cost).toFixed(2); }
  else { holding.shares -= n; acct.balance = +(acct.balance - cost).toFixed(2); }
  const txn = { id: db.nextIds.txn++, ownerUsername: req.username, date: new Date().toISOString().slice(0, 10), description: (side === "buy" ? "Buy — " : "Sell — ") + symbol, category: side === "buy" ? "Investment Buy" : "Investment Sell", account: acct.id, amount: side === "buy" ? -cost : cost, status: "Posted" };
  db.transactions.unshift(txn);
  persist();
  res.json({ account: acct, transaction: txn });
});

// ============================================================
// Loans
// ============================================================
app.post("/api/loans", requireAuth, (req, res) => {
  const { type, amount, term, income, employment } = req.body || {};
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: "Enter a valid loan amount." });
  let status;
  if (employment === "Unemployed") status = "Denied";
  else if (amt > parseFloat(income || 0) * 0.5) status = "Pending";
  else status = "Approved";
  const loan = { id: db.nextIds.loan++, ownerUsername: req.username, type, amount: amt, term, income, employment, status, createdAt: new Date().toISOString() };
  db.loans.push(loan);
  let newAccount = null;
  if (status === "Approved") {
    newAccount = { id: crypto.randomUUID(), ownerUsername: req.username, type: "loan", name: (type || "Personal") + " Loan", number: String(Math.floor(1000 + Math.random() * 8999)), full: "LOAN-" + loan.id, balance: -amt };
    db.accounts.push(newAccount);
  }
  persist();
  res.status(201).json({ loan, account: newAccount });
});
app.get("/api/loans", requireAuth, (req, res) => res.json({ loans: db.loans.filter(l => l.ownerUsername === req.username) }));
app.get("/api/loans/:id", requireAuth, (req, res) => {
  const loan = db.loans.find(l => l.id == req.params.id && l.ownerUsername === req.username);
  if (!loan) return res.status(404).json({ error: "Loan not found." });
  res.json({ loan });
});

// ============================================================
// AI chat assistant
// Default path: local FAQ + free keyless DuckDuckGo lookup (chatbot.js) —
// no API key needed, works on locked-down corporate laptops.
// If ANTHROPIC_API_KEY is set, that's used instead for richer answers.
// ============================================================
app.post("/api/chat", requireAuth, async (req, res) => {
  const { message } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: "Message is required." });

  const myAccounts = db.accounts.filter(a => a.ownerUsername === req.username);
  const accountsSummary = myAccounts.map(a => `${a.name} (${a.type}): $${a.balance}`).join("; ");
  const investAcct = myAccounts.find(a => a.type === "investment");
  const holdingsSummary = investAcct ? (investAcct.holdings || []).map(h => `${h.shares} ${h.symbol}`).join(", ") : "";

  if (process.env.ANTHROPIC_API_KEY) {
    const systemPrompt = `You are Nova, a friendly AI assistant embedded in "Nimbus Bank", a MOCK banking web app built purely for QA/software-testing practice (not a real bank). Answer general banking questions helpfully and briefly (2-4 sentences). You may reference this mock account data if relevant: ${accountsSummary}. Never claim to execute real transactions — this is a sandbox. Do not give real financial, legal, or investment advice; keep answers educational and generic. Keep responses concise and conversational.`;
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: process.env.ANTHROPIC_CHAT_MODEL || "claude-sonnet-5", max_tokens: 300, system: systemPrompt, messages: [{ role: "user", content: message }] })
      });
      const data = await response.json();
      if (!response.ok) throw new Error((data && data.error && data.error.message) || "Anthropic API request failed.");
      const reply = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n") || "Sorry, I couldn't process that.";
      return res.json({ reply, source: "claude" });
    } catch (err) {
      console.error("Anthropic call failed, falling back to local FAQ:", err.message);
      // fall through to the free path below rather than failing the request
    }
  }

  try {
    const result = await chatbot.answer(message, { accountsSummary, holdingsSummary });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Chat assistant is temporarily unavailable." });
  }
});

// ============================================================
// Notifications
// ============================================================
app.get("/api/notifications", requireAuth, (req, res) => res.json({ notifications: db.notifications.filter(n => n.ownerUsername === req.username) }));
app.post("/api/notifications/:id/read", requireAuth, (req, res) => {
  const n = db.notifications.find(x => x.id == req.params.id && x.ownerUsername === req.username);
  if (!n) return res.status(404).json({ error: "Notification not found." });
  n.unread = false; persist();
  res.json({ notification: n });
});
app.post("/api/notifications/read-all", requireAuth, (req, res) => {
  db.notifications.filter(n => n.ownerUsername === req.username).forEach(n => (n.unread = false));
  persist();
  res.json({ status: "ok" });
});

// ============================================================
// Explicitly-disallowed-method example (405, per your capstone's API checks)
// ============================================================
app.delete("/api/accounts", (req, res) => res.status(405).json({ error: "Method not allowed on collection resource." }));

// ============================================================
// Static frontend (serves nimbus/frontend/ — pages + css + js)
// ============================================================
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
app.use(express.static(FRONTEND_DIR));

// ---- 404 for unmatched /api routes ----
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// ---- centralized error handler ----
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Nimbus Bank server running at http://localhost:${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}/login.html`);
  console.log(`API base: http://localhost:${PORT}/api`);
});