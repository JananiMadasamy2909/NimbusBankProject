/* ==========================================================================
   Nimbus Bank — server/chatbot.js
   No-API-key chat brain: a local FAQ knowledge base covering everything the
   app itself does, plus an optional free web lookup (DuckDuckGo's Instant
   Answer API, no key required) for general knowledge questions the FAQ
   doesn't cover. This is the default path — see server/server.js, which
   only reaches for a paid LLM if ANTHROPIC_API_KEY happens to be set.
   ========================================================================== */

// Each entry: keywords (any match counts, more matches = better score) and
// an answer — either a plain string or a function(ctx) for account-aware replies.
const FAQ = [
  {
    keywords: ["balance", "how much do i have", "how much money"],
    answer: (ctx) => ctx.accountsSummary
      ? `Here are your current balances: ${ctx.accountsSummary}.`
      : "I couldn't find any accounts on your profile. Try Accounts in the sidebar to open one."
  },
  {
    keywords: ["e-transfer", "etransfer", "interac"],
    answer: "e-Transfer sends money to a saved recipient by email or phone, from the e-Transfer tab on the Transfer page. There's a $3,000 limit per transfer. If the recipient doesn't have Autodeposit on, you'll set a security question they need to answer."
  },
  {
    keywords: ["transfer", "move money", "send money between"],
    answer: "To transfer money: go to Transfer / e-Transfer in the sidebar, pick a from/to account, enter an amount, and confirm. Internal transfers post instantly in this sandbox."
  },
  {
    keywords: ["password", "reset password", "forgot password", "change password"],
    answer: "You can change your password under Profile → Security. If you're locked out, use 'Forgot password?' on the sign-in page."
  },
  {
    keywords: ["2fa", "two-factor", "two factor", "otp", "verification code", "authentication code"],
    answer: "Two-factor authentication emails you a 6-digit code at sign-in. Turn it on or off under Profile → Security. In this sandbox, the OTP page shows the code directly so you don't need a real inbox."
  },
  {
    keywords: ["investment", "stock", "holding", "trade", "shares", "etf"],
    answer: (ctx) => ctx.holdingsSummary
      ? `Your investment holdings: ${ctx.holdingsSummary}. You can buy or sell any of them from the Investments page.`
      : "You don't have an investment account yet — you can open one from Open New Account."
  },
  {
    keywords: ["loan", "borrow", "apply for a loan", "mortgage", "auto loan"],
    answer: "Apply for a loan on the Loan Application page. Approval depends on the amount relative to your stated income and employment status — it's instant in this sandbox, no real underwriting."
  },
  {
    keywords: ["deposit", "check", "cheque", "cash a check"],
    answer: "Deposit a check from the Deposit Check page — upload is mocked, just enter an amount. Anything over $10,000 gets flagged for manual review so you can test that flow."
  },
  {
    keywords: ["bill", "payee", "pay a bill"],
    answer: "Add payees and pay bills from the Bill Pay page. You can add a payee, schedule a payment, and see payment history there."
  },
  {
    keywords: ["open account", "new account", "open a new"],
    answer: "Open New Account in the sidebar walks you through a short wizard: pick a type (chequing, savings, investment, or credit), name it, and set an initial deposit."
  },
  {
    keywords: ["credit card", "credit limit"],
    answer: "Your credit card balance and limit are shown on its account card under Accounts, with a usage bar."
  },
  {
    keywords: ["notification", "alert"],
    answer: "Notifications live under the bell icon in the top bar — click one to mark it read, or use 'mark all read'."
  },
  {
    keywords: ["reset data", "reset sandbox", "start over", "clean data"],
    answer: "You can reset all sandbox data back to the seeded demo state from the login page or Profile → Danger zone."
  },
  {
    keywords: ["hi", "hello", "hey"],
    answer: "Hi! I'm Nova. Ask me about your balances, transfers, e-Transfer, deposits, loans, investments, or how any page in this sandbox works."
  }
];

function matchFaq(message) {
  const lower = message.toLowerCase();
  let best = null, bestScore = 0;
  for (const entry of FAQ) {
    const score = entry.keywords.reduce((s, k) => s + (lower.includes(k) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  return best;
}

// Free, keyless general-knowledge fallback. Works well for factual
// "what is X" style questions; returns null for most conversational
// queries, since it's an instant-answer box, not a full search engine.
async function webLookup(message) {
  try {
    const url = "https://api.duckduckgo.com/?q=" + encodeURIComponent(message) + "&format=json&no_html=1&skip_disambig=1";
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.AbstractText) return data.AbstractText;
    if (Array.isArray(data.RelatedTopics)) {
      const withText = data.RelatedTopics.find(t => t && t.Text);
      if (withText) return withText.Text;
    }
    return null;
  } catch (e) {
    return null; // network blocked, timed out, or no answer — caller falls back gracefully
  }
}

async function answer(message, ctx) {
  const faqMatch = matchFaq(message);
  if (faqMatch) {
    const text = typeof faqMatch.answer === "function" ? faqMatch.answer(ctx) : faqMatch.answer;
    return { reply: text, source: "faq" };
  }
  const webAnswer = await webLookup(message);
  if (webAnswer) {
    return { reply: webAnswer, source: "web" };
  }
  return {
    reply: "I don't have a specific answer for that yet. Try asking about your balance, transfers, e-Transfer, deposits, loans, bills, or investments — or check the sidebar for the right page.",
    source: "fallback"
  };
}

module.exports = { matchFaq, webLookup, answer };