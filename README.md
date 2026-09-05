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

## Already running v1, v2, or v3? Updating without losing data

`schema.sql` has dated `MIGRATION vN` sections near the bottom (clearly
marked). Each only *adds* a column or loosens a constraint — none of them
touch, rename, or delete existing rows. Steps:

1. In Supabase, **SQL Editor > New query**, paste and run whichever
   `MIGRATION vN` sections you haven't run yet, in order (v2 adds
   transfers, v3 adds cash-vs-investment accounts, v4 adds optional
   freelance reserve percentages). The `create table` statements above them
   use `if not exists`, so re-running the whole file is harmless but
   unnecessary.
2. Replace `index.html`, `app.js`, `style.css` on your host with the new
   versions. `schema.sql` isn't deployed anywhere — it's just for you to
   run in Supabase.
3. Your existing data is untouched. Every existing account defaults to
   `type = 'cash'` after v3 and has `vat_pct`/`tax_pct`/`cotisation_pct`
   left blank after v4, so nothing changes until you explicitly set them.

## Accounts, starting balance, cash vs. investments, and transfers

Every transaction belongs to an account. Each account has a **starting
balance** — whatever it actually holds today when you create it — and the
app tracks the change from that point forward using only the transactions
you log.

Each account is also either **Cash** or **Investment**. The big number at
the top of the app ("Available") is the sum of your *cash* accounts only —
what's actually available to spend. Investment/savings account balances
are summed separately and shown as a smaller line underneath, along with
your combined net worth. The Accounts tab groups accounts under those two
headings with a subtotal each. On the Add screen, the account picker lists
cash accounts first, then investment accounts, as two labeled groups.

Each account row shows its name and balance; click the pencil icon to
rename it, change its starting balance, change cash/investment, or delete
it — this opens one shared edit panel above "Add an account" rather than
cluttering every row with buttons.

**Transfers**: pick "Transfer" instead of Expense/Income, choose a
*from* and *to* account, no category needed. This moves money between your
own accounts (including from a cash account into an investment account)
without counting as income or expense — it changes both account balances
but is excluded from the Reports totals and charts, since it isn't real
income or spending.

First-time login seeds a set of common categories automatically. You still
need to add at least one account yourself, since the app can't guess your
account names or real balances.

## Transactions tab: filter by account

A dropdown above the transaction list lets you view all transactions or
just one account's — grouped Cash / Investments, same as the other account
pickers. Handy for reconciling one account against a real statement to
spot what hasn't been entered yet.

## Projection tab

Projects your cash (not investment) balance forward from today, based on
average monthly income minus expenses over a lookback window you choose
(3/6/12 months). The computed average is editable — override it to test a
scenario (e.g. "what if I cut spending by 200/month"). Shows a line chart
and, if trending down, the month your cash would hit €0. Nothing here is
persisted — it's recalculated fresh every time you open the tab.

Transfers, including money moved into an investment account, are excluded
from the average — so if you regularly move cash into investments, the
projection won't reflect that outflow. Override the assumed monthly
number yourself if you want to account for it.

## Freelance tab

For a professional/client-revenue account. Set VAT / Tax / Cotisation
percentages on an account (Accounts tab → pencil icon → "Freelance
reserves") to enable this screen for it. It shows, cumulatively since the
account's starting balance:

- **Reserved** per category: `(all-time revenue on this account × that
  percentage) − whatever you've already paid out`, where a "payment" is
  any expense on that account categorized as e.g. "VAT payment" (created
  automatically the first time you open this tab).
- **Professional expenses**: everything else spent from the account.
- **Available ("mine")**: current balance minus everything reserved —
  what's genuinely free to spend on the business or draw out.

Paying yourself is just a Transfer from this account to a personal cash
account — no separate mechanism needed. If you ever pay a quarterly VAT
bill, log it as an expense on this account in the "VAT payment" category
(same idea for tax/cotisations) and the reserved amount drops accordingly.

## Backup and restore

The Backup tab exports/imports three separate CSVs — accounts, categories,
transactions — which together are a complete backup.

```
# accounts.csv
name,starting_balance,type
Checking,1250.00,cash
Brokerage,8400.00,investment

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
