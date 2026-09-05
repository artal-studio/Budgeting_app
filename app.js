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
let txFilterAccountId = ""; // "" = all accounts, on the Transactions tab
let charts = { expensePie: null, incomePie: null, summaryBar: null, projection: null, freelanceSplit: null };

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
  btn.addEventListener("click", () => {
    switchTab(btn.dataset.view);
    if (btn.dataset.view === "projection") runProjection();
    if (btn.dataset.view === "freelance") renderFreelance();
  });
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
  const { data, error } = await sb.from("accounts").select("id, name, starting_balance, type, vat_pct, tax_pct, cotisation_pct").order("name");
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
    const cashAccs = accounts.filter((a) => a.type !== "investment");
    const invAccs = accounts.filter((a) => a.type === "investment");
    if (cashAccs.length) {
      const og = document.createElement("optgroup");
      og.label = "Cash";
      cashAccs.forEach((a) => og.appendChild(new Option(a.name, a.id)));
      sel.appendChild(og);
    }
    if (invAccs.length) {
      const og = document.createElement("optgroup");
      og.label = "Investments / Savings";
      invAccs.forEach((a) => og.appendChild(new Option(a.name, a.id)));
      sel.appendChild(og);
    }
    if (prev) sel.value = prev;
  }
  const hasAccounts = accounts.length > 0;
  $("#tx-submit").disabled = !hasAccounts;
  $("#add-needs-account").style.display = hasAccounts ? "none" : "block";

  // Transactions-tab filter: same options, plus a leading "All accounts".
  const filterSel = $("#tx-filter-account");
  const prevFilter = filterSel.value;
  filterSel.innerHTML = "";
  filterSel.appendChild(new Option("All accounts", ""));
  const cashAccs = accounts.filter((a) => a.type !== "investment");
  const invAccs = accounts.filter((a) => a.type === "investment");
  if (cashAccs.length) {
    const og = document.createElement("optgroup");
    og.label = "Cash";
    cashAccs.forEach((a) => og.appendChild(new Option(a.name, a.id)));
    filterSel.appendChild(og);
  }
  if (invAccs.length) {
    const og = document.createElement("optgroup");
    og.label = "Investments / Savings";
    invAccs.forEach((a) => og.appendChild(new Option(a.name, a.id)));
    filterSel.appendChild(og);
  }
  filterSel.value = accounts.some((a) => a.id === prevFilter) ? prevFilter : "";
  txFilterAccountId = filterSel.value;
}

$("#tx-filter-account").addEventListener("change", (e) => {
  txFilterAccountId = e.target.value;
  loadTransactionsList();
});

let newAccountType = "cash";
document.querySelectorAll("#acc-type-toggle button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#acc-type-toggle button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    newAccountType = btn.dataset.type;
  });
});

$("#acc-add").addEventListener("click", async () => {
  $("#acc-error").textContent = "";
  const name = $("#acc-name").value.trim();
  const starting = parseFloat($("#acc-starting").value || "0");
  if (!name) { $("#acc-error").textContent = "Enter an account name."; return; }
  if (accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
    $("#acc-error").textContent = "An account with that name already exists.";
    return;
  }
  const { data, error } = await sb.from("accounts").insert({ name, starting_balance: starting || 0, type: newAccountType }).select().single();
  if (error) { $("#acc-error").textContent = error.message; return; }
  accounts.push(data);
  $("#acc-name").value = "";
  $("#acc-starting").value = "";
  document.querySelectorAll("#acc-type-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.type === "cash"));
  newAccountType = "cash";
  populateAccountSelects();
  renderAccountsPanel();
  await refreshBalances();
});

const ACCOUNT_GROUPS = [
  { type: "cash", label: "Cash", subtotalId: "acc-subtotal-cash" },
  { type: "investment", label: "Investments / Savings", subtotalId: "acc-subtotal-investment" },
];

function renderAccountsPanel() {
  const list = $("#acc-list");
  list.innerHTML = "";
  if (!accounts.length) {
    list.innerHTML = '<p class="empty">No accounts yet — add one below.</p>';
    closeAccountEditPanel();
    return;
  }
  for (const g of ACCOUNT_GROUPS) {
    const rows = accounts.filter((a) => a.type === g.type);
    if (!rows.length) continue;
    const section = document.createElement("div");
    section.className = "acc-group";
    section.innerHTML = `<div class="acc-group-head"><span>${g.label}</span><span class="num" id="${g.subtotalId}">…</span></div>`;
    for (const a of rows) {
      const row = document.createElement("div");
      row.className = "acc-row";
      row.innerHTML = `
        <span class="acc-name">${escapeHtml(a.name)}</span>
        <span class="acc-balance-chip"><span class="acc-balance num" id="acc-balance-${a.id}">…</span></span>
        <button class="icon-btn acc-edit-toggle" data-id="${a.id}" title="Edit ${escapeHtml(a.name)}" aria-label="Edit ${escapeHtml(a.name)}">✎</button>
      `;
      section.appendChild(row);
    }
    list.appendChild(section);
  }
  list.querySelectorAll(".acc-edit-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      if ($("#acc-edit-panel").dataset.accountId === btn.dataset.id) closeAccountEditPanel();
      else openAccountEditPanel(btn.dataset.id);
    });
  });
  // Keep the panel in sync if it's open (e.g. after a rename changes the displayed name).
  if ($("#acc-edit-panel").dataset.accountId) openAccountEditPanel($("#acc-edit-panel").dataset.accountId);
}

