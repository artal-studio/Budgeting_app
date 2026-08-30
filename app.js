// ---------------------------------------------------------------------------
// 1) FILL THESE IN from your Supabase project: Settings > API
// ---------------------------------------------------------------------------
const SUPABASE_URL = "https://xeyjvkrihvnthghrlolx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wIuWrzo3lstOPkHeq80F5Q_qHumShWL";
// ---------------------------------------------------------------------------

const CURRENCY = "€";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => (n < 0 ? "-" : "") + CURRENCY + fmt(Math.abs(n));
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

const PIE_COLORS = ["#C97A4A", "#1F6F54", "#B3492B", "#5A6862", "#8C9A6B", "#3D6B72", "#A67C52", "#6B5B95"];

let categories = []; // {id, name, kind}
let accounts = [];   // {id, name, starting_balance}
let currentKind = "expense";
let recentTransactions = []; // last 100, used for both the Transactions tab and the Add-tab recent-5
let charts = { expensePie: null, incomePie: null, summaryBar: null };

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
  populateAccountSelects();
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
    const isTransfer = currentKind === "transfer";
    $("#category-section").style.display = isTransfer ? "none" : "block";
    $("#to-account-field").style.display = isTransfer ? "block" : "none";
    if (!isTransfer) populateCategorySelect();
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

function populateAccountSelects() {
  for (const id of ["#tx-account", "#tx-to-account"]) {
    const sel = $(id);
    const prev = sel.value;
    sel.innerHTML = "";
    accounts.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.name;
      sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
  }
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
  populateAccountSelects();
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
      <button class="secondary acc-rename" data-id="${a.id}">Rename</button>
      <button class="secondary acc-edit" data-id="${a.id}">Starting balance</button>
      <button class="del" data-id="${a.id}" title="Delete account">✕</button>
    `;
    list.appendChild(row);
  }
  list.querySelectorAll(".acc-rename").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const acc = accounts.find((a) => a.id === btn.dataset.id);
      const val = prompt(`New name for "${acc.name}"`, acc.name);
      if (val === null || !val.trim()) return;
      const { error } = await sb.from("accounts").update({ name: val.trim() }).eq("id", acc.id);
      if (error) { alert(error.message); return; }
      acc.name = val.trim();
      populateAccountSelects();
      renderAccountsPanel();
      await Promise.all([refreshBalances(), loadTransactions()]);
    });
  });
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
      if (!confirm(`Delete "${acc.name}"? This also deletes every transaction recorded against it (including transfers to/from it).`)) return;
      const { error } = await sb.from("accounts").delete().eq("id", acc.id);
      if (error) { alert(error.message); return; }
      accounts = accounts.filter((a) => a.id !== acc.id);
      populateAccountSelects();
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

  if (!accountId) { $("#tx-error").textContent = "Add an account first (Accounts tab)."; return; }
  if (!date || !amount || amount <= 0) {
    $("#tx-error").textContent = "Enter a date and an amount greater than 0.";
    return;
  }

  try {
    if (currentKind === "transfer") {
      const toAccountId = $("#tx-to-account").value;
      if (!toAccountId) { $("#tx-error").textContent = "Add a second account first (Accounts tab)."; return; }
      if (toAccountId === accountId) { $("#tx-error").textContent = "Pick two different accounts for a transfer."; return; }
      const { error } = await sb.from("transactions").insert({
        occurred_on: date, kind: "transfer", amount, account_id: accountId, transfer_to_account_id: toAccountId,
        category_id: null, description: description || null,
      });
      if (error) throw error;
    } else {
      let categoryId = $("#tx-category").value;
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
    }

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
  const { data, error } = await sb.from("transactions").select("account_id, kind, amount, transfer_to_account_id");
  if (error) { console.error(error); return; }

  const netByAccount = {};
  const add = (id, delta) => { netByAccount[id] = (netByAccount[id] || 0) + delta; };
  for (const t of data) {
    const amt = Number(t.amount);
    if (t.kind === "income") add(t.account_id, amt);
    else if (t.kind === "expense") add(t.account_id, -amt);
    else if (t.kind === "transfer") { add(t.account_id, -amt); add(t.transfer_to_account_id, amt); }
  }

  let total = 0;
  for (const a of accounts) {
    const balance = Number(a.starting_balance) + (netByAccount[a.id] || 0);
    total += balance;
    const el = document.getElementById(`acc-balance-${a.id}`);
    if (el) el.textContent = money(balance);
  }

  const el = $("#balance-value");
  el.textContent = money(total);
  el.classList.toggle("negative", total < 0);
}

// ---------------- Transactions list ----------------

const TX_SELECT = "id, occurred_on, kind, amount, description, categories(name), " +
  "account:accounts!transactions_account_id_fkey(name), " +
  "transfer_account:accounts!transactions_transfer_to_account_id_fkey(name)";

async function loadTransactions() {
  const { data, error } = await sb
    .from("transactions")
    .select(TX_SELECT)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) { console.error(error); return; }
  recentTransactions = data || [];
  renderTransactions("#tx-list", "#tx-empty", recentTransactions);
  renderTransactions("#add-recent-list", "#add-recent-empty", recentTransactions.slice(0, 5));
}

function renderTransactions(listSel, emptySel, rows) {
  const list = $(listSel);
  list.innerHTML = "";
  $(emptySel).style.display = rows.length ? "none" : "block";
  for (const t of rows) {
    const li = document.createElement("li");
    let catLine, amountText, amountClass;
    if (t.kind === "transfer") {
      catLine = `Transfer → ${escapeHtml(t.transfer_account ? t.transfer_account.name : "?")}`;
      amountText = "⇄ " + money(Number(t.amount));
      amountClass = "transfer";
    } else {
      catLine = escapeHtml(t.categories ? t.categories.name : "Uncategorized");
      amountText = (t.kind === "expense" ? "-" : "+") + CURRENCY + fmt(Number(t.amount));
      amountClass = t.kind;
    }
    const sub = [t.account ? t.account.name : null, t.description || null].filter(Boolean).map(escapeHtml).join(" · ");
    li.innerHTML = `
      <time>${t.occurred_on}</time>
      <span>
        <div class="cat">${catLine}</div>
        ${sub ? `<div class="desc">${sub}</div>` : ""}
      </span>
      <span class="amount ${amountClass}">${amountText}</span>
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
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
    if (t.kind === "transfer") continue; // transfers between your own accounts aren't income or expense
    const amt = Number(t.amount);
    const cat = t.categories ? t.categories.name : "Uncategorized";
    if (t.kind === "income") { incomeTotal += amt; byCat.income[cat] = (byCat.income[cat] || 0) + amt; }
    else { expenseTotal += amt; byCat.expense[cat] = (byCat.expense[cat] || 0) + amt; }
  }
  const net = incomeTotal - expenseTotal;

  $("#rep-summary-text").textContent =
    `Income ${money(incomeTotal)} · Expenses ${money(expenseTotal)} · Net ${money(net)}`;

  renderList("#rep-expense-list", byCat.expense);
  renderList("#rep-income-list", byCat.income);
  renderPie("expensePie", "chart-expense-pie", byCat.expense);
  renderPie("incomePie", "chart-income-pie", byCat.income);
  renderSummaryBar(incomeTotal, expenseTotal, net);
}

