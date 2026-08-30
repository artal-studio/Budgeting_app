// ---------------------------------------------------------------------------
// 1) FILL THESE IN from your Supabase project: Settings > API
// ---------------------------------------------------------------------------
const SUPABASE_URL = "https://xeyjvkrihvnthghrlolx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wIuWrzo3lstOPkHeq80F5Q_qHumShWL";
// ---------------------------------------------------------------------------

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayStr = () => new Date().toISOString().slice(0, 10);

const DEFAULT_CATEGORIES = {
  income: ["Salary", "Dividends", "Financial Aid", "Gifts Received", "Interest Income", "Other Income", "Refunds/Reimbursements", "Rental Income"],
  expense: [
    "Charity", "Cleaning", "Clothing", "Dining", "Discretionary", "Doctor / Dentist", "Education", "Emergency Fund",
    "Fun / Entertainment", "Furniture / Appliances", "Gifts Given", "Groceries", "Health Insurance", "Home Insurance",
    "Home Supplies", "Interest Expense", "Medicine", "Miscellaneous", "Mortgage / Rent", "Other Savings", "University",
    "Transport", "Travel", "Sport", "Legal", "Personal Supplies", "Subscriptions/Dues", "Taxes", "Util. Electricity",
    "Util. Gas", "Util. Phone(s)", "Util. TV / Internet", "Util. Water",
  ],
};

let categories = []; // {id, name, kind}
let accounts = [];   // {id, name, starting_balance}
let currentKind = "expense";

// ---------------- Auth ----------------

sb.auth.onAuthStateChange((_event, session) => {
  if (session) showApp(); else showAuth();
});

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) showApp(); else showAuth();
}

function showAuth() {
  $("#auth-view").style.display = "block";
  $("#app").style.display = "none";
}

async function showApp() {
  $("#auth-view").style.display = "none";
  $("#app").style.display = "block";
  $("#tx-date").value = todayStr();
  const now = new Date();
  $("#rep-from").value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  $("#rep-to").value = todayStr();

  await loadCategories();
  if (categories.length === 0) await seedDefaultCategories();

  await loadAccounts();
  populateCategorySelect();
  populateAccountSelect();
  renderAccountsPanel();
  await Promise.all([refreshBalances(), loadTransactions()]);
}

$("#auth-submit").addEventListener("click", async () => {
  $("#auth-error").textContent = "";
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) $("#auth-error").textContent = error.message;
});

$("#sign-out").addEventListener("click", () => sb.auth.signOut());

// ---------------- Tabs ----------------

document.querySelectorAll("nav.tabs button").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.view));
});

function switchTab(view) {
  document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
}

document.querySelectorAll("[data-goto]").forEach((el) => {
  el.addEventListener("click", () => switchTab(el.dataset.goto));
});

// ---------------- Categories ----------------

async function loadCategories() {
  const { data, error } = await sb.from("categories").select("id, name, kind").order("name");
  if (error) { console.error(error); return; }
  categories = data || [];
}

async function seedDefaultCategories() {
  const rows = [
    ...DEFAULT_CATEGORIES.income.map((name) => ({ name, kind: "income" })),
    ...DEFAULT_CATEGORIES.expense.map((name) => ({ name, kind: "expense" })),
  ];
  const { data, error } = await sb.from("categories").insert(rows).select();
  if (error) { console.error(error); return; }
  categories = data || [];
}

async function getOrCreateCategory(name, kind) {
  name = name.trim();
  const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.kind === kind);
  if (existing) return existing.id;
  const { data, error } = await sb.from("categories").insert({ name, kind }).select().single();
  if (error) throw error;
  categories.push(data);
  return data.id;
}

function populateCategorySelect() {
  const sel = $("#tx-category");
  sel.innerHTML = "";
  categories.filter((c) => c.kind === currentKind).forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
  const newOpt = document.createElement("option");
  newOpt.value = "__new__";
  newOpt.textContent = "+ Add new category…";
  sel.appendChild(newOpt);
}