function closeAccountEditPanel() {
  const panel = $("#acc-edit-panel");
  panel.dataset.accountId = "";
  panel.style.display = "none";
  panel.innerHTML = "";
}

function openAccountEditPanel(accountId) {
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) { closeAccountEditPanel(); return; }
  const panel = $("#acc-edit-panel");
  panel.dataset.accountId = accountId;
  panel.style.display = "block";
  panel.innerHTML = `
    <div class="acc-edit-head">
      <span>Editing "${escapeHtml(acc.name)}"</span>
      <button class="link" id="acc-edit-close">Close</button>
    </div>
    <div class="kind-toggle" id="acc-edit-type-toggle" style="margin-bottom:12px;">
      <button type="button" data-type="cash" class="${acc.type !== "investment" ? "active" : ""}">Cash</button>
      <button type="button" data-type="investment" class="${acc.type === "investment" ? "active" : ""}">Investment</button>
    </div>
    <div class="row-2">
      <div class="field">
        <label for="acc-edit-name">Name</label>
        <input id="acc-edit-name" type="text" value="${escapeHtml(acc.name)}" />
      </div>
      <div class="field">
        <label for="acc-edit-balance">Starting balance</label>
        <input id="acc-edit-balance" type="number" step="0.01" value="${acc.starting_balance}" />
      </div>
    </div>
    <h3 class="section-title">Freelance reserves (optional)</h3>
    <p class="csv-hint" style="margin-top:0;">
      Only fill these in for a professional/client-revenue account — leave blank
      otherwise. Enables the Freelance tab for this account.
    </p>
    <div class="row-3">
      <div class="field">
        <label for="acc-edit-vat">VAT %</label>
        <input id="acc-edit-vat" type="number" step="0.01" min="0" max="100" value="${acc.vat_pct ?? ""}" placeholder="e.g. 20" />
      </div>
      <div class="field">
        <label for="acc-edit-tax">Tax %</label>
        <input id="acc-edit-tax" type="number" step="0.01" min="0" max="100" value="${acc.tax_pct ?? ""}" placeholder="e.g. 10" />
      </div>
      <div class="field">
        <label for="acc-edit-cotisation">Cotisation %</label>
        <input id="acc-edit-cotisation" type="number" step="0.01" min="0" max="100" value="${acc.cotisation_pct ?? ""}" placeholder="e.g. 25" />
      </div>
    </div>
    <div class="csv-actions">
      <button class="secondary" id="acc-edit-save">Save changes</button>
      <button class="del-text" id="acc-edit-delete">Delete account</button>
    </div>
    <p class="error-text" id="acc-edit-error"></p>
  `;

  let editType = acc.type === "investment" ? "investment" : "cash";
  panel.querySelectorAll("#acc-edit-type-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      panel.querySelectorAll("#acc-edit-type-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      editType = btn.dataset.type;
    });
  });

  $("#acc-edit-close").addEventListener("click", closeAccountEditPanel);

  $("#acc-edit-save").addEventListener("click", async () => {
    $("#acc-edit-error").textContent = "";
    const newName = $("#acc-edit-name").value.trim();
    const newBalance = parseFloat($("#acc-edit-balance").value);
    if (!newName) { $("#acc-edit-error").textContent = "Name can't be empty."; return; }
    if (Number.isNaN(newBalance)) { $("#acc-edit-error").textContent = "Starting balance must be a number."; return; }
    const pctOrNull = (id) => { const v = $(id).value; return v === "" ? null : parseFloat(v); };
    const vatPct = pctOrNull("#acc-edit-vat");
    const taxPct = pctOrNull("#acc-edit-tax");
    const cotisationPct = pctOrNull("#acc-edit-cotisation");
    const { error } = await sb.from("accounts").update({
      name: newName, starting_balance: newBalance, type: editType,
      vat_pct: vatPct, tax_pct: taxPct, cotisation_pct: cotisationPct,
    }).eq("id", acc.id);
    if (error) { $("#acc-edit-error").textContent = error.message; return; }
    acc.name = newName;
    acc.starting_balance = newBalance;
    acc.type = editType;
    acc.vat_pct = vatPct;
    acc.tax_pct = taxPct;
    acc.cotisation_pct = cotisationPct;
    populateAccountSelects();
    renderAccountsPanel();
    await Promise.all([refreshBalances(), loadTransactions()]);
  });

  $("#acc-edit-delete").addEventListener("click", async () => {
    if (!confirm(`Delete "${acc.name}"? This also deletes every transaction recorded against it (including transfers to/from it).`)) return;
    const { error } = await sb.from("accounts").delete().eq("id", acc.id);
    if (error) { $("#acc-edit-error").textContent = error.message; return; }
    accounts = accounts.filter((a) => a.id !== acc.id);
    closeAccountEditPanel();
    populateAccountSelects();
    renderAccountsPanel();
    await Promise.all([refreshBalances(), loadTransactions()]);
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

async function computeBalances() {
  const { data, error } = await sb.from("transactions").select("account_id, kind, amount, transfer_to_account_id");
  if (error) { console.error(error); return { byAccount: {}, cashTotal: 0, investmentTotal: 0 }; }

  const netByAccount = {};
  const add = (id, delta) => { netByAccount[id] = (netByAccount[id] || 0) + delta; };
  for (const t of data) {
    const amt = Number(t.amount);
    if (t.kind === "income") add(t.account_id, amt);
    else if (t.kind === "expense") add(t.account_id, -amt);
    else if (t.kind === "transfer") { add(t.account_id, -amt); add(t.transfer_to_account_id, amt); }
  }

  const byAccount = {};
  let cashTotal = 0, investmentTotal = 0;
  for (const a of accounts) {
    const balance = Number(a.starting_balance) + (netByAccount[a.id] || 0);
    byAccount[a.id] = balance;
    if (a.type === "investment") investmentTotal += balance; else cashTotal += balance;
  }
  return { byAccount, cashTotal, investmentTotal };
}

async function refreshBalances() {
  const { byAccount, cashTotal, investmentTotal } = await computeBalances();

  for (const a of accounts) {
    const el = document.getElementById(`acc-balance-${a.id}`);
    if (el) el.textContent = money(byAccount[a.id] || 0);
  }
  const cashEl = document.getElementById("acc-subtotal-cash");
  if (cashEl) cashEl.textContent = money(cashTotal);
  const invEl = document.getElementById("acc-subtotal-investment");
  if (invEl) invEl.textContent = money(investmentTotal);

  const el = $("#balance-value");
  el.textContent = money(cashTotal);
  el.classList.toggle("negative", cashTotal < 0);

  const sub = $("#balance-sub");
  const hasInvestments = accounts.some((a) => a.type === "investment");
  if (hasInvestments) {
    sub.style.display = "block";
    sub.textContent = `Investments ${money(investmentTotal)} · Net worth ${money(cashTotal + investmentTotal)}`;
  } else {
    sub.style.display = "none";
  }
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
    .limit(5);
  if (!error) renderTransactions("#add-recent-list", "#add-recent-empty", data || []);

  await loadTransactionsList();
}

async function loadTransactionsList() {
  let query = sb
    .from("transactions")
    .select(TX_SELECT)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (txFilterAccountId) query = query.eq("account_id", txFilterAccountId);
  const { data, error } = await query;
  if (error) { console.error(error); return; }
  renderTransactions("#tx-list", "#tx-empty", data || []);
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

// ---------------- Projection ----------------

$("#proj-lookback").addEventListener("change", async () => {
  delete $("#proj-net-override").dataset.touched;
  await runProjection();
});
$("#proj-net-override").addEventListener("input", () => { $("#proj-net-override").dataset.touched = "1"; });
$("#proj-run").addEventListener("click", runProjection);

async function computeDefaultMonthlyNet(months) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const { data, error } = await sb
    .from("transactions")
    .select("account_id, kind, amount")
    .gte("occurred_on", cutoffStr)
    .in("kind", ["income", "expense"]);
  if (error) { console.error(error); return 0; }
  const cashIds = new Set(accounts.filter((a) => a.type !== "investment").map((a) => a.id));
  let income = 0, expense = 0;
  for (const t of data) {
    if (!cashIds.has(t.account_id)) continue;
    const amt = Number(t.amount);
    if (t.kind === "income") income += amt; else expense += amt;
  }
  return (income - expense) / months;
}

async function runProjection() {
  const months = parseInt($("#proj-lookback").value, 10);
  if (!$("#proj-net-override").dataset.touched) {
    const defaultNet = await computeDefaultMonthlyNet(months);
    $("#proj-net-override").value = defaultNet.toFixed(2);
  }
  const netPerMonth = parseFloat($("#proj-net-override").value) || 0;
  const horizon = Math.max(1, parseInt($("#proj-horizon").value, 10) || 12);
  const { cashTotal } = await computeBalances();

  const labels = [];
  const values = [];
  const start = new Date();
  for (let i = 0; i <= horizon; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    labels.push(d.toLocaleDateString(undefined, { month: "short", year: "numeric" }));
    values.push(cashTotal + netPerMonth * i);
  }

  destroyChart("projection");
  const canvas = document.getElementById("chart-projection");
  charts.projection = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Projected cash", data: values, tension: 0.15, pointRadius: 2,
        borderColor: netPerMonth >= 0 ? "#1F6F54" : "#B3492B",
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: (v) => CURRENCY + v } } },
    },
  });

  let statusText;
  if (netPerMonth >= 0) {
    statusText = `At ${money(netPerMonth)}/month, your cash balance is projected to grow, not deplete.`;
  } else if (cashTotal <= 0) {
    statusText = `Cash is already at or below €0, and trending down at ${money(netPerMonth)}/month.`;
  } else {
    const monthsToZero = Math.ceil(cashTotal / -netPerMonth);
    if (monthsToZero > horizon) {
      statusText = `At ${money(netPerMonth)}/month, cash wouldn't run out within the ${horizon}-month horizon shown.`;
    } else {
      const zeroDate = new Date(start.getFullYear(), start.getMonth() + monthsToZero, 1);
      const monthLabel = zeroDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      statusText = `At ${money(netPerMonth)}/month, cash is projected to reach €0 around ${monthLabel} (~${monthsToZero} month${monthsToZero === 1 ? "" : "s"}).`;
    }
  }
  $("#proj-status").textContent = statusText;
}

