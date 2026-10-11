# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MyMoney2 is a personal finance management application with multi-provider bank data integration (GoCardless, Enable Banking). It syncs bank accounts/transactions automatically, imports bank files (DSK „Excel“ .xls, Revolut CSV), categorizes transactions via pattern-matching rules, and provides dashboards and reports.

**Language:** Bulgarian (UI, user-facing messages and code comments)

## Commands

```bash
npm install          # Install dependencies
npm start            # Start server (http://localhost:3456)
npm run dev          # Start with auto-reload (nodemon)
npm run demo         # Start with demo database (data/demo.db)
npm run seed-demo    # Create/reset demo database with sample data
node screenshots.js  # Regenerate README screenshots (puppeteer; starts its own server on port 3498 with data/demo.db — never the real data)
```

Also: `start.bat` / `start.sh` (start + open browser), `bin/cli.js` (npm CLI `mymoney2 --port <n> --no-open`).

**Switch database:** `DATABASE_NAME=demo.db` in `.env` (requires restart). Env vars override `.env`, so a second instance can run alongside the main one:

```bash
PORT=3499 DATABASE_NAME=zz-test.db node backend/server.js
```

## Testing & Verification

- **No test suite** (`npm test` exits with error). Verify changes manually.
- **Never test against `data/finance.db`** — it is the user's real data. Copy it (`cp data/finance.db data/zz-test.db`), run a second server on another port (see above), then delete the copy.
- Real bank APIs can't be exercised without the user approving access at the bank. For provider logic, instantiate the provider directly and replace `provider._getClient` with a fake axios-like `{ get, post, delete }` returning `{ data }`.
- Telegram: replace `axios.post` with a fake before requiring `backend/telegram.js` and drive `telegram._internal.handleMessage/handleCallback` (no real bot needed). On a DB copy set `schedule.lastConsentCheck` to today first — otherwise the scheduler calls the real bank API.
- Frontend: check in the browser (Playwright MCP is available) and look at console errors. Static files are served by `express.static` without cache settings and the browser often keeps the old JS/CSS — force-reload (Ctrl+F5) after changes.
- Port 3456 is usually the user's running instance — don't kill it; use another port for testing.

## Tech Stack

- **Backend:** Node.js/Express, SQLite3, axios, jsonwebtoken
- **Frontend:** Vanilla HTML/CSS/JavaScript, Chart.js 4 (CDN) — no frameworks, no build step
- **Database:** SQLite at `./data/<DATABASE_NAME>` (auto-created, schema migrated on startup in `database.initialize()`)

## Architecture

### Backend (`backend/`)

| File | Purpose |
|------|---------|
| `server.js` | Express app entry point; mounts route modules, plus a few inline endpoints (countries, counterparty aliases, logs, backup, version) |
| `database.js` | SQLite operations, schema + migrations, promise wrappers (`runQuery`, `getQuery`, `allQuery` — the last is not exported) |
| `transaction-processor.js` | Shared pipeline: enrich (country + category) + upsert; used by providers and file import |
| `categorization.js` | Transaction auto-categorization engine |
| `file-import.js` | File import entry point: detects the format by content (DSK `.xls`, Revolut CSV), resolves the account(s), drops duplicates, saves |
| `dsk-import.js` | DSK „Excel“ export parser (HTML table — account number, type, reference, FX). IDs are the same as the former XML import (XML support was removed — no account info, no type) |
| `revolut-import.js` | Revolut CSV parser (product, fee, balance, start/completion time; approximate currency-to-EUR rates) |
| `sync-service.js` | `runSync()` — shared by the sync button (SSE) and the scheduler; one sync at a time; post-sync reconcile + `onAfterSync` hooks (Telegram) |
| `scheduler.js` | In-app schedule (30 s tick, Europe/Sofia time via `time.js`): sync at `schedule.syncTimes` (off by default, max 4/day), daily backup, bank-consent expiry warning |
| `backup.js` | `VACUUM INTO` backups in `data/backups`; `*_auto_<date>.db` pruned to 14 daily + 12 monthly; manual `*_backup_*` kept |
| `telegram.js` | Telegram bot (long polling, no public URL): message per new bank transaction with category buttons, reply = note, `/pending`, `/status`, alerts; pairing via `/start <code>` |
| `api-debug.js` | Debug option (Settings → „Дебъг“, `debug.apiResponses`): saves every raw bank API response (GoCardless, Enable Banking; not token/auth calls) to `data/api-responses/<date>/*.json` — analyse without repeating rate-limited requests; delete from Settings |
| `telegram-format.js` | Readable Telegram text: clean merchant name + city/flag from DSK card counterparties, purchase date/time and card from the description, foreign amount, note from the transfer reason, short account name |
| `category-groups.js` | Category groups (`parent_id`): `categoryFilterSql()` — a category filter includes its subcategories; `groupRows()` — report rows nested under their group (`isGroup`, `children`) |
| `insights.js` | Analytical reports: cash flow / savings rate, recurring payments, year-over-year comparison, bank costs, trips abroad |
| `transaction-matching.js` | Matching file ↔ bank transactions, Revolut account resolution, Revolut pocket fix, `reconcileImportedTransactions()` |
| `country-codes.js` | ISO 3166-1 alpha-3 codes with flag emojis; extracts country from counterparty names |
| `config.js` | Configuration loader (`port`, `databasePath`, `nodeEnv`) |
| `logger.js` | File logging with rotation at 5MB (`data/app.log`) |
| `seed-demo.js` | Demo database seeder |