function renderList(containerSel, byCat) {
  const container = $(containerSel);
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { container.innerHTML = '<p class="empty">Nothing in this range.</p>'; return; }
  container.innerHTML = entries.map(([name, amt]) =>
    `<div class="cat-amount-row"><span>${escapeHtml(name)}</span><span class="num">${money(amt)}</span></div>`
  ).join("");
}

function destroyChart(key) { if (charts[key]) { charts[key].destroy(); charts[key] = null; } }

function renderPie(key, canvasId, byCat) {
  destroyChart(key);
  const canvas = document.getElementById(canvasId);
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return;
  charts[key] = new Chart(canvas, {
    type: "pie",
    data: {
      labels: entries.map(([name]) => name),
      datasets: [{ data: entries.map(([, amt]) => amt), backgroundColor: entries.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]) }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
    },
  });
}

function renderSummaryBar(income, expense, net) {
  destroyChart("summaryBar");
  const canvas = document.getElementById("chart-summary-bar");
  charts.summaryBar = new Chart(canvas, {
    type: "bar",
    data: {
      labels: ["Income", "Expenses", "Net"],
      datasets: [{
        data: [income, expense, net],
        backgroundColor: ["#1F6F54", "#B3492B", net >= 0 ? "#1F6F54" : "#B3492B"],
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: (v) => CURRENCY + v } } },
    },
  });
}

// ---------------- Backup: Accounts ----------------

$("#export-accounts").addEventListener("click", () => {
  const rows = [["name", "starting_balance"], ...accounts.map((a) => [a.name, Number(a.starting_balance).toFixed(2)])];
  downloadCsv(rows, "ledger-accounts");
});