// ---------------- Freelance ----------------

const RESERVE_CATEGORY_NAMES = { vat_pct: "VAT payment", tax_pct: "Tax payment", cotisation_pct: "Cotisations payment" };

function findProfessionalAccounts() {
  return accounts.filter((a) => a.vat_pct != null || a.tax_pct != null || a.cotisation_pct != null);
}

async function renderFreelance() {
  const candidates = findProfessionalAccounts();
  if (!candidates.length) {
    $("#freelance-setup").style.display = "block";
    $("#freelance-main").style.display = "none";
    return;
  }
  $("#freelance-setup").style.display = "none";
  $("#freelance-main").style.display = "block";

  const field = $("#freelance-account-field");
  const sel = $("#freelance-account");
  if (candidates.length > 1) {
    field.style.display = "block";
    const prev = sel.value;
    sel.innerHTML = "";
    candidates.forEach((a) => sel.appendChild(new Option(a.name, a.id)));
    if (candidates.some((a) => a.id === prev)) sel.value = prev;
  } else {
    field.style.display = "none";
  }
  const accountId = sel.value || candidates[0].id;
  await ensureReserveCategories();
  await renderFreelanceFor(accountId);
}

$("#freelance-account").addEventListener("change", (e) => renderFreelanceFor(e.target.value));