Routes in `backend/routes/`: `providers.js`, `sync.js`, `accounts.js`, `transactions.js`, `categories.js` (exports `categoryRouter` + `rulesRouter`), `reports.js`, `helpers.js` (`apiError`).

### Provider System (`backend/providers/`)

| File | Purpose |
|------|---------|
| `base-provider.js` | Abstract base class defining the provider interface |
| `provider-registry.js` | Registry/factory; classes are registered in `server.js` (scripts that don't load `server.js` must instantiate the provider class directly) |
| `gocardless-provider.js` | GoCardless Bank Account Data API integration |
| `enablebanking-provider.js` | Enable Banking API integration (JWT/RSA auth) — **incomplete**: `completeAuthorization()` is never called, `/auth` lacks `access`/`state`/country, redirect is localhost (see `docs/ROADMAP.md`) |

### Frontend (`frontend/`)

- **SPA:** single `index.html`, page routing via `data-page` attributes and URL hash
- **Scripts:** classic `<script>` tags sharing the global scope (no modules, no bundler). Load order in `index.html` matters: `api-client` → `utils` → `modal` → `transaction-details` → `charts` → `dashboard` → `transactions` → `import` → `categories` → `reports` → `insights` → `settings` → `automation` → `sync` → `app` (last).

| File | Purpose |
|------|---------|
| `api-client.js` | Singleton `api` (`APIClient`); every backend call goes through it (except the SSE stream in `sync.js`) |
| `utils.js` | Formatting (`formatDate` returns a **local** `YYYY-MM-DD` — never use `toISOString()` for dates), `escapeHtml` (escapes quotes too), `makeTableSortable`, `showLoader`/`hideLoader` (counted, delayed), `showNotification` |
| `modal.js` | `openModal` / `closeModal` / `updateModal` / `isModalOpen` and `openOverlay` / `closeOverlay` — the only way to use `#modal` / `#overlayModal`; they reset state, handle Escape, backdrop, Enter-to-save, autofocus and double-submit |
| `transaction-details.js` | Shared "Детайли на транзакция" view (`renderTransactionDetails`, `bindTransactionDetails`) used by the transactions page and report lists |
| `transactions.js` | Transactions page (`transactionsPage`), filters, pagination, details modal (`showRawData`) |
| `automation.js` | Settings cards „Автоматизация“ (schedule, backup) and „Telegram“ (token, pairing, quiet hours) |
| `insights.js` | Analytical report tabs (registers into `REPORT_SECTIONS`); lists behind rows via `data-action="insight-tx"` / `"compare-tx"` |
| `reports.js` | All reports; `reportState`; `openTransactionsListModal(title, transactions, { showCategory, note })` and `showTransactionOverlay(index)` |
| `categories.js`, `settings.js`, `sync.js`, `import.js`, `dashboard.js`, `charts.js` | Their pages / dialogs |
| `app.js` | Routing (`navigateToPage` returns a promise), `refreshCurrentPage`, `ACTION_HANDLERS`, init (incl. `?ref=` return from the bank) |

- **Events:** no inline `onclick`. Generated HTML uses `data-action="..."` + data-* attributes, dispatched by the delegated handler / `ACTION_HANDLERS` in `app.js`; page-specific lists use delegated listeners bound once. Listeners must be bound once — page loaders run on every visit.
- **Escaping:** everything from the server (especially bank data: counterparty names, descriptions) goes through `escapeHtml` before `innerHTML`.
- **Chart.js** is vendored in `frontend/vendor/` (no CDN — the app must work offline).

### Database Schema (9 tables)

- `accounts` — bank accounts: IBAN, balance (EUR), institution, `provider_id`, `authorization_id`, `original_currency` (the account's currency at the bank; `currency` is always EUR). Special account `CASH` holds manual transactions.
- `transactions` — dates, amounts (EUR) + `original_amount/currency`, description, counterparty, category, notes, country, `raw_data`
- `categories` — colors, `parent_id` (group; one level only — transactions and rules point to subcategories, a group only sums them; reports return groups with `children`, the frontend renders them with `renderGroupedRows()` and a ▸ toggle, filters select a group with its subcategories, Telegram „Всички категории“ shows groups first), `icon` = emoji (shown on Telegram buttons; edited in the category form; `migrateCategoryEmoji()` replaces old icon names on startup), `type` (income/expense/transfer)
- `categorization_rules` — pattern-matching rules with priority
- `providers` — bank data providers with credentials (JSON)
- `provider_sessions` — provider auth tokens/sessions
- `counterparty_aliases` — display names for counterparties
- `app_settings` — key/value settings (`schedule.*`, `telegram.*`, `sync.lastResult`) via `getSetting`/`setSetting`
- `telegram_notifications` — one row per notified transaction (short id used in button `callback_data`, message id for replies)

**Transaction ID sources** (matters for deduplication):

| Prefix / form | Source |
|---|---|
| `DSK_xxxxxxxx` | DSK `.xls` import (hash; older rows from the former XML import have the same IDs) |
| `REV_xxxxxxxx` | Revolut CSV import (hash) |
| `CASH_<ts>_<rand>` | Manual cash transaction |
| other | Bank API: GoCardless `transactionId`, else `internalTransactionId` (DSK returns only the latter) |

Bank-API transactions have JSON `raw_data` with `transactionAmount`; queries use `raw_data LIKE '%"transactionAmount"%'` to select them. File imports are deduplicated against existing transactions (`transaction-matching.js`): Revolut by amount + balance after the transaction (or exact time, CSV times are Europe/Sofia), DSK by date + amount + counterparty (same date + amount only when the groups on both sides are the same size). `reconcileImportedTransactions()` runs automatically after every transaction sync (`routes/sync.js`) and from Settings → „Дубликати от импорт“ (`POST /transactions/reconcile-imports`, dry run by default). Steps: old Revolut imports to the account of their product → fee fix for old Revolut imports (`Сума − Такса`; before matching, otherwise the amounts differ) → file ↔ bank merge (the bank row is kept, category/notes are carried over) → DSK card holds.

**File import accounts:** DSK `.xls` → account by the number in the header (IBAN ends with it); Revolut CSV → by `Продукт` (Разплащателна → account with IBAN, Спестявания → pocket = Revolut account without IBAN) + `Валута`.

**DSK card holds:** the DSK API has returned card authorizations (blocked amounts) as booked transactions — no `entryReference`, positive amount, text only `<masked card> <12-digit code>`; the settled payment comes later as a separate row. `isDskCardHold()` skips them in the GoCardless sync, `removeDskCardHolds()` (part of the reconcile) merges stored ones into the payment (same account, opposite amount, ≤10 days later, purchase date in the text = hold date). In the DSK `.xls` such pending rows have no „Вид на трансакцията“ and are skipped on import.

**Revolut transfers between own accounts (main ↔ pocket „Caravan“, USD ↔ EUR):** both legs come with the **same `transactionId`** and different `internalTransactionId`. The transaction ID is therefore `internalTransactionId || transactionId` (DSK only has the internal one). Older rows keyed by `transactionId` keep their ID: `_keepExistingTransactionIds()` matches first by `internalTransactionId` stored in `raw_data`, then by content. (Earlier the shared key made one leg overwrite the other, which looked like „GoCardless returns pocket transfers in the other account“ — the former `fixRevolutPocketTransfers()` was removed.) Revolut sends the text in `remittanceInformationUnstructuredArray` (no `remittanceInformationUnstructured`) — see `transactionDescription()` in the GoCardless provider.

## Key Implementation Patterns

**Provider abstraction:**
- `BaseProvider` defines the interface: `getInstitutions()`, `createAuthorization()`, `listAuthorizations()`, `syncAllAccounts()`, `syncAccountTransactions()`, etc.
- Credentials are stored in the `providers` table and managed via UI (not `.env`)

**Database operations:**
- All queries are parameterized
- Upsert for transactions: insert if new; if the ID exists, update bank-provided fields but keep `category_id` and `notes`
- `PRAGMA foreign_keys = ON` — to change an account ID use `migrateAccountId()` (insert copy → move transactions → delete old)
- Schema changes: add `ALTER TABLE ... ADD COLUMN` with `.catch(() => {})` in `initialize()`

**Errors to the UI:**
- `apiError()` shows the real message only if it starts with `GoCardless:` / `Enable Banking:` / `Provider `, or contains `not found` / `задължителн` / `не е намерен`; otherwise the user sees a generic message. Prefix provider errors accordingly.
- The `/api/sync/run` SSE stream sends `error.message` directly.

**GoCardless integration:**
- Access token refreshed automatically 5 minutes before expiry
- Account sync uses requisitions with status `LN`. GoCardless keeps `LN` even after the End User Agreement (EUA) expires — `listAuthorizations()` loads each agreement and adds `expiresAt` / `expired`.
- EUA cannot be extended for EU banks (`reconfirm` is GB-only) — the user must approve again at the bank. `createAuthorization()` creates an agreement with the institution's maximum `access_valid_for_days` (DSK/Revolut: 180) and `max_historical_days` (DSK 90, Revolut 730).
- **Reconnect ("Поднови" in Settings) must continue history:** a new account ID is matched to the existing account by IBAN + `original_currency` (the Revolut accounts share one IBAN) and migrated; a transaction whose bank ID changed is matched 1:1 (date, amount, currency, reference, text, counterparty) and keeps its old ID, category and notes.
- **Rate limit:** GoCardless allows ~4 calls/day per account per endpoint (PSD2 unattended access) — the scheduler allows at most 4 sync times a day; more returns 429.
- GoCardless redirect after bank approval: the route uses the host the app was opened from (`req.protocol://req.get('host')/`), so it works on a server in the LAN.
- Transaction sync is incremental: from the last bank transaction minus 7 days, clamped to the agreement's history window (new account → full history).
- Redirect after bank approval is `http://localhost:<port>/`; GoCardless appends `?ref=...` and the frontend then auto-runs a full sync.
- HTTP errors are turned into readable Bulgarian messages in `describeApiError()` (expired EUA, 429 rate limit).

**Enable Banking integration:**
- JWT signed with RSA private key (PS256) for each request
- Flow: JWT → GET /aspsps → POST /auth → user authorizes → POST /sessions → GET /accounts/transactions

**Auto-categorization:**
- Patterns are case-insensitive; multiple patterns separated by `|` (OR)
- Applied in priority order (highest first), matching description and counterparty
- Fallback: category of the latest transaction with the same counterparty

**Reports:**
- Report filters live in `appendReportFilters()` in `database.js` (period, types, category). Uncategorized transactions count as `expense`.
- `GET /reports/transactions` returns the transactions behind a report row using the same filters, so counts and lists match. Keep both sides on the shared helper when changing a report.
- Analytics (`insights.js`) sum by category type, net of refunds (a refund in an expense category lowers the expense); a negative amount in an income category (e.g. Trading 212 in „Инвестиции“) is shown as „invested“ and is part of savings. Trips use the purchase date from the card text (DSK settles 1–5 days later). In SQL, don't alias a computed column as `type` and `GROUP BY` it — SQLite groups by the `c.type` column instead.
- Credit cards (`isCreditCardAccount()` in `utils.js`): DSK returns the available credit limit as the balance — the dashboard total leaves them out.

## Environment Variables

In `.env` (see `.env.example`):
- `PORT` — server port (default 3456)
- `DATABASE_NAME` — SQLite filename in `./data/` (default `finance.db`; demo: `demo.db`). **Requires restart.**
- `NODE_ENV` — defaults to `development` when unset; in development log lines are also printed to the console

## API Endpoints

All prefixed with `/api/`:
- **Providers:** `GET /providers`, `GET /providers/:id`, `PUT|DELETE /providers/:id/credentials`, `GET /providers/:id/credential-fields`, `GET /providers/:id/status`
- **Provider banking:** `GET /providers/:id/institutions`, `POST|GET /providers/:id/authorizations`, `GET|DELETE /providers/:id/authorizations/:authId`
- **Sync:** `POST /sync/run` (SSE progress stream, body `{ mode: 'accounts'|'transactions'|'both' }` — used by the UI), `POST /sync/accounts`, `POST /sync/transactions`
- **Accounts:** `GET /accounts`, `GET /accounts/:id`, `GET /accounts/by-institution/:pattern`, `PUT /accounts/:id/name`
- **Transactions:** `GET /transactions` (filters: account_id, start_date, end_date, category_id, type, search, country, limit, offset), `GET /transactions/stats`, `POST /transactions` (manual), `POST /transactions/import-file` (DSK .xls or Revolut CSV; `accountId` optional — auto-detected), `POST /transactions/reconcile-imports` (`{ dryRun }`), `POST /transactions/categorize-by-counterparty`, `PUT /transactions/:id/category|notes|country`, `POST /transactions/:id/reprocess`
- **Categories:** CRUD at `/categories`; `/categorization-rules` CRUD + `POST /categorization-rules/apply`
- **Reports:** `/reports/monthly` (category/counterparty/account breakdowns), `/reports/transactions`, `/reports/last-12-months`, `/reports/category-breakdown`, `/reports/counterparty`, `/reports/country`, `/reports/category-monthly`; analytics (`insights.js`): `/reports/cash-flow`, `/reports/recurring`, `/reports/year-comparison?year&month&mode=month|ytd`, `/reports/bank-costs` (category „Банкови“), `/reports/trips`
- **Debug:** `GET|PUT /debug` (`{ apiResponses }`), `DELETE /debug/api-responses`
- **Schedule / Telegram:** `GET|PUT /schedule`, `GET|PUT|DELETE /telegram`, `POST /telegram/pair|test|pending`, `DELETE /telegram/chat`
- **Other:** `/countries`, `/countries/:code`, `/counterparty-aliases` (CRUD), `GET /logs`, `POST /backup`, `GET /version`

## Versioning & Claude Code Setup

- App version is in `VERSION` (`major.minor`, served by `/api/version`); `package.json` version is separate.
- Hook `.claude/hooks/version-bump.js` bumps the minor version and stages `VERSION` on every `git commit` run through Claude Code. It is enabled in `.claude/settings.local.json` (git-ignored, so only on this machine).
- Skills: `/restart`, `/version-up` (manual invocation only), `/data-audit` (read-only data checks: `node .claude/skills/data-audit/audit.js`; the user's categorization habits are in the git-ignored `.claude/skills/data-audit/HABITS.local.md`)
- The GitHub repo is **public**: no personal data in tracked files (names, IBANs, card numbers, real transaction texts) — use made-up examples; personal notes go to `*.local.md` (git-ignored)
- Hook note: the version bump runs only when the Bash command starts with `git commit` (not `cd … && git commit`)
- Agents: `backend-node-expert`, `frontend-ui-developer`, `api-docs-researcher`

## Notes

- **Roadmap:** functional overview (data flow) and next ideas (budgets, month-end forecast, balance history, merchants, people ledger) are in `docs/ROADMAP.md`.
- **Demo data:** `npm run seed-demo` creates ~14 months of transactions with category groups (for the year-over-year report and screenshots).

- **Raw API responses:** when „Дебъг“ is on, read them from `data/api-responses/` instead of calling the bank again.
- **Logging:** all levels (including DEBUG and every SQL query) go to `data/app.log`; it gets large, so read it with `tail`/`grep`
- **Currency:** all amounts stored in EUR; BGN converted at the fixed rate 1.95583 in providers; other currencies keep the original in `original_amount/original_currency`
- **Backups:** `POST /api/backup` writes to `data/backups/`
