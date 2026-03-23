# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MyMoney2 is a personal finance management application with multi-provider bank data integration (GoCardless, Enable Banking). It syncs bank accounts/transactions automatically, categorizes transactions via pattern-matching rules, and provides dashboards with financial analytics.

**Language:** Bulgarian (UI and documentation)

## Commands

```bash
npm install          # Install dependencies
npm start            # Start production server (http://localhost:3456)
npm run dev          # Start with auto-reload (nodemon)
npm run demo         # Start with demo database (data/demo.db)
npm run seed-demo    # Create/reset demo database with sample data
```

**Switch database:** Set `DATABASE_NAME=demo.db` in `.env` (requires restart).

**Database inspection:**
```bash
sqlite3 data/finance.db   # Production database
sqlite3 data/demo.db      # Demo database
```

## Tech Stack

- **Backend:** Node.js/Express, SQLite3, GoCardless API, Enable Banking API, jsonwebtoken
- **Frontend:** Vanilla HTML/CSS/JavaScript, Chart.js (no frameworks)
- **Database:** SQLite at `./data/finance.db` (auto-created on first run)

## Architecture

### Backend (`backend/`)

| File | Purpose |
|------|---------|
| `server.js` | Express app entry point; mounts all route modules |
| `database.js` | SQLite operations, schema, promise wrappers (`runQuery`, `getQuery`, `allQuery`) |
| `transaction-processor.js` | Shared pipeline: enrich (country + category) + upsert transactions; used by providers and import routes |
| `categorization.js` | Transaction auto-categorization engine |
| `xml-import.js` | DSK Bank XML file parser |
| `revolut-import.js` | Revolut CSV file parser with approximate currency-to-EUR rates |
| `country-codes.js` | ISO 3166-1 alpha-3 codes with flag emojis; extracts country from counterparty names |
| `config.js` | Configuration loader |
| `logger.js` | File-based logging with rotation (`data/logs/app.log`) |
| `seed-demo.js` | Demo database seeder (run via `npm run seed-demo`) |
| `gocardless-api.js` | **Deprecated** thin wrapper delegating to GoCardlessProvider |

Routes are modularized in `backend/routes/`: `providers.js`, `sync.js`, `accounts.js`, `transactions.js`, `categories.js`, `reports.js`, `helpers.js`.

### Provider System (`backend/providers/`)

| File | Purpose |
|------|---------|
| `base-provider.js` | Abstract base class defining provider interface |
| `provider-registry.js` | Registry/factory for provider instantiation |
| `gocardless-provider.js` | GoCardless Bank Account Data API integration |
| `enablebanking-provider.js` | Enable Banking API integration (JWT/RSA auth) |

### Frontend (`frontend/`)

- **SPA architecture:** Single `index.html` with page routing via `data-page` attributes
- **Module-based:** `app.js` (main), `api-client.js` (API wrapper), `dashboard.js`, `transactions.js`, `charts.js`
- **API client:** Singleton `APIClient` class with methods for all endpoints

### Database Schema (7 tables)

- `accounts` - Bank accounts with IBAN, balance, institution, provider_id
- `transactions` - Individual transactions with dates, amounts, descriptions
- `categories` - Categories with colors, icons, types (income/expense/transfer)
- `categorization_rules` - Pattern-matching rules with priority
- `providers` - Bank data providers (GoCardless, Enable Banking) with credentials
- `provider_sessions` - Provider auth tokens/sessions (replaces gocardless_tokens)
- `gocardless_tokens` - **Legacy**, kept for migration only

## Key Implementation Patterns

**Provider abstraction:**
- `BaseProvider` defines the interface: `getInstitutions()`, `createAuthorization()`, `syncAllAccounts()`, etc.
- Each provider class extends BaseProvider and implements the interface
- `provider-registry.js` maps type → class and provides factory methods
- Credentials stored in `providers` table (JSON), managed via UI
- Sessions/tokens stored in `provider_sessions` table

**Database operations:**
- All queries are parameterized (SQL injection protection)
- SQLite callbacks wrapped in promises via helper functions
- Upsert pattern for accounts/transactions (create if new, skip if exists by ID)

**GoCardless integration:**
- Automatic token refresh 5 minutes before expiration
- Debug logging controlled by `NODE_ENV=development`
- Account sync requires "LN" (Linked) status from requisitions

**Enable Banking integration:**
- JWT signed with RSA private key (PS256 algorithm) for each request
- Flow: JWT → GET /aspsps → POST /auth → user authorizes → POST /sessions → GET /accounts/transactions

**Auto-categorization:**
- Patterns are case-insensitive
- Multiple patterns separated by `|` (OR logic)
- Applied in priority order (highest first)
- Matches against transaction description and counterparty

**Frontend:**
- Currency formatting in Bulgarian (euro)
- All API calls through singleton `APIClient` class
- Page navigation via `data-page` attributes

## Environment Variables

Required in `.env` (see `.env.example`):
- `PORT` - Server port (default 3456)
- `DATABASE_NAME` - SQLite filename in `./data/` (default `finance.db`). For demo: `demo.db`. **Requires restart.**
- `NODE_ENV` - Set to `development` for debug logging
- `GOCARDLESS_SECRET_ID` / `GOCARDLESS_SECRET_KEY` - **Optional**, for initial migration only. Credentials are now managed via UI.

## API Endpoints

Key endpoint groups (all prefixed with `/api/`):
- **Providers:** `GET /providers`, `GET /providers/:id`, `PUT /providers/:id/credentials`, `DELETE /providers/:id/credentials`, `GET /providers/:id/credential-fields`, `GET /providers/:id/status`
- **Provider Banking:** `GET /providers/:id/institutions`, `POST /providers/:id/authorizations`, `GET /providers/:id/authorizations`, `DELETE /providers/:id/authorizations/:authId`
- **Accounts:** `GET /accounts`, `PUT /accounts/:id/name`
- **Transactions:** `GET /transactions` (filters: account_id, start_date, end_date, category_id, type, search, country, limit, offset), `GET /transactions/stats`, `POST /transactions` (manual), `POST /transactions/import-file` (auto-detects DSK XML or Revolut CSV), `POST /transactions/categorize-by-counterparty`, `PUT /transactions/:id/category`, `PUT /transactions/:id/notes`, `PUT /transactions/:id/country`
- **Categories:** CRUD at `/categories`, `/categorization-rules`
- **GoCardless (legacy):** `/gocardless/institutions`, `/gocardless/requisitions` (backward compat)
- **Sync:** `POST /sync/accounts`, `POST /sync/transactions` (iterates all configured providers)
- **Reports:** `/reports/monthly`, `/reports/category-breakdown`, `/reports/last-12-months`, `/reports/counterparty`

## Notes

- **No test suite:** Tests are not configured (`npm test` exits with error)
- **Logging:** Debug logs written to `data/logs/app.log` when `NODE_ENV=development`
- **Currency:** All amounts converted to EUR; BGN converted at fixed rate in provider implementations
