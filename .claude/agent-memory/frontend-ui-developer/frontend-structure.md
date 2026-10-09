---
name: frontend-structure
description: How frontend/js is split into classic scripts, load order, data-action delegation and reusable CSS classes (after 2026-10 refactor)
metadata:
  type: project
---

Frontend JS is split into classic `<script>` files sharing one global scope (no modules, no build).
Load order in index.html: api-client, utils, modal, transaction-details, charts, dashboard,
transactions, import, categories, reports, settings, sync, app (app.js last, holds DOMContentLoaded init).

**Why:** app.js was ~2.9k lines; split in batch 3 of the cleanup (2026-10). Duplicate top-level
`const`/`let` names across files throw at load — check with a grep before adding globals.

**How to apply:**
- Clickable generated HTML: add `data-action="x"` + data-* and a handler in `ACTION_HANDLERS` (app.js).
  No inline `onclick`, no `window.foo = foo`. Pagination uses a local delegated listener (data-page-index)
  — never use `data-page` for anything but nav (routing reads it).
- Report click state lives in `reportState` (reports.js), not on window.
- Reusable CSS (main.css): `.num` (right-aligned cells; `.table .num` beats `.table td`), `.table-totals`,
  `.link-dotted`, `.link-dotted-inherit`, `.clickable`, `.btn-sm`/`.btn-xs`, `.detail-table`/`.detail-label`,
  `.page-nav`/`.page-btn`, `.bank-option*`, `.check-label`, `.filter-row*`.
- Helpers in utils.js: `categoryTypeLabel`, `categoryOptionsHtml`, `populateReportPeriod`.
- Git Bash `sed -i` silently converts CRLF files to LF — re-convert app.js/transactions.js/dashboard.js/api-client.js
  to CRLF after using it, verify with `git ls-files --eol frontend`.
