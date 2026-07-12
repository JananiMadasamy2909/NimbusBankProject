# Nimbus Bank — QA Sandbox (with backend)

A mock, multi-page banking web app with a **real Express backend** behind it —
built specifically for practicing software testing. Nothing here is a real
bank. Data now lives server-side in a JSON file, so it's genuinely dynamic and
shared across tabs, browsers, and even machines on your network — not just
`localStorage` tricks.

---

## 1. Setup

```
cd server
npm install
npm start
```

Then open `http://localhost:8000/login.html`. The Express server does two
jobs at once: it serves the frontend (everything in `frontend/`) **and**
exposes the REST API under `/api/*` — one process, one port, same-origin, no
CORS headaches (though CORS is enabled anyway since your capstone plan wants
to test CORS headers).

To change the port: `PORT=4000 npm start`.

### Running the frontend on its own (optional)

The default setup above serves `frontend/` and `/api/*` from the same
Express process, which is the simplest thing to run and avoids CORS entirely.
If you'd rather serve the frontend from a separate process/port (e.g. to
develop it independently, or to more closely mirror a real split-deployment
setup), you can:

```
cd frontend
npx serve -l 5500
```

`js/api.js` calls the API with relative paths (`/api/...`), so if the
frontend is served from a different origin than the backend, those calls
will 404. In that case, change the `apiFetch` calls in `frontend/js/api.js`
to use an absolute URL (e.g. `http://localhost:8000/api/...`) — CORS is
already enabled on the server, so cross-origin requests will work once the
URLs point at the right host. Ask me and I can wire up an easy `API_BASE`
config variable if you want to switch between the two setups without editing
code each time.

**Test credentials**

| Username      | Password       | Purpose                          |
|----------------|----------------|-----------------------------------|
| `demo_user`    | `Demo@1234`    | Standard login, no 2FA            |
| `otp_user`     | `Otp@1234`     | Triggers email one-time-code flow |
| `locked_user`  | `Locked@1234`  | Always returns "account locked"   |

**Resetting data**: `POST /api/admin/reset` restores the seed dataset for
everyone (also reachable via the "Reset all sandbox data" link on the login
page, or the same option under Profile → Danger zone). Run it between test
suites for repeatable state — exactly the "reset via Admin panel" pattern
your Parabank capstone plan already calls for.

---

## 2. Architecture

```
nimbus/
├── frontend/
│   ├── css/styles.css
│   ├── js/
│   │   ├── api.js       ← fetch wrapper + one function per endpoint
│   │   └── app.js        ← page chrome, toast, modal, AI chat widget
│   └── *.html             ← one file per page/route
└── server/
    ├── server.js         ← Express app: all REST routes + serves frontend/
    ├── db.js              ← seed data + file-backed persistence
    ├── package.json
    └── data/db.json       ← generated at runtime (gitignore this)
```

The frontend is entirely static (no build step, no bundler) — `server.js`
serves it via `express.static`, pointed at `frontend/`. You could equally
serve that folder with any other static host (nginx, `npx serve`, GitHub
Pages) as long as it can reach the API; see "Running the frontend on its own"
below if you want to split them onto different ports.

**Auth model**: `POST /api/login` returns a bearer token, stored client-side
in `sessionStorage` (clears when the tab closes — good for session-expiry
testing) and sent as `Authorization: Bearer <token>` on every subsequent
call. `requireAuth` middleware on the server rejects anything without a
valid, unexpired token with `401`.

**Persistence**: every mutation (`POST`/`PATCH`/`DELETE`) writes the whole
in-memory store to `server/data/db.json` synchronously. Restarting the
server does **not** wipe your data — only `POST /api/admin/reset` does.
Delete `server/data/db.json` by hand for a hard reset without hitting the API.

---

## 3. API reference

All endpoints are prefixed `/api`. Auth-required endpoints need
`Authorization: Bearer <token>`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | No | Smoke-test target |
| POST | `/admin/reset` | No | Resets all data |
| POST | `/register` | No | 409 on duplicate username |
| POST | `/login` | No | 401 bad creds, 403 locked, 429 after 5 fails/60s |
| GET | `/otp/peek?otpToken=` | No | Test-only: read the "emailed" code |
| POST | `/otp/resend` | No | |
| POST | `/otp/verify` | No | 410 if expired, 401 if wrong |
| POST | `/logout` | Yes | |
| GET / PUT | `/me` | Yes | Profile |
| PUT | `/me/password` | Yes | 401 if current password wrong |
| PUT | `/me/2fa` | Yes | Toggle 2FA |
| DELETE | `/me` | Yes | |
| GET | `/login-activity` | Yes | |
| GET | `/customers/:id`, `/customers/:id/accounts` | Yes | Parabank-style aliases; 403 on someone else's id |
| GET / POST | `/accounts` | Yes | |
| GET / PATCH / DELETE | `/accounts/:id` | Yes | 404 unknown id, 403 not yours |
| GET | `/accounts/:id/transactions` | Yes | |
| GET | `/transactions` | Yes | Query: `accountType, accountId, category, from, to, q, min, max, sort, dir, page, perPage` |
| POST | `/transfer` | Yes | 400 bad amount, 404 unknown account, 422 insufficient funds |
| GET / POST | `/etransfer/recipients` | Yes | |
| POST | `/etransfer` | Yes | 422 over $3,000 limit or insufficient funds |
| GET / POST | `/payees` | Yes | |
| DELETE | `/payees/:id` | Yes | |
| GET / POST | `/billpay` | Yes | |
| POST | `/deposits` | Yes | Returns `202 {status:"flagged"}` above $10,000 |
| GET | `/investments` | Yes | |
| POST | `/investments/trade` | Yes | 422 selling more shares than held |
| POST | `/loans` | Yes | Approve/deny/pending by income ratio; approval creates a loan account |
| GET | `/loans`, `/loans/:id` | Yes | |
| GET | `/notifications` | Yes | |
| POST | `/notifications/:id/read`, `/notifications/read-all` | Yes | |
| DELETE | `/accounts` (collection) | — | Always `405`, on purpose — a disallowed-method test case |

