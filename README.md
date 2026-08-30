# Ledger — setup

A single-page PWA (plain HTML/JS, no build step) backed by a Supabase Postgres
database. Same app, same data, on your Linux browser and installed on
Android.

## 1. Create the database (Supabase)

1. Go to supabase.com, create a free account and a new project.
2. In the project, open **SQL Editor > New query**, paste the contents of
   `schema.sql`, and run it. This creates the `categories` and `transactions`
   tables with row-level security so each account only ever sees its own
   rows.
3. Go to **Authentication > Users > Add user** and create the one account
   you'll log in with (email + password). There's no public sign-up screen
   in this app on purpose — you don't want random accounts on your finance
   data.
4. Go to **Project Settings > API** and copy:
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
`sw.js`, two icon files) — any static host works. Pick one:

- **Cloudflare Pages** or **Netlify**: drag-and-drop the folder in their
  dashboard, or connect a GitHub repo for auto-deploys. Free, HTTPS by
  default (PWAs require HTTPS).
- **GitHub Pages**: push this folder to a repo, enable Pages on it. Same
  result, one extra step (enabling Pages in repo settings).

## 4. Install on Android

Open the hosted URL in Chrome on your phone → menu → **Add to Home
screen** (or Chrome will offer an install banner automatically). It'll open
full-screen like a native app and share the same Supabase database as your
Linux browser.

## Accounts and starting balance

Every transaction belongs to an account (Checking, Cash, Savings...). Each
account has a **starting balance** — enter whatever it actually holds today
when you create it, and the app tracks the change from that point forward
using only the transactions you log. The balance shown at the top of the app
is the sum across all accounts; each account's own balance is on the
Accounts tab.

Deleting an account deletes every transaction logged against it — there's a
confirmation before that happens.

First-time login seeds a set of common income/expense categories
automatically. You'll still need to add at least one account yourself
before you can log a transaction, since the app has no way to guess your
account names or real balances.

## CSV format

```
date,kind,account,category,amount,description
2026-08-01,income,Checking,Salary,3200.00,August pay
2026-08-03,expense,Cash,Groceries,64.20,Weekly shop
```

- `date`: `YYYY-MM-DD`
- `kind`: `expense` or `income`
- `account`: created automatically (with a $0 starting balance) if it
  doesn't exist yet — fix the starting balance on the Accounts tab
  afterwards if the import created a brand new account
- `category`: created automatically if it doesn't exist yet
- `amount`: positive number
- `description`: optional

Export produces a file in this exact format, so export → edit → import
round-trips cleanly.

## Known limitation: transfers between your own accounts

Moving money from Checking to Savings isn't a distinct transaction type
yet — logging it as an expense in one account and income in the other will
correctly update both balances, but will also inflate your income/expense
totals in reports for that period. Fine to ignore if you rarely move money
between accounts; say if it's worth adding a proper transfer type instead.

## Notes on "simplest possible"

- No framework, no bundler, no npm install — Supabase's JS client and
  PapaParse are loaded straight from a CDN in `index.html`.
- No custom backend code — Supabase's auto-generated REST API is called
  directly from the browser.
- Balances and category reports are plain aggregations done in the browser
  after fetching the relevant rows; nothing server-side to maintain.
- Single-user by design (one Supabase account, RLS scoped to that
  account's `user_id`). If you ever want a second person to have their own
  separate ledger in the same project, just create them a second
  Supabase user — RLS already isolates rows per user.
