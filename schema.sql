-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- If you already ran an earlier version of this file, see the migration note
-- at the bottom instead of running this whole thing again.

create extension if not exists "pgcrypto";

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  starting_balance numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('expense','income')),
  created_at timestamptz not null default now(),
  unique (user_id, name, kind)
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  occurred_on date not null,
  kind text not null check (kind in ('expense','income')),
  amount numeric(12,2) not null check (amount > 0),
  category_id uuid references categories(id) on delete set null,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_date_idx on transactions (user_id, occurred_on desc);
create index if not exists transactions_account_idx on transactions (account_id);

alter table accounts enable row level security;
alter table categories enable row level security;
alter table transactions enable row level security;

-- Each user can only ever see/write their own rows.
create policy "accounts_owner" on accounts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "categories_owner" on categories
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "transactions_owner" on transactions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- MIGRATION: if you already ran the previous version of this file (no
-- accounts table, transactions had no account_id), run this block instead of
-- the CREATE TABLE statements above:
--
--   create table accounts ( ... same as above ... );
--   alter table accounts enable row level security;
--   create policy "accounts_owner" on accounts for all
--     using (auth.uid() = user_id) with check (auth.uid() = user_id);
--   insert into accounts (name, starting_balance) values ('Main', 0);
--   alter table transactions add column account_id uuid references accounts(id) on delete cascade;
--   update transactions set account_id = (select id from accounts where user_id = transactions.user_id limit 1);
--   alter table transactions alter column account_id set not null;
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- MIGRATION v2: run this if you already have data from the first version.
-- Purely additive — does not touch, rename, or delete any existing rows.
-- Adds: transfers between accounts.
-- ===========================================================================

alter table transactions add column if not exists transfer_to_account_id uuid references accounts(id) on delete cascade;

alter table transactions drop constraint if exists transactions_kind_check;
alter table transactions add constraint transactions_kind_check check (kind in ('expense','income','transfer'));

alter table transactions drop constraint if exists transactions_transfer_check;
alter table transactions add constraint transactions_transfer_check check (
  (kind = 'transfer' and transfer_to_account_id is not null and transfer_to_account_id <> account_id)
  or (kind <> 'transfer' and transfer_to_account_id is null)
);

-- If "drop constraint" above errors because your constraint has a different
-- auto-generated name, find the real name first with:
--   select conname from pg_constraint where conrelid = 'transactions'::regclass;
-- then drop that name instead.

-- ---------------------------------------------------------------------------
-- ONE-TIME CLEANUP: de-duplicates transactions that were imported more than
-- once (safe to run any time — keeps exactly one copy of each identical row,
-- deletes the rest). Does nothing if you have no duplicates.
-- ---------------------------------------------------------------------------
delete from transactions t
using transactions t2
where t.id > t2.id
  and t.account_id = t2.account_id
  and t.occurred_on = t2.occurred_on
  and t.kind = t2.kind
  and coalesce(t.category_id::text,'') = coalesce(t2.category_id::text,'')
  and t.amount = t2.amount
  and coalesce(t.description,'') = coalesce(t2.description,'');

-- ===========================================================================
-- MIGRATION v3: run this if you already have data from v1/v2.
-- Purely additive. Adds: cash vs. investment account classification.
-- Every existing account defaults to 'cash', so your main balance is
-- unchanged until you mark an account as 'investment'.
-- ===========================================================================

alter table accounts add column if not exists type text not null default 'cash' check (type in ('cash','investment'));