Every error response is `{ "error": "..." }` with an appropriate status
code — ready to assert against directly in Playwright API tests or REST
Assured.

---

## 4. Testing types this app supports

### Functional / UI / E2E
Full journeys through real HTTP calls: register → login → open an account →
transfer → pay a bill → view it in transaction history. Every button still
carries a `data-testid`.

### API testing (now the star of the show)
Point Playwright's `request` fixture, REST Assured, or Postman/Newman
directly at `http://localhost:8000/api/*`. Suggested coverage per endpoint:
correct 2xx response + schema, 400 on bad input, 401 without a token, 403 on
cross-user access, 404 on unknown IDs, 422 on business-rule violations (
insufficient funds, e-Transfer limit), 405 on disallowed methods.

### Security testing
- No token → 401 on every protected route
- Token for user A used against user B's account/customer id → 403
- Passwords are never included in any API response body
- Brute-force lockout: 5 bad logins locks that username for 60 seconds (429)
- Script-tag/XSS payloads in text fields (payee name, transfer memo, chat
  input) — the frontend escapes on render and the API stores them as plain
  strings, so assert they never execute
- CORS headers present (`Access-Control-Allow-Origin`) — inspect via
  `curl -i` or your test tool's response headers

### Negative / boundary testing
Transfer/e-Transfer amount = 0, negative, non-numeric, over balance, over the
$3,000 e-Transfer limit; deposit exactly at/over $10,000; OTP wrong code /
expired token; registering a duplicate username (`409`); DOB making someone
exactly 18 today.

### Session & state testing
- Session token lives in `sessionStorage` — clear it mid-session and confirm
  the next page redirects to login
- Token TTL is 2 hours server-side; OTP tokens expire in 10 minutes — good
  targets for time-based/mocked-clock tests
- Multi-tab: two tabs sharing the same `sessionStorage` origin share a
  session; a private/incognito window does not

### Accessibility testing — yes
Unchanged from the client-only build: skip links, semantic landmarks, real
`<label for>` everywhere, `aria-live` toasts, `aria-sort` headers, focus-
trapping modals. Use `@axe-core/playwright`, Lighthouse CI, or pa11y-ci.

### Performance / load testing
This is the big upgrade: there's now a **real server** to point k6 or Locust
at. Suggested targets straight from your capstone plan: `POST /api/login`
under concurrent load, `GET /api/accounts/:id`, `POST /api/transfer` for
data-corruption checks under concurrency, and a ramp-up/soak test against
the whole API. The file-backed store writes synchronously on every request,
so it's a legitimate (if deliberately modest) bottleneck to characterize.

### BDD
`data-testid` attributes plus a real, stable API make Gherkin steps easy to
back with either UI actions or direct API calls:
```
Given I am logged in as "demo_user"
When I POST /api/transfer from "chk-001" to "sav-001" for "50.00"
Then the response status should be 200
And the chequing account balance should decrease by "50.00"
```

### Cross-browser / responsive
Unchanged — plain HTML/CSS/JS, no framework, runs identically across
Chromium/Firefox/WebKit and down to a 375px viewport.

---

## 5. Known bugs (intentionally left in — use as real test cases)

| # | Bug | Testing type |
|---|---|---|
| 1 | Registering with an existing username returns `409` correctly now, but the client-side form doesn't surface *which* field caused it — it just shows the generic server message | UX / negative |
| 2 | DOB age check on the client uses year-only math (server-side check is date-accurate) — client and server can disagree right at the boundary | Boundary / consistency |
| 3 | Deposit dropzones are not keyboard-accessible (no `tabindex`/`role`) | Accessibility |
| 4 | Notification preferences on the Profile page are UI-only — toggling them does not call any API and won't survive a reload | Functional / data persistence |
| 5 | `PATCH /api/accounts/:id` accepts an empty-string name silently (no server-side non-empty check, only the client checks) | Negative / validation gap |
| 6 | No idempotency key on `/api/transfer` or `/api/etransfer` — rapid double-submission before the button disables can double-post | Race condition / concurrency |
| 7 | Investment "loan" accounts created by an approved loan use `type: "loan"`, which the Transactions page's account-type filter dropdown doesn't have a label mapping for — it'll show but with awkward casing | UI / edge case |

---

## 6. Suggested tool mapping

| Testing type | Tool |
|---|---|
| Functional / regression / E2E | Selenium, Playwright |
| API | Playwright `request`, REST Assured, Postman/Newman |
| BDD | Cucumber + Playwright/Selenium or direct API step defs |
| Accessibility | axe-core, `@axe-core/playwright`, Lighthouse CI, pa11y-ci |
| Performance | k6, Locust — real endpoints to hit now |
| Security | Manual XSS/auth probing, OWASP ZAP baseline scan |
| Cross-browser | Playwright's multi-browser runner |
