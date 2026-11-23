# Financial Monitoring: AR · ESCO dashboard

Executive accounts-receivable (AR) aging dashboard built with Next.js, TypeScript and Tailwind CSS. It pulls live data from the **PEAK Account Open API** and recreates the Power BI "AR-ESCO" page.

## Run

```bash
pnpm install                 # also generates the Prisma client
pnpm dev                     # applies database migrations, then http://127.0.0.1:3000
pnpm dev:sample              # UI work: made-up data, no database, no PEAK / NetSuite calls
```

`pnpm-workspace.yaml` allows the install scripts of `prisma`, `@prisma/engines` and `better-sqlite3` (a dependency of the Prisma CLI); pnpm blocks them otherwise (`ERR_PNPM_IGNORED_BUILDS`).

Then open **Settings** (top right) to connect PEAK. The first visit starts a setup guide adapted from `../peak_account`:

1. **Get started:** a checklist of the PEAK emails you need.
2. **Developer credentials:** the Connect ID and Connect Key, for UAT or Production. They're checked by requesting a Client Token.
3. **Connect a company:** a User Token, with instructions to send to the company's PEAK owner. It's checked with `GET /api/v1/User/detail`.
4. **Done:** each company becomes a tab on the dashboard.

Later, **Settings → Companies** lets you add, test, edit or remove companies, and **Settings → Developer credentials** lets you test or replace the shared Connect ID / Key.

### How credentials are stored

- **Shared developer credentials:** one Connect ID / Connect Key pair for the application, used by every company by default.
- **Per company:** its own **User Token**, plus optional **own developer credentials**, for a company with a separate PEAK API agreement or environment.
- **Where:** saved on the server in the database (`AppSetting` row `settings`, with Row Level Security on so Supabase's public API can't read it). Older installs kept them in `.peak/settings.json`; that file is still read until the first save, which moves them to the database. Storing them in the database is what lets Settings work on Netlify, whose disk is read-only. The browser only ever receives masked values (`1eeb••••9f7b`). Secrets PEAK echoes back in error messages are redacted.
- **Saving:** runs a connection test first. If the test fails, the form offers **Save anyway**, for example when UAT is closed.
- **Before the first save:** the values in `.env.local` (`PEAK_ENV`, `PEAK_CONNECT_ID`, `PEAK_CONNECT_KEY`, `PEAK_USER_TOKEN`, `PEAK_ENTITY_NAME`, `PEAK_ENTITIES`) are used. After that, the saved settings in the database take over.
- **Access:** the app has no login, so `npm run dev` / `npm start` bind to `127.0.0.1`, and the settings API refuses cross-site requests. Add authentication before hosting it anywhere shared.

### NetSuite

**Settings → NetSuite** has a setup guide for SCG's NetSuite integration RESTlet (documented in `netsuite_api_docs/`):

1. **Get started:** a checklist, plus steps to send the NetSuite admin for creating an integration record and an access token.
2. **Account:** a connection name, and the environment (Production / Sandbox 1 / Sandbox 2 / Other) with the account number. This gives the OAuth realm (`1234567_SB2`) and the RESTlet host. A live DNS check shows whether that host exists.
3. **Access keys:** Consumer Key / Secret and Token ID / Secret, for OAuth 1.0 Token-Based Authentication with HMAC-SHA256 (`lib/netsuite/client.ts`).
4. **Done.**

**Test** sends two signed, read-only GETs, and only when you click it: `service_type=subsidiary`, and `invoicefromso_lhs` for internal ID 0 (matches nothing) to confirm the dashboard's endpoint is allowed.

**On the dashboard** each NetSuite connection is a tab marked **NS**. Its data (`lib/netsuite/ar-source.ts`) comes from endpoint **#46 `invoicefromso_lhs`** on `customscript_int_api_2`. That's the only documented AR endpoint with a due date, status and remaining amount; the standard #07 invoice query has none of them.