async function ensureReserveCategories() {
  for (const name of Object.values(RESERVE_CATEGORY_NAMES)) {
    await getOrCreateCategory(name, "expense");
  }
}

async function renderFreelanceFor(accountId) {
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return;

  const { data, error } = await sb
    .from("transactions")
    .select("kind, amount, categories(name)")
    .eq("account_id", accountId)
    .in("kind", ["income", "expense"]);
  if (error) { console.error(error); return; }

  let incomeTotal = 0;
  const reservePaid = { vat_pct: 0, tax_pct: 0, cotisation_pct: 0 };
  let expenseTotal = 0;
  let reservePaymentsTotal = 0;
  for (const t of data) {
    const amt = Number(t.amount);
    if (t.kind === "income") { incomeTotal += amt; continue; }
    expenseTotal += amt;
    const catName = t.categories ? t.categories.name : null;
    for (const key of Object.keys(RESERVE_CATEGORY_NAMES)) {
      if (catName === RESERVE_CATEGORY_NAMES[key]) { reservePaid[key] += amt; reservePaymentsTotal += amt; }
    }
  }

  const { byAccount } = await computeBalances();
  const currentBalance = byAccount[accountId] || 0;
  const professionalExpenses = expenseTotal - reservePaymentsTotal;

  const reserveRows = [];
  let reservedTotal = 0;
  for (const [key, label] of [["vat_pct", "VAT"], ["tax_pct", "Tax"], ["cotisation_pct", "Cotisations"]]) {
    if (acc[key] == null) continue;
    const reserved = (incomeTotal * acc[key]) / 100 - reservePaid[key];
    reservedTotal += reserved;
    reserveRows.push({ label: `${label} (${acc[key]}%)`, amount: reserved });
  }

  $("#freelance-balance").textContent = money(currentBalance);
  $("#freelance-reserved-list").innerHTML = reserveRows.map((r) =>
    `<div class="cat-amount-row"><span>${escapeHtml(r.label)}</span><span class="num">${money(r.amount)}</span></div>`
  ).join("") || '<p class="empty">No reserve percentages set on this account.</p>';
  $("#freelance-reserved-total").textContent = `Total reserved: ${money(reservedTotal)}`;
  $("#freelance-expenses").textContent = money(professionalExpenses);
  $("#freelance-available").textContent = money(currentBalance - reservedTotal);

  destroyChart("freelanceSplit");
  const canvas = document.getElementById("chart-freelance-split");
  const slices = reserveRows.filter((r) => r.amount > 0).map((r) => ({ label: r.label, amount: r.amount }));
  const available = currentBalance - reservedTotal;
  if (available > 0) slices.push({ label: "Available", amount: available });
  if (slices.length) {
    charts.freelanceSplit = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: slices.map((s) => s.label),
        datasets: [{ data: slices.map((s) => s.amount), backgroundColor: slices.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]) }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
      },
    });
  }
}

