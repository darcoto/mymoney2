# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MyMoney2 is a personal finance management application with GoCardless Bank Account Data API integration. It syncs bank accounts/transactions automatically, categorizes transactions via pattern-matching rules, and provides dashboards with financial analytics.

**Language:** Bulgarian (UI and documentation)

## Commands

```bash
npm install          # Install dependencies
npm start            # Start production server (http://localhost:3000)
npm run dev          # Start with auto-reload (nodemon)
npm run demo         # Start with demo database
npm run seed-demo    # Create/reset demo database with sample data
```

**Database inspection:**
```bash
sqlite3 data/finance.db   # Production database
sqlite3 data/demo.db      # Demo database
```

## Tech Stack

- **Backend:** Node.js/Express, SQLite3, GoCardless API
- **Frontend:** Vanilla HTML/CSS/JavaScript, Chart.js (no frameworks)
- **Database:** SQLite at `./data/finance.db` (auto-created on first run)

## Architecture

### Backend (`backend/`)

| File | Purpose |
|------|---------|
| `server.js` | Express app with REST API endpoints |
| `database.js` | SQLite operations, schema, promise wrappers (`runQuery`, `getQuery`, `allQuery`) |
| `gocardless-api.js` | GoCardless API client with automatic token refresh |
| `categorization.js` | Transaction auto-categorization engine |
| `config.js` | Configuration loader |
| `logger.js` | File-based logging with rotation (`data/logs/app.log`) |
| `seed-demo.js` | Demo database seeder (run via `npm run seed-demo`) |

### Frontend (`frontend/`)

- **SPA architecture:** Single `index.html` with page routing via `data-page` attributes
- **Module-based:** `app.js` (main), `api-client.js` (API wrapper), `dashboard.js`, `transactions.js`, `charts.js`
- **API client:** Singleton `APIClient` class with methods for all endpoints

### Database Schema (5 tables)

- `accounts` - Bank accounts with IBAN, balance, institution
- `transactions` - Individual transactions with dates, amounts, descriptions
- `categories` - Categories with colors, icons, types (income/expense/transfer)
- `categorization_rules` - Pattern-matching rules with priority
- `gocardless_tokens` - OAuth token storage

## Key Implementation Patterns

**Database operations:**
- All queries are parameterized (SQL injection protection)
- SQLite callbacks wrapped in promises via helper functions
- Upsert pattern for accounts/transactions (create if new, skip if exists by ID)

**GoCardless integration:**
- Automatic token refresh 5 minutes before expiration
- Debug logging controlled by `NODE_ENV=development`
- Account sync requires "LN" (Linked) status from requisitions

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
- `GOCARDLESS_SECRET_ID` / `GOCARDLESS_SECRET_KEY` - API credentials
- `PORT` - Server port (default 3000)
- `DATABASE_PATH` - SQLite location (default `./data/finance.db`)
- `NODE_ENV` - Set to `development` for debug logging
- `USE_DEMO_DB` - Set to `true` to use demo database (`./data/demo.db`)

## API Endpoints

Key endpoint groups (all prefixed with `/api/`):
- **Accounts:** `GET /accounts`, `PUT /accounts/:id/name`
- **Transactions:** `GET /transactions`, `POST /transactions`, `PUT /transactions/:id/category`, `PUT /transactions/:id/notes`
- **Categories:** CRUD at `/categories`, `/categorization-rules`
- **GoCardless:** `/gocardless/institutions`, `/gocardless/requisitions`, `/gocardless/requisition`
- **Sync:** `POST /sync/accounts`, `POST /sync/transactions`
- **Reports:** `/reports/monthly`, `/reports/category-breakdown`, `/reports/last-12-months`, `/reports/counterparty`

## Notes

- **No test suite:** Tests are not configured (`npm test` exits with error)
- **Logging:** Debug logs written to `data/logs/app.log` when `NODE_ENV=development`
- **Currency:** All amounts converted to EUR; BGN converted at fixed rate in `gocardless-api.js`