$("#import-accounts").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("#import-accounts-error").textContent = "";
  Papa.parse(file, {
    header: true, skipEmptyLines: true,
    complete: async (results) => {
      try {
        let count = 0;
        for (const row of results.data) {
          const name = (row.name || "").trim();
          if (!name) continue;
          const startBal = parseFloat(row.starting_balance || "0") || 0;
          const existing = accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
          if (existing) {
            const { error } = await sb.from("accounts").update({ starting_balance: startBal }).eq("id", existing.id);
            if (error) throw error;
            existing.starting_balance = startBal;
          } else {
            const { data, error } = await sb.from("accounts").insert({ name, starting_balance: startBal }).select().single();
            if (error) throw error;
            accounts.push(data);
          }
          count++;
        }
        populateAccountSelects();
        renderAccountsPanel();
        await refreshBalances();
        alert(`Restored ${count} account(s).`);
      } catch (err) {
        $("#import-accounts-error").textContent = err.message || "Import failed.";
      } finally {
        e.target.value = "";
      }
    },
  });
});

// ---------------- Backup: Categories ----------------

$("#export-categories").addEventListener("click", () => {
  const rows = [["name", "kind"], ...categories.map((c) => [c.name, c.kind])];
  downloadCsv(rows, "ledger-categories");
});

$("#import-categories").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("#import-categories-error").textContent = "";
  Papa.parse(file, {
    header: true, skipEmptyLines: true,
    complete: async (results) => {
      try {
        let count = 0;
        for (const row of results.data) {
          const kind = (row.kind || "").trim().toLowerCase();
          const name = (row.name || "").trim();
          if (!name || (kind !== "expense" && kind !== "income")) continue;
          await getOrCreateCategory(name, kind);
          count++;
        }
        populateCategorySelect();
        alert(`Restored ${count} categor${count === 1 ? "y" : "ies"}.`);
      } catch (err) {
        $("#import-categories-error").textContent = err.message || "Import failed.";
      } finally {
        e.target.value = "";
      }
    },
  });
});

// ---------------- Backup: Transactions ----------------

$("#export-transactions").addEventListener("click", async () => {
  const { data, error } = await sb.from("transactions").select(TX_SELECT).order("occurred_on");
  if (error) { alert(error.message); return; }

  const rows = [["id", "date", "kind", "account", "to_account", "category", "amount", "description"]];
  for (const t of data) {
    rows.push([
      t.id, t.occurred_on, t.kind,
      t.account ? t.account.name : "",
      t.transfer_account ? t.transfer_account.name : "",
      t.categories ? t.categories.name : "",
      Number(t.amount).toFixed(2),
      t.description || "",
    ]);
  }
  downloadCsv(rows, "ledger-transactions");
});

$("#import-transactions").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("#import-transactions-error").textContent = "";

  Papa.parse(file, {
    header: true, skipEmptyLines: true,
    complete: async (results) => {
      try {
        const toUpsert = [];
        const toInsert = [];
        for (const row of results.data) {
          const kind = (row.kind || "").trim().toLowerCase();
          if (!["expense", "income", "transfer"].includes(kind)) throw new Error(`Row with invalid kind: "${row.kind}"`);
          const accountId = await getOrCreateAccount((row.account || "Main").trim());

          let categoryId = null, toAccountId = null;
          if (kind === "transfer") {
            toAccountId = await getOrCreateAccount((row.to_account || "Main").trim());
          } else {
            categoryId = await getOrCreateCategory((row.category || "Uncategorized").trim(), kind);
          }

          const record = {
            occurred_on: row.date, kind, amount: parseFloat(row.amount),
            account_id: accountId, transfer_to_account_id: toAccountId, category_id: categoryId,
            description: row.description || null,
          };
          if (row.id && row.id.trim()) { record.id = row.id.trim(); toUpsert.push(record); }
          else toInsert.push(record);
        }

        if (toUpsert.length) {
          const { error } = await sb.from("transactions").upsert(toUpsert, { onConflict: "id" });
          if (error) throw error;
        }
        if (toInsert.length) {
          const { error } = await sb.from("transactions").insert(toInsert);
          if (error) throw error;
        }

        populateCategorySelect();
        populateAccountSelects();
        renderAccountsPanel();
        await Promise.all([refreshBalances(), loadTransactions()]);
        alert(`Restored ${toUpsert.length + toInsert.length} transaction(s) (${toUpsert.length} matched existing rows, ${toInsert.length} were new).`);
      } catch (err) {
        $("#import-transactions-error").textContent = err.message || "Import failed.";
      } finally {
        e.target.value = "";
      }
    },
  });
});

function downloadCsv(rows, filenamePrefix) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenamePrefix}-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(val) {
  const s = String(val ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------- Service worker ----------------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

init();