$("#tx-category").addEventListener("change", (e) => {
  $("#new-category-field").style.display = e.target.value === "__new__" ? "block" : "none";
});

document.querySelectorAll(".kind-toggle button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".kind-toggle button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentKind = btn.dataset.kind;
    populateCategorySelect();
    $("#new-category-field").style.display = "none";
  });
});

// ---------------- Accounts ----------------

async function loadAccounts() {
  const { data, error } = await sb.from("accounts").select("id, name, starting_balance").order("name");
  if (error) { console.error(error); return; }
  accounts = data || [];
}

async function getOrCreateAccount(name) {
  name = name.trim();
  const existing = accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const { data, error } = await sb.from("accounts").insert({ name, starting_balance: 0 }).select().single();
  if (error) throw error;
  accounts.push(data);
  return data.id;
}

function populateAccountSelect() {
  const sel = $("#tx-account");
  sel.innerHTML = "";
  accounts.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.name;
    sel.appendChild(opt);
  });
  const hasAccounts = accounts.length > 0;
  $("#tx-submit").disabled = !hasAccounts;
  $("#add-needs-account").style.display = hasAccounts ? "none" : "block";
}

$("#acc-add").addEventListener("click", async () => {
  $("#acc-error").textContent = "";
  const name = $("#acc-name").value.trim();
  const starting = parseFloat($("#acc-starting").value || "0");
  if (!name) { $("#acc-error").textContent = "Enter an account name."; return; }
  if (accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
    $("#acc-error").textContent = "An account with that name already exists.";
    return;
  }
  const { data, error } = await sb.from("accounts").insert({ name, starting_balance: starting || 0 }).select().single();
  if (error) { $("#acc-error").textContent = error.message; return; }
  accounts.push(data);
  $("#acc-name").value = "";
  $("#acc-starting").value = "";
  populateAccountSelect();
  renderAccountsPanel();
  await refreshBalances();
});

function renderAccountsPanel() {
  const list = $("#acc-list");
  list.innerHTML = "";
  if (!accounts.length) {
    list.innerHTML = '<p class="empty">No accounts yet — add one below.</p>';
    return;
  }
  for (const a of accounts) {
    const row = document.createElement("div");
    row.className = "acc-row";
    row.innerHTML = `
      <span class="acc-name">${escapeHtml(a.name)}</span>
      <span class="acc-balance num" id="acc-balance-${a.id}">…</span>
      <button class="secondary acc-edit" data-id="${a.id}">Edit starting balance</button>
      <button class="del" data-id="${a.id}" title="Delete account">✕</button>
    `;
    list.appendChild(row);
  }
  list.querySelectorAll(".acc-edit").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const acc = accounts.find((a) => a.id === btn.dataset.id);
      const val = prompt(`Starting balance for "${acc.name}"`, acc.starting_balance);
      if (val === null) return;
      const num = parseFloat(val);
      if (Number.isNaN(num)) return;
      const { error } = await sb.from("accounts").update({ starting_balance: num }).eq("id", acc.id);
      if (error) { alert(error.message); return; }
      acc.starting_balance = num;
      await refreshBalances();
    });
  });
  list.querySelectorAll(".acc-row .del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const acc = accounts.find((a) => a.id === btn.dataset.id);
      if (!confirm(`Delete "${acc.name}"? This also deletes every transaction recorded against it.`)) return;
      const { error } = await sb.from("accounts").delete().eq("id", acc.id);
      if (error) { alert(error.message); return; }
      accounts = accounts.filter((a) => a.id !== acc.id);
      populateAccountSelect();
      renderAccountsPanel();
      await Promise.all([refreshBalances(), loadTransactions()]);
    });
  });
}

// ---------------- Add transaction ----------------

