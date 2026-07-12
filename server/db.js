/* ==========================================================================
   Nimbus Bank — server/db.js
   Tiny file-backed "database". No external DB engine required — good enough
   for a QA sandbox, and every write is a real, inspectable JSON file so you
   can diff state before/after a test run.
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "data", "db.json");

function seed() {
  const iso = (d) => d.toISOString().slice(0, 10);

  function seedTransactions() {
    const cats = ["Groceries","Dining","Transfer","Utilities","Entertainment","Salary","ATM Withdrawal","Online Shopping","Subscription","Transit","e-Transfer","Investment Buy","Investment Sell","Dividend"];
    const merchants = {
      Groceries:["Loblaws","Metro","No Frills","Whole Foods"], Dining:["Tim Hortons","A&W","Local Bistro","Sushi Go"],
      Transfer:["Internal Transfer"], Utilities:["Toronto Hydro","Enbridge Gas","Rogers"], Entertainment:["Cineplex","Spotify","Steam"],
      Salary:["Payroll Deposit - Cognizant"], "ATM Withdrawal":["ATM Withdrawal - Front St"], "Online Shopping":["Amazon.ca","Best Buy","Shopify Merchant"],
      Subscription:["Netflix","iCloud Storage","GenSpark Learning"], Transit:["TTC","GO Transit"],
      "e-Transfer":["e-Transfer to A. Lee","e-Transfer from N. Cho","e-Transfer to Naveen K.","e-Transfer from M. Singh"],
      "Investment Buy":["Buy — VEQT.TO","Buy — XEQT.TO","Buy — AAPL"], "Investment Sell":["Sell — VEQT.TO","Sell — BND"],
      Dividend:["Dividend — VEQT.TO","Dividend — XEQT.TO"]
    };
    const investOnly = ["Investment Buy","Investment Sell","Dividend"];
    let txns = []; let id = 5000;
    const accts = ["chk-001", "sav-001", "cc-001"];
    for (let i = 0; i < 70; i++) {
      const cat = cats[Math.floor(Math.random() * cats.length)];
      const merchant = merchants[cat][Math.floor(Math.random() * merchants[cat].length)];
      const isCredit = cat === "Salary" || cat === "Dividend" || cat === "Investment Sell" || (cat === "e-Transfer" && Math.random() > 0.5);
      const amount = isCredit ? +(Math.random() * 1500 + 50).toFixed(2) : -(+(Math.random() * 220 + 3).toFixed(2));
      const d = new Date(2026, 5, 1); d.setDate(d.getDate() + Math.floor(Math.random() * 61));
      let account;
      if (investOnly.includes(cat)) account = "inv-001";
      else if (cat === "e-Transfer") account = accts[Math.floor(Math.random() * 2)];
      else account = accts[Math.floor(Math.random() * accts.length)];
      txns.push({ id: id++, ownerUsername: "demo_user", date: iso(d), description: merchant, category: cat, account, amount, status: Math.random() > 0.93 ? "Pending" : "Posted" });
    }
    txns.sort((a, b) => (a.date < b.date ? 1 : -1));
    return txns;
  }

  return {
    users: {
      demo_user: { customerId: 1001, password: "Demo@1234", requires2fa: false, name: "Jordan Ellis", email: "jordan.ellis@example.com", phone: "416-555-0142", locked: false },
      otp_user: { customerId: 1002, password: "Otp@1234", requires2fa: true, name: "Priya Nathan", email: "priya.nathan@example.com", phone: "647-555-0199", locked: false },
      locked_user: { customerId: 1003, password: "Locked@1234", requires2fa: false, name: "Locked Account", email: "locked@example.com", phone: "000-000-0000", locked: true }
    },
    accounts: [
      { id: "chk-001", ownerUsername: "demo_user", type: "chequing", name: "Everyday Chequing", number: "4821", full: "1234-4821-9001", balance: 5432.18 },
      { id: "sav-001", ownerUsername: "demo_user", type: "savings", name: "High-Yield Savings", number: "7734", full: "1234-7734-2205", balance: 18230.55 },
      { id: "cc-001", ownerUsername: "demo_user", type: "credit", name: "Nimbus Rewards Visa", number: "3390", full: "4485-1122-3390", balance: -842.30, limit: 5000 },
      { id: "inv-001", ownerUsername: "demo_user", type: "investment", name: "Self-Directed Investing", number: "6610", full: "1234-6610-7789", balance: 24118.92,
        holdings: [
          { symbol: "VEQT.TO", name: "Vanguard All-Equity ETF", shares: 120, price: 44.82, dayChangePct: 0.62 },
          { symbol: "XEQT.TO", name: "iShares Core Equity ETF", shares: 80, price: 31.05, dayChangePct: -0.21 },
          { symbol: "AAPL", name: "Apple Inc.", shares: 15, price: 238.14, dayChangePct: 1.14 },
          { symbol: "BND", name: "Vanguard Total Bond Market", shares: 40, price: 72.30, dayChangePct: 0.04 }
        ] }
    ],
    transactions: seedTransactions(),
    payees: [
      { id: 1, ownerUsername: "demo_user", name: "Toronto Hydro", category: "Utilities", account: "**** 2201" },
      { id: 2, ownerUsername: "demo_user", name: "Rogers Communications", category: "Internet & Phone", account: "**** 9981" },
      { id: 3, ownerUsername: "demo_user", name: "Meridian Landlord Services", category: "Rent", account: "**** 4410" }
    ],
    billPayments: [
      { id: 101, ownerUsername: "demo_user", payee: "Toronto Hydro", amount: 128.44, date: "2026-06-28", status: "Completed" },
      { id: 102, ownerUsername: "demo_user", payee: "Rogers Communications", amount: 94.00, date: "2026-06-25", status: "Completed" },
      { id: 103, ownerUsername: "demo_user", payee: "Meridian Landlord Services", amount: 1850.00, date: "2026-07-01", status: "Pending" },
      { id: 104, ownerUsername: "demo_user", payee: "Toronto Hydro", amount: 110.20, date: "2026-05-28", status: "Failed" }
    ],
    eTransferRecipients: [
      { id: 1, ownerUsername: "demo_user", name: "Naveen K.", contact: "naveen@example.com" },
      { id: 2, ownerUsername: "demo_user", name: "Anjali Lee", contact: "anjali.lee@example.com" },
      { id: 3, ownerUsername: "demo_user", name: "Mom", contact: "647-555-0110" }
    ],
    notifications: [
      { id: 1, ownerUsername: "demo_user", title: "Deposit received", body: "$1,200.00 deposited to Everyday Chequing", time: "2h ago", unread: true },
      { id: 2, ownerUsername: "demo_user", title: "Bill payment scheduled", body: "Meridian Landlord Services — $1,850.00 on Jul 1", time: "1d ago", unread: true },
      { id: 3, ownerUsername: "demo_user", title: "New sign-in detected", body: "Sign-in from Toronto, ON on Chrome/Windows", time: "3d ago", unread: false }
    ],
    loginActivity: [
      { ownerUsername: "demo_user", device: "Chrome on Windows", location: "Toronto, ON, CA", time: "2026-07-01 08:12", status: "Success" },
      { ownerUsername: "demo_user", device: "Safari on iPhone", location: "Toronto, ON, CA", time: "2026-06-29 19:44", status: "Success" },
      { ownerUsername: "demo_user", device: "Chrome on macOS", location: "Unknown", time: "2026-06-24 03:15", status: "Blocked" }
    ],
    loans: [],
    nextCustomerId: 1004,
    nextIds: { payee: 200, bill: 200, recipient: 200, notification: 200, loan: 1, txn: 90000 }
  };
}

function load() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (e) {
    console.error("Failed to read db.json, reseeding:", e.message);
  }
  const fresh = seed();
  save(fresh);
  return fresh;
}
function save(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function reset() {
  const fresh = seed();
  save(fresh);
  return fresh;
}

module.exports = { load, save, reset, seed };