// ---------------- Backup: Accounts ----------------

$("#export-accounts").addEventListener("click", () => {
  const rows = [
    ["name", "starting_balance", "type", "vat_pct", "tax_pct", "cotisation_pct"],
    ...accounts.map((a) => [a.name, Number(a.starting_balance).toFixed(2), a.type || "cash", a.vat_pct ?? "", a.tax_pct ?? "", a.cotisation_pct ?? ""]),
  ];
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
          const type = (row.type || "").trim().toLowerCase() === "investment" ? "investment" : "cash";
          const pctOrNull = (v) => (v === undefined || v === null || String(v).trim() === "") ? null : parseFloat(v);
          const vatPct = pctOrNull(row.vat_pct);
          const taxPct = pctOrNull(row.tax_pct);
          const cotisationPct = pctOrNull(row.cotisation_pct);
          const existing = accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
          if (existing) {
            const { error } = await sb.from("accounts")
              .update({ starting_balance: startBal, type, vat_pct: vatPct, tax_pct: taxPct, cotisation_pct: cotisationPct })
              .eq("id", existing.id);
            if (error) throw error;
            Object.assign(existing, { starting_balance: startBal, type, vat_pct: vatPct, tax_pct: taxPct, cotisation_pct: cotisationPct });
          } else {
            const { data, error } = await sb.from("accounts")
              .insert({ name, starting_balance: startBal, type, vat_pct: vatPct, tax_pct: taxPct, cotisation_pct: cotisationPct })
              .select().single();
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