$("#tx-submit").addEventListener("click", async () => {
  $("#tx-error").textContent = "";
  const date = $("#tx-date").value;
  const amount = parseFloat($("#tx-amount").value);
  const description = $("#tx-desc").value.trim();
  const accountId = $("#tx-account").value;
  let categoryId = $("#tx-category").value;

  if (!accountId) { $("#tx-error").textContent = "Add an account first (Accounts tab)."; return; }
  if (!date || !amount || amount <= 0) {
    $("#tx-error").textContent = "Enter a date and an amount greater than 0.";
    return;
  }

  try {
    if (categoryId === "__new__") {
      const newName = $("#tx-new-category").value.trim();
      if (!newName) { $("#tx-error").textContent = "Enter a name for the new category."; return; }
      categoryId = await getOrCreateCategory(newName, currentKind);
    }
    const { error } = await sb.from("transactions").insert({
      occurred_on: date, kind: currentKind, amount, account_id: accountId, category_id: categoryId,
      description: description || null,
    });
    if (error) throw error;

    $("#tx-amount").value = "";
    $("#tx-desc").value = "";
    $("#tx-new-category").value = "";
    $("#new-category-field").style.display = "none";
    populateCategorySelect();
    await Promise.all([refreshBalances(), loadTransactions()]);
  } catch (err) {
    $("#tx-error").textContent = err.message || "Could not save transaction.";
  }
});

// ---------------- Balances ----------------

async function refreshBalances() {
  const { data, error } = await sb.from("transactions").select("account_id, kind, amount");
  if (error) { console.error(error); return; }

  const netByAccount = {};
  for (const t of data) {
    const delta = t.kind === "income" ? Number(t.amount) : -Number(t.amount);
    netByAccount[t.account_id] = (netByAccount[t.account_id] || 0) + delta;
  }

  let total = 0;
  for (const a of accounts) {
    const balance = Number(a.starting_balance) + (netByAccount[a.id] || 0);
    total += balance;
    const el = document.getElementById(`acc-balance-${a.id}`);
    if (el) el.textContent = "$" + fmt(balance);
  }

  const el = $("#balance-value");
  el.textContent = (total < 0 ? "-$" : "$") + fmt(Math.abs(total));
  el.classList.toggle("negative", total < 0);
}

// ---------------- Transactions list ----------------

async function loadTransactions() {
  const { data, error } = await sb
    .from("transactions")
    .select("id, occurred_on, kind, amount, description, categories(name), accounts(name)")
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) { console.error(error); return; }
  renderTransactions(data || []);
}

function renderTransactions(rows) {
  const list = $("#tx-list");
  list.innerHTML = "";
  $("#tx-empty").style.display = rows.length ? "none" : "block";
  for (const t of rows) {
    const li = document.createElement("li");
    li.innerHTML = `
      <time>${t.occurred_on}</time>
      <span>
        <div class="cat">${escapeHtml(t.categories ? t.categories.name : "Uncategorized")}</div>
        <div class="desc">${t.accounts ? escapeHtml(t.accounts.name) : ""}${t.description ? " · " + escapeHtml(t.description) : ""}</div>
      </span>
      <span class="amount ${t.kind}">${t.kind === "expense" ? "-" : "+"}$${fmt(Number(t.amount))}</span>
      <button class="del" title="Delete" data-id="${t.id}">✕</button>
    `;
    list.appendChild(li);
  }
  list.querySelectorAll(".del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this transaction?")) return;
      const { error } = await sb.from("transactions").delete().eq("id", btn.dataset.id);
      if (error) { alert(error.message); return; }
      await Promise.all([refreshBalances(), loadTransactions()]);
    });
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------- Reports ----------------

$("#rep-run").addEventListener("click", runReport);

