# API Documentation Research Memory

## EnableBanking API (Researched 2026-02-08)

**Base URL:** `https://api.enablebanking.com`

**Authentication:** JWT signed with the RSA private key — the project uses PS256 (see enablebanking-provider.js); NOT OAuth like GoCardless
- Requires RSA private key from registration
- JWT must include `kid` header with app_id
- Max token TTL: 86400 seconds

**Key Differences from GoCardless:**
- Auth: JWT vs OAuth refresh tokens
- Flow: POST /auth → POST /sessions vs POST /requisitions
- Session concept: Explicit sessions vs requisitions
- Pagination: continuation_key vs date ranges only
- Supports payment initiation (PIS) unlike GoCardless

**Bulgarian Bank Support:** Use country code "BG" in GET /aspsps

**Core Endpoints:**
- GET /aspsps?country={code} - List banks
- POST /auth - Start authorization, returns redirect URL
- POST /sessions - Exchange auth code for session
- GET /accounts/{id}/transactions - Fetch transactions

**Transaction Format:**
- Date fields: booking_date, transaction_date, value_date
- Amount: transaction_amount.amount (negative for debits)
- Description: remittance_information array
- Counterparty: creditor/debtor objects with IBAN

**Integration Pattern:**
1. Generate JWT per request (or cache until near expiry)
2. List banks by country
3. POST /auth → redirect user
4. Receive callback with code parameter
5. POST /sessions with code → get session_id and accounts
6. Use account UIDs to fetch transactions
7. Handle pagination with continuation_key

**Common Gotchas:**
- JWT requires exact header structure with kid
- Sessions expire separately from bank consent
- Accounts returned in session creation response (no separate endpoint)
- Transaction amounts are strings, not numbers
- Negative amounts indicate debits/outgoing

See full research report in plan files for complete endpoint documentation.
