# Ledger — setup

A single-page PWA (plain HTML/JS, no build step) backed by a Supabase Postgres
database. Same app, same data, on your Linux browser and installed on
Android. Amounts are shown in euros (€).

## 1. Create the database (Supabase)

1. Go to supabase.com, create a free account and a new project.
2. In the project, open **SQL Editor > New query**, paste the contents of
   `schema.sql`, and run it. This creates the `accounts`, `categories`, and
   `transactions` tables with row-level security so your account only ever
   sees its own rows.
3. Go to **Authentication > Providers > Email** and disable *"Allow new
   users to sign up"* once you've created your one login (next step) — this
   stops anyone who inspects your public repo's code from being able to
   create their own account on your project via the API.
4. Go to **Authentication > Users > Add user** and create the one account
   you'll log in with (email + password). There's no public sign-up screen
   in this app on purpose.
5. Go to **Project Settings > API** (or click **Connect** at the top of the
   project dashboard) and copy:
   - Project URL
   - `anon` `public` key

## 2. Configure the app

Open `app.js` and fill in the two constants at the top:

```js
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
```

The anon key is meant to be public/client-side — row-level security (set up
by `schema.sql`) is what actually protects your data, not secrecy of this
key.

## 3. Host it

This is a static site (`index.html`, `style.css`, `app.js`, `manifest.json`,
`sw.js`, two icon files) — any static host works, including GitHub Pages
with a public repo. Push this folder to a repo and enable Pages on it, or
use Cloudflare Pages / Netlify if you'd rather drag-and-drop.

## 4. Install on Android

Open the hosted URL in Chrome on your phone → menu → **Add to Home
screen**. It'll open full-screen like a native app and share the same
Supabase database as your Linux browser.

---

## Already running v1? Updating without losing data

`schema.sql` now has a **MIGRATION v2** section near the bottom (clearly
marked). It only *adds* a column and loosens a constraint — it never
touches, renames, or deletes existing rows. Steps:

1. In Supabase, **SQL Editor > New query**, paste and run just the
   `MIGRATION v2` section (not the whole file — the `create table`
   statements above it use `if not exists` so re-running them is harmless,
   but there's no need).
2. Replace `index.html`, `app.js`, `style.css` on your host with the new
   versions. `schema.sql` isn't deployed anywhere, it's just for you to run
   in Supabase, so it doesn't need "hosting."
3. Your existing accounts, categories, and transactions are untouched —
   nothing to re-enter.

## Accounts, starting balance, and transfers

Every transaction belongs to an account. Each account has a **starting
balance** — whatever it actually holds today when you create it — and the
app tracks the change from that point forward using only the transactions
you log. The top balance is the sum across all accounts; each account's own
balance and a Rename button are on the Accounts tab. Deleting an account
deletes every transaction logged against it (confirmation required).

**Transfers**: pick "Transfer" instead of Expense/Income, choose a
*from* and *to* account, no category needed. This moves money between your
own accounts without counting as income or expense — it changes both
account balances but is excluded from the Reports totals and charts, since
it isn't real income or spending.

First-time login seeds a set of common categories automatically. You still
need to add at least one account yourself, since the app can't guess your
account names or real balances.

## Backup and restore

The Backup tab exports/imports three separate CSVs — accounts, categories,
transactions — which together are a complete backup.

```
# accounts.csv
name,starting_balance
Checking,1250.00

# categories.csv
name,kind
Groceries,expense

# transactions.csv
id,date,kind,account,to_account,category,amount,description
b3f1...,2026-08-01,income,Checking,,Salary,3200.00,August pay
,2026-08-03,transfer,Checking,Savings,,200.00,Monthly saving
```

The `id` column is what makes transactions safe to re-import: a row whose
`id` matches an existing transaction **updates** it instead of creating a
duplicate. Leave `id` blank for genuinely new rows (e.g. ones you typed
into the spreadsheet by hand) — those insert as new. This is also why
you should always use **Export**, edit that same file, then **Import** it
back, rather than starting from an old export — old rows carry their real
IDs, which is what prevents duplicates.

For transfer rows, fill `to_account` and leave `category` blank; for
expense/income rows it's the other way around.

Recommended restore order: Accounts, then Categories, then Transactions —
transactions reference accounts/categories by name and will auto-create
anything missing, but restoring the parent data first means starting
balances land correctly instead of defaulting to €0.

## Recovering from the duplicate-import mess

This fixes the specific situation from testing: an account got deleted,
re-importing its old CSV (from before this app tracked accounts) created a
new "Main" account each time with no `account` column to guide it, and a
few retries left several copies of the same 62 rows.

1. **Run the migration + cleanup SQL.** The `MIGRATION v2` section of
   `schema.sql` ends with a de-duplication query — it deletes exact-duplicate
   transactions (same account, date, kind, category, amount, description),
   keeping one copy of each. Run it in the SQL Editor. Safe to run more than
   once; it's a no-op once there are no duplicates left.
2. **Fix the "Main" account.** After dedup, open the Accounts tab, click
   **Rename** on "Main" and give it the real account's name, then click
   **Starting balance** and set it correctly.
3. **If some of the deleted account's real transactions are still
   missing** (rather than just duplicated): open your old CSV export in a
   spreadsheet, add an `account` column, fill every row with that account's
   name (fill-down handles this in one motion), save as CSV, and import it
   via **Backup > Import transactions CSV**. That old file has no `id`
   column, so every row inserts as new — safe now that the duplicate copies
   are already cleared out.

## Notes on "simplest possible"

- No framework, no bundler, no npm install — Supabase's JS client,
  PapaParse, and Chart.js are all loaded straight from a CDN in
  `index.html`.
- No custom backend code — Supabase's auto-generated REST API is called
  directly from the browser.
- Balances and category reports are plain aggregations done in the browser
  after fetching the relevant rows; nothing server-side to maintain.
- Single-user by design (one Supabase account, RLS scoped to that
  account's `user_id`). If you ever want a second person to have their own
  separate ledger in the same project, just create them a second
  Supabase user — RLS already isolates rows per user.