| Dashboard field | NetSuite field |
|---|---|
| Document | `inv_doc_number` |
| Customer | `inv_customer_ns_internal_id` / `inv_customer_name` |
| Issued / due date | `inv_date` / `inv_due_date` (DD/MM/YYYY) |
| Amount due | `inv_amount_remaining_total` × `inv_exchange_rate`. If it's missing: total − applied deposits/payments |
| Net amount | `inv_amount_total` (`inv_inv_amount_total` in the doc's field table) |
| Project | `inv_project_code` (projects are the ones seen on open invoices; #46 has no project list) |
| Ref. | `inv_createfrom_so_no` |

#46 has no status or date filter, so every invoice is read (1,000 per page, 4 pages at a time, 3 minutes allowed per page, and "busy" answers are retried). Rows that are Paid In Full, voided, rejected or cancelled, or have nothing remaining, are dropped. Each chart's Debug button shows the NetSuite calls and field names.

Because a full read is slow, later pulls **only fetch what changed (update)**: the last page plus any new pages after it, and each invoice that was open last time, re-checked by `query[inv_ns_internal_id]`. Paid invoices aren't re-read. It falls back to a full read when the last page's invoices moved (page order not stable), NetSuite reports fewer pages or invoices than before, more than 400 open invoices would need re-checking, or the ID lookup returns other invoices. A full read also runs once a day to catch an old invoice that was reopened. The Debug panel shows which kind of read ran and why. Pulls are stored in the database (see **Database and sync service** below).

The real fix is on the NetSuite side: a status (open only) or date filter on #46.

The doc lists #46 under LHS, so for other business units, confirm with the NetSuite team that it returns their invoices.

`netsuite_api_docs/` contains live sandbox keys, so keep it out of git and don't share it.

PEAK UAT is only open Mon–Fri 08:00–22:00 Bangkok time.

**Sample mode, for UI work:** `pnpm dev:sample` runs the app with made-up data and no outside connections (`lib/mode.ts`). It needs no `DATABASE_URL` or PEAK keys.
- **Data:** AR and P&L come from `lib/sample.ts` / `lib/sample-pnl.ts`, for six sample PEAK companies and one sample NetSuite connection.
- **Settings:** pre-filled from `lib/sample-settings.ts` and kept in memory. Changes work but reset when the server restarts.
- **Calls:** connection tests pass without calling PEAK or NetSuite. Pulls do nothing, and the sync history is made up (`lib/sample-runs.ts`).
- **Database:** never opened. Any code that tries to use `db` throws "Sample mode has no database", so a new feature that needs sample handling shows up at once.
- **Production:** sample mode is ignored in production builds (`next build` / `next start`, Netlify), even with `PEAK_USE_SAMPLE=1` set, so production always uses Supabase and the real APIs.

## Database and sync service

The dashboard never calls PEAK or NetSuite itself. A sync service pulls the data into the database, and `/api/ar` only reads the database.

```
PEAK / NetSuite ──(sync service: lib/sync/ar-sync.ts)──> Postgres (Supabase) ──(/api/ar)──> dashboard
                  ▲ opening a tab with no data, or data older than Settings allows
                  ▲ ↻ Refresh on the dashboard, Pull all now in Settings
                  ▲ every 15 min (lib/sync/scheduler.ts; long-running servers only, not Netlify)
                  ▲ POST /api/sync
```

- **Who runs a pull** (`components/pull.ts`, `lib/sync/pull.ts`): the page asks for it and follows its progress. On **Netlify** it goes to the background function `netlify/pull-background.ts` (served at `/.netlify/functions/pull-background`), which can run 15 minutes, so a full NetSuite read (about 4–5 min) finishes; normal requests stop at 30 seconds. Anywhere else (`pnpm dev`, `next start`) it goes to `POST /api/pull`, which runs it in the app after answering. The request names only the tab and kind; the function reads the PEAK / NetSuite keys from the saved settings in the database itself, so they never pass through the browser. The browser calls the function directly (not the app's server) so the site's team login protects it like every other page.
- **Building the function:** `pnpm build` runs `next build`, then `scripts/build-functions.mjs` bundles `netlify/pull-background.ts` and the `lib/` code it uses into `netlify/functions/pull-background.mjs` (git-ignored), which Netlify deploys. `NEXT_PUBLIC_PULL_VIA` (set in `next.config.ts` from Netlify's `NETLIFY=true` build variable) tells the page which way to send pulls.
- **When a dashboard opens: Settings → Data sync.** A tab whose last pull (good or failed) is older than "Pull a company whose data is older than" (default 30 min; Never = only Refresh) is pulled in the background while the saved data shows, at most once per tab per visit. A tab with nothing saved is always pulled; the page shows the loading card until it's done.

- **Database:** Prisma 7 + Postgres on Supabase, project `testProject` (`prisma/schema.prisma`, client in `lib/db.ts` via `@prisma/adapter-pg`). Set `DATABASE_URL` in `.env.local` to the project's Session pooler connection string (see `.env.example`). Tables have Row Level Security on with no policies, so Supabase's public REST API can't read them; the server connects as `postgres` and isn't affected. `npm run dev` / `npm start` apply migrations first (`prisma migrate deploy`); `npm install` generates the client. `npm run db:studio` opens a table browser.
- **Tables:** `PnlMonth` (one month of profit & loss per PEAK company), `ArSnapshot` (one per tab: business name, source, as-of date, projects, warnings, Debug info), `ArInvoice` (its outstanding invoices), `SyncRun` (every pull: trigger, status, full/update, error), `SyncState` (NetSuite's update state).
- **A pull replaces the tab's snapshot in one transaction**, so the page never sees half a pull.
- **One pull per tab at a time, across server instances** (`lib/sync/runs.ts`): starting a pull takes a Postgres advisory lock, checks `SyncRun` for a running pull of the same tab and kind, and records a new one in the same transaction. A second request skips (or, for the scheduler, waits). A running pull saves its progress and a heartbeat on its row; one that stops reporting for 5 minutes (e.g. Netlify ended the function) is marked failed so it can't block later pulls.
- **Credentials:** each snapshot records a hash of the keys it was read with. After keys change in Settings, the old data isn't shown; the next visit pulls again. Removing a tab in Settings deletes its rows.
- **Failures keep the last good data.** The dashboard shows it with "Last update failed (time): <plain explanation>" and Try again.
- **Schedule: Settings → Data sync.** Turn scheduled pulls on/off and pick the interval (5 min – 24 h; presets or a custom number of minutes), and whether to skip PEAK UAT outside Mon–Fri 08:00–22:00 Bangkok. Saved with the other settings in the database (`sync`); the scheduler re-reads it every 30 seconds, so no restart is needed, and the next round is counted from the save. Until it's saved, `SYNC_INTERVAL_MINUTES` (default 15) applies. 10 seconds after the server starts, tabs whose data is older than the interval are pulled. `SYNC_SCHEDULE=0` or sample mode turn scheduling off on the server regardless (the page says so). The same page shows each tab's last pull, the next round, the recent pulls, and **Pull all now**.
- **↻ Refresh** asks for a pull; the saved data stays on screen (dimmed and locked) with a progress card, and the page reloads when the pull ends.
- **Progress, step by step** (`lib/sync/progress.ts`, `components/SyncProgress.tsx`): every pull reports its steps, which the first-load screen and the Refresh banner show with a bar, the current activity and counts. PEAK: connecting → customer names → outstanding invoices → project groups → amounts due (only if the list left them out) → each invoice's project → saving. NetSuite full read: every page (n of N) → saving; update: newest pages → re-checking last time's open invoices (n of N) → saving. Skipped steps say why; a switch from update to full read is explained above the steps. `/api/ar/progress` and `/api/pnl/progress` read it from the pull's `SyncRun` row, so it shows whichever instance runs the pull.
- **API:** `GET /api/sync` shows each tab (running?) and the last 50 pulls; `POST /api/sync[?entity=<id>]` starts a pull now (`npm run sync` does this for all tabs); `POST /api/pull?kind=ar|pnl|all&entity=<id>[&year=yyyy]` is what the page uses off Netlify. Same-origin only; the server binds to 127.0.0.1.
- **Financial Performance** is stored the same way: see that page's section below. Settings → Data sync lists its pulls as "P&L".

## What it shows

| Section | Logic |
|---|---|
| Total AR | Sum of `remainAmount` on unpaid sales invoices (THB, converted with the document's exchange rate) |
| Current vs. Overdue | Overdue = due date before today (Bangkok) |
| Aging bucket | Days overdue: Current, 1–30, 31–60, 61–90, > 90; counts documents, customers and amount |
| ESCO KPI | ✓ Target = not overdue or ≤ 30 days overdue; ⚠ Over = > 30 days. A customer is "Over" if any of its invoices is |
| Top customers | Top 8 by amount due, split into current and overdue |
| AR by project | Every project with its outstanding amount, current vs. overdue. An invoice split between projects counts in each by its percent; invoices without one are "No project". Projects with no open invoices are listed with 0 |
| Documents | Credit days = due − issued, Duration = today − issued, Overdue = today − due |

Each chart and headline card has a **</> Debug** button. It opens a panel showing:
1. the PEAK API paths that fed it, as actually called (resCode, row count, ms),
2. the PEAK fields it reads and how each is used,
3. the calculation,
4. the exact plotted data as JSON (copyable),
5. the source invoices, with raw PEAK values next to the computed amount, overdue days, bucket and KPI group.

The plotted data follows the active filters. In sample mode no calls are listed.

Debug buttons appear in development (`pnpm dev`, `pnpm dev:sample`) and are hidden in production builds (`next build`, Netlify). To show them in a production build, set `NEXT_PUBLIC_SHOW_DEBUG=1` before building.

Slicers (customer, project, AR group, aging bucket, search) and clicks on the charts and tables filter the whole page. Business-unit tabs switch between PEAK businesses.

## How the PEAK data is pulled

`lib/peak/client.ts` (server only) signs each request (`Time-Stamp` + HMAC-SHA1 `Time-Signature`), caches the 24-hour Client Token, retries on HTTP 429 and caps concurrent calls.

`lib/peak/ar-source.ts`, for each business:
1. `GET /api/v1/Invoices/list?status=3` and `status=4` (waiting for payment / overdue), 100 rows per page.
2. `GET /api/v1/Contacts/list` for customer names.
3. `GET /api/v1/Invoices?code=…` for each outstanding invoice. The list endpoint doesn't return `remainAmount`, even with `includeRemainAmount=1`, and the single get is needed to account for partial payments.
4. `GET /api/v1/User/detail` for the business name.
5. `GET /api/v1/Classification` for the project list. PEAK has no project API, so projects are the classification group whose name or description contains "โครงการ" or "project".
6. If that group exists, `GET /api/v1/Classification/transaction?transactionId=…&transactionType=102` for each outstanding invoice, to read its projects and percent. With no project group, this step is skipped (no extra calls). PEAK supports these two endpoints only on its new platform.

Results are cached in memory for 5 minutes per business. **↻ Refresh** bypasses the cache. The browser only calls `/api/ar`; credentials never leave the server.

### Several companies

Add each PEAK business in **Settings → Companies**. Each one has its own User Token, and optionally its own developer credentials.

## Not yet mapped from the Power BI report

PEAK has no direct field for these, so they need a decision on how to source them:
- **Department** (cost centre): PEAK *Classification* (`Classification/transaction` per document), the same way projects are read. The UAT business has no classification groups yet, so neither shows data there.
- **Provisioned / bad debt** and **AccountGroup** (Trade AR – related vs. non-related parties): these probably come from the chart of accounts or a manual mapping.
- **Credit notes** that aren't yet applied to an invoice don't reduce the AR total.

## Look and feel (ONNEX by SCG CI)

- **Colours:** from the CI deck's "Colors System", defined in `lib/format.ts` (`CI`) and `app/globals.css` (Tailwind tokens `brand`, `aqua`, …).
  - Cobalt Blue `#034EA2` is the primary colour. The deck's HEX `214EA2` doesn't match its own RGB 3, 78, 162 or the swatch, so `#034EA2` is used.
  - Aqua Blue `#03BFD7` is the accent.
  - The CI bar gradient is under the header and in the footer.
  - Aging buckets: Current is cobalt, then a light-to-dark CI red for 1–30 → > 90 days (checked for colour-blind separation). KPI Target uses CI green `#26D07C`, and Over / Overdue use CI red `#D6001C`, always with ✓ / ⚠.
- **Fonts:** English **Lufga**, Thai **Noto Sans Thai** (`app/layout.tsx`).
  - Lufga is a commercial font, so it's used when it's installed on the viewer's machine; otherwise Noto Sans Thai covers English too.
  - To embed Lufga for everyone, add the licensed font files and load them with `next/font/local`.
- **Charts:** Plotly (`plotly.js-basic-dist-min`, loaded only in the browser) through `components/Plot.tsx`. `components/charts.tsx` has the donut (`Donut`), stacked horizontal bars (`HBars`) and vertical bars (`VBars`). Clicking a slice or bar filters the dashboard, as before.

## Financial Performance page (`/financial`)

Monthly profit & loss for one PEAK company, switched to with the **AR Aging / Financial Performance** buttons in the header.

- **Source:** `GET /api/v1/FinancialReports/trialbalance?fromMonth=yyyyMM&toMonth=yyyyMM`, one call per month (PEAK has no P&L endpoint). A month's amount is the account's `change`: income = credit − debit, expenses = debit − credit. Sub-account rows are skipped (already in the parent).
- **Lines** (`lib/pnl.ts` `classifyAccount`): 4xxxxx → Revenue · 51xxxx or name "ต้นทุนขาย/ต้นทุนบริการ" → Cost of Sales · name "ดอกเบี้ยจ่าย/ต้นทุนทางการเงิน" → Finance Cost · name "ภาษีเงินได้นิติบุคคล" → Income Tax · other 5xxxxx → Operating Expenses. Check the mapping under **Accounts used** at the bottom of the page.
- **Stored in the database** (`PnlMonth`, filled by `lib/sync/pnl-sync.ts`); `/api/pnl` only reads it, so the page opens instantly. PEAK allows the trial balance 10 requests a minute, one at a time, so a pull only reads what can have changed:
  - months never read;
  - this month and last month (still being booked or closed), every round;
  - older months once a day.
- **When it pulls:** every scheduled round and **Pull all now** (after the company's AR: this year, plus December in January); **Refresh** on the page (in the background, with a progress bar); opening a year with months never read, or whose current months are older than the "when a dashboard opens" setting (the page shows progress; reading a whole year takes a little over a minute). A failed pull keeps the saved months and says so. Months saved by the old file cache (`.peak/cache/peak-pnl-<company>.json`) are imported on first use.
- NetSuite tabs are disabled here: the SCG RESTlet has no P&L or trial-balance endpoint.
- Sample mode (`pnpm dev:sample`) serves made-up months (`lib/sample-pnl.ts`).
