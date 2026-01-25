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
```

**Database inspection:**
```bash
sqlite3 data/finance.db
```

## Tech Stack

- **Backend:** Node.js/Express, SQLite3, GoCardless API
- **Frontend:** Vanilla HTML/CSS/JavaScript, Chart.js (no frameworks)
- **Database:** SQLite at `./data/finance.db` (auto-created on first run)

## Architecture

### Backend (`backend/`)

| File | Purpose |
|------|---------|
| `server.js` | Express app with 27 REST API endpoints |
| `database.js` | SQLite operations, schema, promise wrappers (`runQuery`, `getQuery`, `allQuery`) |
| `gocardless-api.js` | GoCardless API client with automatic token refresh |
| `categorization.js` | Transaction auto-categorization engine |
| `config.js` | Configuration loader |

### Frontend (`frontend/`)

- **SPA architecture:** Single `index.html` with page routing via `data-page` attributes
- **Module-based:** Separate JS files for dashboard, transactions, charts
- **API client:** Centralized fetch wrapper class in `api-client.js`

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
- Currency formatting in Bulgarian (лв)
- All API calls through singleton `APIClient` class
- Page navigation via `data-page` attributes

## Environment Variables

Required in `.env` (see `.env.example`):
- `GOCARDLESS_SECRET_ID` / `GOCARDLESS_SECRET_KEY` - API credentials
- `PORT` - Server port (default 3000)
- `DATABASE_PATH` - SQLite location (default `./data/finance.db`)
- `NODE_ENV` - Set to `development` for debug logging