async function runReport() {
  const from = $("#rep-from").value;
  const to = $("#rep-to").value;
  if (!from || !to) return;

  const { data, error } = await sb
    .from("transactions")
    .select("kind, amount, categories(name)")
    .gte("occurred_on", from)
    .lte("occurred_on", to);
  if (error) { console.error(error); return; }

  let incomeTotal = 0, expenseTotal = 0;
  const byCat = { income: {}, expense: {} };
  for (const t of data) {
    const amt = Number(t.amount);
    const cat = t.categories ? t.categories.name : "Uncategorized";
    if (t.kind === "income") { incomeTotal += amt; byCat.income[cat] = (byCat.income[cat] || 0) + amt; }
    else { expenseTotal += amt; byCat.expense[cat] = (byCat.expense[cat] || 0) + amt; }
  }

  $("#rep-income-total").textContent = "$" + fmt(incomeTotal);
  $("#rep-expense-total").textContent = "$" + fmt(expenseTotal);
  const net = incomeTotal - expenseTotal;
  const netEl = $("#rep-net-total");
  netEl.textContent = (net < 0 ? "-$" : "$") + fmt(Math.abs(net));
  netEl.style.color = net < 0 ? "var(--expense)" : "var(--income)";

  renderBreakdown("#rep-expense-breakdown", byCat.expense, expenseTotal, "expense");
  renderBreakdown("#rep-income-breakdown", byCat.income, incomeTotal, "income");
}

function renderBreakdown(containerSel, byCat, total, kind) {
  const container = $(containerSel);
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { container.innerHTML = '<p class="empty">Nothing in this range.</p>'; return; }
  container.innerHTML = entries.map(([name, amt]) => {
    const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
    return `
      <div class="report-bar-row">
        <span>${escapeHtml(name)}</span>
        <span class="report-bar-track"><span class="report-bar-fill ${kind}" style="width:${pct}%"></span></span>
        <span class="report-total">$${fmt(amt)}</span>
      </div>`;
  }).join("");
}

// ---------------- CSV export ----------------

$("#export-all").addEventListener("click", async () => {
  const { data, error } = await sb
    .from("transactions")
    .select("occurred_on, kind, amount, description, categories(name), accounts(name)")
    .order("occurred_on");
  if (error) { alert(error.message); return; }

  const rows = [["date", "kind", "account", "category", "amount", "description"]];
  for (const t of data) {
    rows.push([
      t.occurred_on, t.kind, t.accounts ? t.accounts.name : "", t.categories ? t.categories.name : "",
      Number(t.amount).toFixed(2), t.description || "",
    ]);
  }
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ledger-export-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

function csvEscape(val) {
  const s = String(val ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------- CSV import ----------------

$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("#import-error").textContent = "";

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: async (results) => {
      try {
        const rows = results.data;
        const toInsert = [];
        for (const row of rows) {
          const kind = (row.kind || "").trim().toLowerCase();
          if (kind !== "expense" && kind !== "income") throw new Error(`Row with invalid kind: "${row.kind}"`);
          const accName = (row.account || "Main").trim();
          const catName = (row.category || "Uncategorized").trim();
          const accountId = await getOrCreateAccount(accName);
          const categoryId = await getOrCreateCategory(catName, kind);
          toInsert.push({
            occurred_on: row.date,
            kind,
            amount: parseFloat(row.amount),
            account_id: accountId,
            category_id: categoryId,
            description: row.description || null,
          });
        }
        if (toInsert.length) {
          const { error } = await sb.from("transactions").insert(toInsert);
          if (error) throw error;
        }
        populateCategorySelect();
        populateAccountSelect();
        renderAccountsPanel();
        await Promise.all([refreshBalances(), loadTransactions()]);
        alert(`Imported ${toInsert.length} transaction(s).`);
      } catch (err) {
        $("#import-error").textContent = err.message || "Import failed.";
      } finally {
        e.target.value = "";
      }
    },
    error: (err) => { $("#import-error").textContent = err.message; },
  });
});

// ---------------- Service worker ----------------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

init();
