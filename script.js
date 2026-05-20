/* ============================================================
   InvenTrack — script.js
   Database: inventrack1
   Connected to Express/MySQL backend at http://localhost:3000
   ============================================================ */

"use strict";

/* ============================================================
   AUTH CONFIGURATION
============================================================ */
const AUTH = { SESSION_KEY: "inventrack_session" };

/* ============================================================
   CONSTANTS
============================================================ */
const CONFIG = {
  LOW_STOCK_THRESHOLD:  10,
  WARN_STOCK_THRESHOLD: 25,
  API_BASE: "http://localhost:3000/api"
};

/* ============================================================
   STATE
============================================================ */
let state = {
  products:        [],
  allProducts:     [],
  users:           [],
  allUsers:        [],
  logs:            [],
  allLogs:         [],
  categories:      [],   // { id, name, category_group, description }
  roles:           [],   // { id, name, description }
  editingId:       null,
  editingUserId:   null,
  deleteTargetId:  null,
  deleteTargetType: null, // 'product' | 'user'
  charts:          {}
};

/* ============================================================
   API LAYER
============================================================ */

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${CONFIG.API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }
  return res.json();
}

// --- Products ---
async function fetchProducts()        { return apiFetch("/products"); }
async function addProduct(data)       { return apiFetch("/products", { method: "POST", body: JSON.stringify(data) }); }
async function updateProduct(id, data){ return apiFetch(`/products/${id}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deleteProduct(id)      {
  const session = getSession();
  return apiFetch(`/products/${id}?deleted_by=${session?.id || ""}`, { method: "DELETE" });
}

// --- Categories ---
async function fetchCategories() { return apiFetch("/categories"); }

// --- Users ---
async function fetchUsers()        { return apiFetch("/users"); }
async function addUser(data)       { return apiFetch("/users", { method: "POST", body: JSON.stringify(data) }); }
async function updateUser(id, data){ return apiFetch(`/users/${id}`, { method: "PUT", body: JSON.stringify(data) }); }
async function deleteUser(id)      { return apiFetch(`/users/${id}`, { method: "DELETE" }); }

// --- Roles ---
async function fetchRoles() { return apiFetch("/roles"); }

// --- Logs ---
async function fetchLogs(limit = 100) { return apiFetch(`/logs?limit=${limit}`); }
async function addLog(data)           { return apiFetch("/logs", { method: "POST", body: JSON.stringify(data) }); }

/* ============================================================
   INITIALIZATION
============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  initAuthUI();
  checkSession();
});

function checkSession() {
  const session = getSession();
  if (session) showApp(session);
  else showLogin();
}

function applyRoleRestrictions() {
  const session = getSession();
  if (!session) return;

  // 1. Hide the 'Users' navigation item for non-admins
  const usersNav = document.querySelector('.nav-item[data-page="users"]');
  if (usersNav) {
    usersNav.style.display = (session.role === 'admin') ? 'flex' : 'none';
  }

  // 2. Hide the "Add Product" button for Viewers (assuming you have a button with this ID)
  // Note: Make sure your "Add Product" button in HTML has id="btnAddProduct"
  const addProductBtn = document.getElementById("btnAddProduct"); 
  if (addProductBtn) {
    addProductBtn.style.display = (session.role === 'viewer') ? 'none' : 'flex';
  }
}

async function bootApp(session) {
  document.getElementById("sidebarUsername").textContent = session.displayName;
  document.getElementById("topbarUsername").textContent  = session.displayName;
  document.getElementById("sidebarRole").textContent     = session.role || "Inventory Manager";

  try {
    // Load reference data first
    state.categories = await fetchCategories();
    state.roles      = await fetchRoles();
    populateProductCategorySelect();
    populateRoleSelect();
  } catch (e) {
    showToast("Could not load reference data from server.", "error");
  }

  await loadAllProducts();
  await loadAllUsers();
  await loadLogsPage();
  renderAll();
  initNavigation();
  initClock();
  initSortableHeaders();
  applyRoleRestrictions();
}

/* ============================================================
   SESSION MANAGEMENT
============================================================ */
function getSession() {
  const raw = sessionStorage.getItem(AUTH.SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveSession(user) {
  sessionStorage.setItem(AUTH.SESSION_KEY, JSON.stringify({
    id:          user.id,
    username:    user.username,
    displayName: user.displayName,
    role:        user.role,
    loginTime:   new Date().toISOString()
  }));
}

function clearSession() { sessionStorage.removeItem(AUTH.SESSION_KEY); }

/* ============================================================
   LOGIN
============================================================ */
function initAuthUI() {
  document.getElementById("loginPassword").addEventListener("keydown", e => { if (e.key === "Enter") handleLogin(); });
  document.getElementById("loginUsername").addEventListener("keydown", e => { if (e.key === "Enter") handleLogin(); });
  document.getElementById("togglePw").addEventListener("click", () => {
    const input   = document.getElementById("loginPassword");
    const icon    = document.getElementById("pwEyeIcon");
    const visible = input.type === "text";
    input.type     = visible ? "password" : "text";
    icon.className = visible ? "fa-solid fa-eye" : "fa-solid fa-eye-slash";
  });
}

async function handleLogin() {
  clearLoginErrors();
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;

  let valid = true;
  if (!username) { setLoginError("loginUsername", "err-username", "Username is required."); valid = false; }
  if (!password) { setLoginError("loginPassword", "err-password", "Password is required."); valid = false; }
  if (!valid) return;

  setLoginLoading(true);
  try {
    const data = await apiFetch("/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    saveSession({ id: data.id, username: data.username, displayName: data.displayName, role: data.role });
    showApp({ id: data.id, username: data.username, displayName: data.displayName, role: data.role });
  } catch (err) {
    showLoginAlert(err.message || "Incorrect username or password.");
    document.getElementById("loginPassword").value = "";
    document.getElementById("loginPassword").focus();
  } finally {
    setLoginLoading(false);
  }
}

function showApp(session) {
  document.getElementById("loginScreen").style.display = "none";
  const appWrapper = document.getElementById("appWrapper");
  appWrapper.style.display    = "flex";
  appWrapper.style.opacity    = "0";
  appWrapper.style.transition = "opacity .4s ease";
  requestAnimationFrame(() => requestAnimationFrame(() => { appWrapper.style.opacity = "1"; }));
  bootApp(session);
}

function showLogin() {
  document.getElementById("appWrapper").style.display  = "none";
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("loginUsername").value = "";
  document.getElementById("loginPassword").value = "";
  clearLoginErrors();
}

function setLoginLoading(loading) {
  document.getElementById("loginBtn").disabled             = loading;
  document.getElementById("loginBtnText").style.display   = loading ? "none"   : "flex";
  document.getElementById("loginBtnLoader").style.display = loading ? "inline" : "none";
}

function showLoginAlert(msg) {
  const alert = document.getElementById("loginAlert");
  document.getElementById("loginAlertMsg").textContent = msg;
  alert.style.display = "flex";
}

function setLoginError(inputId, errorId, msg) {
  document.getElementById(inputId).classList.add("error");
  document.getElementById(errorId).textContent = msg;
}

function clearLoginErrors() {
  document.getElementById("loginAlert").style.display = "none";
  ["loginUsername","loginPassword"].forEach(id => document.getElementById(id).classList.remove("error"));
  document.getElementById("err-username").textContent = "";
  document.getElementById("err-password").textContent = "";
}

/* ============================================================
   LOGOUT
============================================================ */
function handleLogout()   { document.getElementById("logoutModal").classList.add("open"); }
function closeLogoutModal(){ document.getElementById("logoutModal").classList.remove("open"); }

function confirmLogout() {
  closeLogoutModal();
  const appWrapper = document.getElementById("appWrapper");
  appWrapper.style.transition = "opacity .35s ease, transform .35s ease";
  appWrapper.style.opacity    = "0";
  appWrapper.style.transform  = "scale(.98)";
  setTimeout(() => {
    clearSession();
    destroyCharts();
    appWrapper.style.opacity   = "";
    appWrapper.style.transform = "";
    showLogin();
    showToast("You have been signed out.", "success");
  }, 350);
}

/* ============================================================
   DATA LOADERS
============================================================ */
async function loadAllProducts() {
  try {
    state.allProducts = await fetchProducts();
    state.products    = [...state.allProducts];
  } catch (err) {
    showToast("Could not reach server. Is it running?", "error");
    state.allProducts = [];
    state.products    = [];
  }
}

async function loadAllUsers() {
  try {
    state.allUsers = await fetchUsers();
    state.users    = [...state.allUsers];
  } catch (err) {
    state.allUsers = [];
    state.users    = [];
  }
}

async function loadLogsPage() {
  try {
    const limit = document.getElementById("filterLogLimit")?.value || 100;
    state.allLogs = await fetchLogs(limit);
    state.logs    = [...state.allLogs];
  } catch (err) {
    state.allLogs = [];
    state.logs    = [];
  }
  renderLogsTable();
}

/* ============================================================
   RENDER ALL
============================================================ */
function renderAll() {
  renderProductsTable();
  renderDashboardStats();
  renderLowStockTable();
  renderCharts();
  renderAnalytics();
  renderUsersTable();
  renderLogsTable();
  updateNavBadge();
  populateCategoryFilter();
  populateLogProductSelect();
}

/* ============================================================
   NAVIGATION
============================================================ */
function initNavigation() {
  document.querySelectorAll(".nav-item[data-page]").forEach(item => {
    item.addEventListener("click", e => {
      e.preventDefault();
      navigateTo(item.dataset.page);
      closeSidebar();
    });
  });
  document.getElementById("menuToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("sidebarOverlay").classList.toggle("open");
  });
  document.getElementById("sidebarOverlay").addEventListener("click", closeSidebar);
}

function navigateTo(page) {
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add("active");

  document.querySelectorAll(".page").forEach(el => el.classList.remove("active"));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add("active");

  const titles = { dashboard: "Dashboard", products: "Products", analytics: "Analytics", users: "Users", logs: "Inventory Logs" };
  document.getElementById("pageTitle").textContent         = titles[page] || page;
  document.getElementById("breadcrumbCurrent").textContent = titles[page] || page;

  if (page === "dashboard") renderCharts();
  if (page === "analytics") renderAnalytics();
  if (page === "logs")      loadLogsPage();
}

function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").classList.remove("open");
}

function updateNavBadge() {
  document.getElementById("nav-product-count").textContent = state.allProducts.length;
  document.getElementById("nav-user-count").textContent    = state.allUsers.length;
}

/* ============================================================
   CLOCK
============================================================ */
function initClock() {
  updateClock();
  setInterval(updateClock, 1000);
}
function updateClock() {
  const now  = new Date();
  const time = now.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = now.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  document.getElementById("currentTime").textContent = `${date}  •  ${time}`;
}

/* ============================================================
   CATEGORY SELECTS — populate from DB data
============================================================ */
function populateProductCategorySelect() {
  const sel = document.getElementById("fcategory");
  sel.innerHTML = '<option value="">— Select Category —</option>';
  state.categories.forEach(cat => {
    const opt = document.createElement("option");
    opt.value       = cat.id;
    opt.textContent = cat.name;
    sel.appendChild(opt);
  });
}

function populateRoleSelect() {
  const sel = document.getElementById("fuRole");
  sel.innerHTML = '<option value="">— Select Role —</option>';
  state.roles.forEach(r => {
    const opt = document.createElement("option");
    opt.value       = r.id;
    opt.textContent = r.name.charAt(0).toUpperCase() + r.name.slice(1);
    sel.appendChild(opt);
  });
}

function populateCategoryFilter() {
  const sel     = document.getElementById("filterCategory");
  const current = sel.value;
  const cats    = [...new Set(state.allProducts.map(p => p.category))].sort();
  sel.innerHTML = '<option value="">All Categories</option>';
  cats.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat; opt.textContent = cat;
    sel.appendChild(opt);
  });
  sel.value = current;
}

function populateLogProductSelect() {
  const sel = document.getElementById("flProduct");
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select Product —</option>';
  state.allProducts.forEach(p => {
    const opt = document.createElement("option");
    opt.value       = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

/* ============================================================
   PRODUCTS TABLE
============================================================ */
function renderProductsTable() {
  const tbody = document.getElementById("productsTableBody");
  tbody.innerHTML = "";
  const data = state.products;
  document.getElementById("recordCount").textContent = `${data.length} record${data.length !== 1 ? "s" : ""}`;

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row"><i class="fa-solid fa-box-open"></i> No products found</td></tr>`;
    return;
  }

  data.forEach((p, idx) => {
    const isLow  = p.quantity < CONFIG.LOW_STOCK_THRESHOLD;
    const isWarn = !isLow && p.quantity < CONFIG.WARN_STOCK_THRESHOLD;
    const tr = document.createElement("tr");
    if (isLow) tr.classList.add("low-stock-row");

    // --- NEW: Check session to build action buttons ---
    const session = getSession();
    let actionBtnsHtml = "";

    if (session?.role === 'admin') {
      // Admins can Edit and Delete
      actionBtnsHtml = `
        <button class="icon-btn edit" title="Edit" onclick="openEditModal(${p.id})"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn delete" title="Delete" onclick="openDeleteModal(${p.id}, 'product')"><i class="fa-solid fa-trash"></i></button>
      `;
    } else if (session?.role === 'staff') {
      // Staff can only Edit
      actionBtnsHtml = `
        <button class="icon-btn edit" title="Edit" onclick="openEditModal(${p.id})"><i class="fa-solid fa-pen"></i></button>
      `;
    }
    // Viewers get an empty string (no buttons)
    // --------------------------------------------------

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><strong>${escapeHtml(p.name)}</strong>${p.description ? `<br/><small style="color:var(--text-3)">${escapeHtml(p.description)}</small>` : ""}</td>
      <td><span class="status-badge" style="background:#f1f5f9;color:var(--text-2)">${escapeHtml(p.category)}</span></td>
      <td><strong ${isLow ? 'style="color:var(--danger)"' : isWarn ? 'style="color:var(--amber)"' : ""}>${p.quantity}</strong></td>
      <td>₱${formatNumber(p.price)}</td>
      <td>${p.dateAdded || "—"}</td>
      <td>${p.added_by_name ? escapeHtml(p.added_by_name) : "—"}</td>
      <td>${renderStatusBadge(p.quantity)}</td>
      <td>
        <div class="action-btns">
          ${actionBtnsHtml} </div>
      </td>`;
    tbody.appendChild(tr);
  });
}

function renderStatusBadge(qty) {
  if (qty < CONFIG.LOW_STOCK_THRESHOLD)  return `<span class="status-badge status-low"><i class="fa-solid fa-circle-xmark"></i> Low Stock</span>`;
  if (qty < CONFIG.WARN_STOCK_THRESHOLD) return `<span class="status-badge status-warning"><i class="fa-solid fa-circle-exclamation"></i> Warning</span>`;
  return `<span class="status-badge status-ok"><i class="fa-solid fa-circle-check"></i> In Stock</span>`;
}

/* ============================================================
   SEARCH / FILTER / SORT — PRODUCTS
============================================================ */
function filterProducts() {
  const query    = document.getElementById("searchInput").value.toLowerCase().trim();
  const category = document.getElementById("filterCategory").value;
  state.products = state.allProducts.filter(p => {
    const matchQ = !query || p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query) || (p.description || "").toLowerCase().includes(query);
    const matchC = !category || p.category === category;
    return matchQ && matchC;
  });
  renderProductsTable();
}

function sortProducts() {
  const val = document.getElementById("sortSelect").value;
  if (!val) return;
  const [col, dir] = val.split("-");
  const asc = dir === "asc";
  state.products.sort((a, b) => {
    let va = a[col], vb = b[col];
    if (col === "qty") { va = a.quantity; vb = b.quantity; }
    if (typeof va === "string") return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    return asc ? va - vb : vb - va;
  });
  renderProductsTable();
}

/* ============================================================
   SORTABLE HEADERS
============================================================ */
function initSortableHeaders() {
  document.querySelectorAll(".sortable-table th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const col   = th.dataset.col;
      const isAsc = th.dataset.dir !== "asc";
      document.querySelectorAll(".sortable-table th.sortable").forEach(t => {
        t.querySelector("i").className = "fa-solid fa-sort";
        delete t.dataset.dir;
      });
      th.dataset.dir = isAsc ? "asc" : "desc";
      th.querySelector("i").className = isAsc ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
      state.products.sort((a, b) => {
        let va = a[col], vb = b[col];
        if (typeof va === "string") return isAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        return isAsc ? va - vb : vb - va;
      });
      renderProductsTable();
    });
  });
}

/* ============================================================
   DASHBOARD STATS
============================================================ */
function renderDashboardStats() {
  const all      = state.allProducts;
  const totalQty = all.reduce((s, p) => s + p.quantity, 0);
  const lowStock = all.filter(p => p.quantity < CONFIG.LOW_STOCK_THRESHOLD).length;
  const totalVal = all.reduce((s, p) => s + (p.quantity * p.price), 0);

  document.getElementById("stat-total-products").textContent = all.length;
  document.getElementById("stat-total-stock").textContent    = formatNumber(totalQty);
  document.getElementById("stat-low-stock").textContent      = lowStock;
  document.getElementById("stat-total-value").textContent    = "₱" + formatNumber(Math.round(totalVal));
}

/* ============================================================
   LOW STOCK TABLE
============================================================ */
function renderLowStockTable() {
  const lowItems = state.allProducts.filter(p => p.quantity < CONFIG.LOW_STOCK_THRESHOLD);
  const tbody    = document.getElementById("lowStockTableBody");
  const badge    = document.getElementById("alert-count");
  badge.textContent = `${lowItems.length} item${lowItems.length !== 1 ? "s" : ""}`;

  if (!lowItems.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row"><i class="fa-solid fa-check-circle" style="color:var(--success)"></i> All items are sufficiently stocked!</td></tr>`;
    return;
  }
  // Find this part in renderLowStockTable():
const session = getSession(); // Add this to get the role

tbody.innerHTML = lowItems.map(p => {
    // Only show the Restock button if the user is Admin or Staff
    const restockBtn = (session?.role === 'admin' || session?.role === 'staff') 
        ? `<button class="btn btn-primary" style="padding:6px 14px;font-size:12px" onclick="openEditModal(${p.id});navigateTo('products')"><i class="fa-solid fa-plus"></i> Restock</button>`
        : `<span>—</span>`;

    return `
    <tr class="low-stock-row">
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>${escapeHtml(p.category)}</td>
      <td style="color:var(--danger);font-weight:700">${p.quantity}</td>
      <td>${renderStatusBadge(p.quantity)}</td>
      <td>
        ${restockBtn}
      </td>
    </tr>
  `}).join("");
}

/* ============================================================
   CHARTS
============================================================ */
function renderCharts() {
  const all = state.allProducts;
  if (!all.length) { destroyCharts(); return; }

  const top10 = [...all].sort((a, b) => b.quantity - a.quantity).slice(0, 10);

  const barCtx = document.getElementById("barChart");
  if (state.charts.bar) state.charts.bar.destroy();
  state.charts.bar = new Chart(barCtx, {
    type: "bar",
    data: {
      labels: top10.map(p => truncate(p.name, 16)),
      datasets: [{
        label: "Stock Qty",
        data:  top10.map(p => p.quantity),
        backgroundColor: top10.map(p =>
          p.quantity < CONFIG.LOW_STOCK_THRESHOLD  ? "rgba(220,38,38,.75)"  :
          p.quantity < CONFIG.WARN_STOCK_THRESHOLD ? "rgba(217,119,6,.75)"  :
          "rgba(37,99,235,.75)"
        ),
        borderColor: top10.map(p =>
          p.quantity < CONFIG.LOW_STOCK_THRESHOLD  ? "#dc2626" :
          p.quantity < CONFIG.WARN_STOCK_THRESHOLD ? "#d97706" : "#2563eb"
        ),
        borderWidth: 2, borderRadius: 6, borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` Quantity: ${ctx.parsed.y} units` } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: "'DM Sans'" } } },
        y: { beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { font: { family: "'DM Sans'" } } }
      }
    }
  });

  const catGroups = groupBy(all, "category");
  const catLabels = Object.keys(catGroups);
  const catData   = catLabels.map(k => catGroups[k].length);
  const pieColors = ["#2563eb","#0d9488","#7c3aed","#d97706","#dc2626","#16a34a","#0891b2","#6366f1"];

  const pieCtx = document.getElementById("pieChart");
  if (state.charts.pie) state.charts.pie.destroy();
  state.charts.pie = new Chart(pieCtx, {
    type: "doughnut",
    data: {
      labels: catLabels,
      datasets: [{
        data: catData,
        backgroundColor: pieColors.slice(0, catLabels.length),
        borderWidth: 2, borderColor: "#ffffff", hoverOffset: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { font: { family: "'DM Sans'", size: 12 }, padding: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} product${ctx.parsed !== 1 ? "s" : ""}` } }
      }
    }
  });
}

function destroyCharts() {
  Object.values(state.charts).forEach(c => { if (c) c.destroy(); });
  state.charts = {};
}

/* ============================================================
   ANALYTICS
============================================================ */
function renderAnalytics() {
  const all  = state.allProducts;
  const qtys = all.map(p => p.quantity).sort((a, b) => a - b);
  const n    = qtys.length;

  const mean = n ? (qtys.reduce((s, v) => s + v, 0) / n) : 0;
  let median = 0;
  if (n) { median = n % 2 === 0 ? (qtys[n/2-1] + qtys[n/2]) / 2 : qtys[Math.floor(n/2)]; }

  const freqMap = {};
  qtys.forEach(v => { freqMap[v] = (freqMap[v] || 0) + 1; });
  let mode = 0, maxFreq = 0;
  Object.entries(freqMap).forEach(([v, f]) => { if (f > maxFreq) { maxFreq = f; mode = +v; } });

  const lowCount = all.filter(p => p.quantity < CONFIG.LOW_STOCK_THRESHOLD).length;
  const lowPct   = n ? ((lowCount / n) * 100).toFixed(1) : 0;

  document.getElementById("ana-mean").textContent   = mean.toFixed(1);
  document.getElementById("ana-median").textContent = median;
  document.getElementById("ana-mode").textContent   = mode;
  document.getElementById("ana-lowpct").textContent = `${lowPct}%`;

  const decisionList = document.getElementById("decisionList");
  if (!all.length) {
    decisionList.innerHTML = `<p class="empty-text">Add products to see recommendations.</p>`;
  } else {
    const sorted = [...all].sort((a, b) => a.quantity - b.quantity).slice(0, 8);
    decisionList.innerHTML = sorted.map(p => {
      const restock = p.quantity < CONFIG.LOW_STOCK_THRESHOLD;
      return `
        <div class="decision-item">
          <div>
            <span class="item-name">${escapeHtml(p.name)}</span>
            <span class="item-qty"> — ${p.quantity} units</span>
          </div>
          <span class="restock-badge ${restock ? "restock-yes" : "restock-no"}">
            <i class="fa-solid ${restock ? "fa-arrow-up-right-dots" : "fa-check"}"></i>
            ${restock ? "Restock" : "Do Not Restock"}
          </span>
        </div>`;
    }).join("");
  }

  const prob    = n ? (lowCount / n) : 0;
  const probPct = (prob * 100).toFixed(1);
  document.getElementById("probBar").style.width = `${probPct}%`;
  document.getElementById("probVal").textContent = `${probPct}%`;

  let explanation = "";
  if (prob === 0)      explanation = "No items are currently at low stock. Inventory appears healthy.";
  else if (prob < 0.2) explanation = `${probPct}% chance of stock runout. Low risk — monitor a few items.`;
  else if (prob < 0.5) explanation = `${probPct}% probability of runout. Moderate risk — consider restocking soon.`;
  else                 explanation = `${probPct}% probability of runout. HIGH RISK — immediate restocking is recommended!`;
  document.getElementById("probExplanation").textContent = explanation;

  const ranges = [
    { label: "Critical (0–9)",   min: 0,   max: 9   },
    { label: "Low (10–24)",      min: 10,  max: 24  },
    { label: "Moderate (25–49)", min: 25,  max: 49  },
    { label: "Adequate (50–99)", min: 50,  max: 99  },
    { label: "High (100+)",      min: 100, max: Infinity }
  ];

  let cumulative = 0;
  const freqBody = document.getElementById("freqTableBody");
  if (!n) {
    freqBody.innerHTML = `<tr><td colspan="5" class="empty-row">No data available</td></tr>`;
  } else {
    freqBody.innerHTML = ranges.map(r => {
      const freq    = qtys.filter(q => q >= r.min && q <= r.max).length;
      const relFreq = ((freq / n) * 100).toFixed(1);
      cumulative   += freq;
      const barW    = relFreq > 0 ? Math.max(4, +relFreq) : 0;
      const barColor = r.min === 0 ? "#dc2626" : r.min === 10 ? "#d97706" : "#2563eb";
      return `
        <tr>
          <td><strong>${r.label}</strong></td>
          <td>${freq}</td>
          <td>${relFreq}%</td>
          <td>${cumulative}</td>
          <td>
            <div style="background:#f1f5f9;border-radius:20px;height:10px;overflow:hidden;min-width:80px">
              <div style="width:${barW}%;height:100%;background:${barColor};border-radius:20px"></div>
            </div>
          </td>
        </tr>`;
    }).join("");
  }

  renderAnalyticsCharts();
}

function renderAnalyticsCharts() {
  const all = state.allProducts;
  if (!all.length) return;

  const catGroups = groupBy(all, "category");
  const catLabels = Object.keys(catGroups);
  const catAvgs   = catLabels.map(k => {
    const qtys = catGroups[k].map(p => p.quantity);
    return +(qtys.reduce((s, v) => s + v, 0) / qtys.length).toFixed(1);
  });

  const catCtx = document.getElementById("categoryChart");
  if (state.charts.category) state.charts.category.destroy();
  state.charts.category = new Chart(catCtx, {
    type: "bar",
    data: {
      labels: catLabels,
      datasets: [{
        label: "Avg Stock",
        data:  catAvgs,
        backgroundColor: "rgba(99,102,241,.7)",
        borderColor: "#6366f1",
        borderWidth: 2, borderRadius: 6, borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: "'DM Sans'" } } },
        y: { beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { font: { family: "'DM Sans'" } } }
      }
    }
  });

  const distRanges = [
    { label: "Critical (<10)",   count: all.filter(p => p.quantity < 10).length,                      color: "#dc2626" },
    { label: "Low (10–24)",      count: all.filter(p => p.quantity >= 10 && p.quantity < 25).length,   color: "#d97706" },
    { label: "Moderate (25–49)",count: all.filter(p => p.quantity >= 25 && p.quantity < 50).length,    color: "#0891b2" },
    { label: "Adequate (50+)",  count: all.filter(p => p.quantity >= 50).length,                       color: "#16a34a" }
  ];

  const distCtx = document.getElementById("distChart");
  if (state.charts.dist) state.charts.dist.destroy();
  state.charts.dist = new Chart(distCtx, {
    type: "doughnut",
    data: {
      labels: distRanges.map(r => r.label),
      datasets: [{
        data:            distRanges.map(r => r.count),
        backgroundColor: distRanges.map(r => r.color),
        borderWidth: 2, borderColor: "#ffffff", hoverOffset: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { font: { family: "'DM Sans'", size: 12 }, padding: 10, usePointStyle: true } }
      }
    }
  });
}

/* ============================================================
   USERS TABLE
============================================================ */
function renderUsersTable() {
  const tbody = document.getElementById("usersTableBody");
  tbody.innerHTML = "";
  const data = state.users;
  document.getElementById("userRecordCount").textContent = `${data.length} record${data.length !== 1 ? "s" : ""}`;

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row"><i class="fa-solid fa-users"></i> No users found</td></tr>`;
    return;
  }

  data.forEach((u, idx) => {
    const tr = document.createElement("tr");
    const roleBadge = getRoleBadge(u.role);
    const statusBadge = u.is_active
      ? `<span class="status-badge status-ok"><i class="fa-solid fa-circle-check"></i> Active</span>`
      : `<span class="status-badge status-low"><i class="fa-solid fa-circle-xmark"></i> Inactive</span>`;

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><strong>${escapeHtml(u.username)}</strong></td>
      <td>${escapeHtml(u.full_name || "—")}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${roleBadge}</td>
      <td>${statusBadge}</td>
      <td>${u.last_login ? new Date(u.last_login).toLocaleString("en-PH") : "Never"}</td>
      <td>${u.createdAt || "—"}</td>
      <td>
        <div class="action-btns">
          <button class="icon-btn edit"   title="Edit"   onclick="openEditUserModal(${u.id})"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn delete" title="Delete" onclick="openDeleteModal(${u.id}, 'user')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });
}

function getRoleBadge(role) {
  const map = {
    admin:  `<span class="status-badge" style="background:#dbeafe;color:#1d4ed8"><i class="fa-solid fa-shield-halved"></i> Admin</span>`,
    staff:  `<span class="status-badge" style="background:#d1fae5;color:#065f46"><i class="fa-solid fa-user-gear"></i> Staff</span>`,
    viewer: `<span class="status-badge" style="background:#f1f5f9;color:#475569"><i class="fa-solid fa-eye"></i> Viewer</span>`
  };
  return map[role] || `<span class="status-badge">${escapeHtml(role)}</span>`;
}

function filterUsers() {
  const query  = document.getElementById("userSearchInput").value.toLowerCase().trim();
  const role   = document.getElementById("filterRole").value;
  const status = document.getElementById("filterStatus").value;

  state.users = state.allUsers.filter(u => {
    const matchQ = !query || u.username.toLowerCase().includes(query) ||
                   (u.full_name || "").toLowerCase().includes(query) ||
                   u.email.toLowerCase().includes(query);
    const matchR = !role   || u.role === role;
    const matchS = status === "" || String(u.is_active ? 1 : 0) === status;
    return matchQ && matchR && matchS;
  });
  renderUsersTable();
}

/* ============================================================
   USERS CRUD — MODAL
============================================================ */
function openAddUserModal() {
  state.editingUserId = null;
  document.getElementById("userModalTitle").innerHTML = '<i class="fa-solid fa-user-plus"></i> Add New User';
  document.getElementById("userForm").reset();
  document.getElementById("editUserId").value = "";
  document.getElementById("pwHint").textContent = "(required for new user)";
  clearUserFormErrors();
  document.getElementById("userModal").classList.add("open");
}

function openEditUserModal(id) {
  const user = state.allUsers.find(u => u.id === id);
  if (!user) return;
  state.editingUserId = id;
  document.getElementById("userModalTitle").innerHTML = '<i class="fa-solid fa-pen"></i> Edit User';
  document.getElementById("editUserId").value   = id;
  document.getElementById("fuUsername").value   = user.username;
  document.getElementById("fuEmail").value      = user.email;
  document.getElementById("fuFullName").value   = user.full_name || "";
  document.getElementById("fuStatus").value     = user.is_active ? "1" : "0";
  document.getElementById("fuPassword").value   = "";
  document.getElementById("pwHint").textContent = "(leave blank to keep current)";

  // Set role
  const roleObj = state.roles.find(r => r.name === user.role);
  document.getElementById("fuRole").value = roleObj ? roleObj.id : "";

  clearUserFormErrors();
  document.getElementById("userModal").classList.add("open");
}

function closeUserModal() {
  document.getElementById("userModal").classList.remove("open");
  state.editingUserId = null;
}

async function saveUser() {
  if (!validateUserForm()) return;

  const data = {
    username:  document.getElementById("fuUsername").value.trim(),
    email:     document.getElementById("fuEmail").value.trim(),
    full_name: document.getElementById("fuFullName").value.trim(),
    role_id:   parseInt(document.getElementById("fuRole").value),
    is_active: parseInt(document.getElementById("fuStatus").value),
    password:  document.getElementById("fuPassword").value || undefined
  };

  try {
    if (state.editingUserId) {
      await updateUser(state.editingUserId, data);
      showToast("User updated successfully!", "success");
    } else {
      await addUser(data);
      showToast("User added successfully!", "success");
    }
    await loadAllUsers();
    renderUsersTable();
    updateNavBadge();
    closeUserModal();
  } catch (err) {
    showToast("Error saving user: " + err.message, "error");
  }
}

function validateUserForm() {
  clearUserFormErrors();
  let valid = true;
  const username = document.getElementById("fuUsername").value.trim();
  const email    = document.getElementById("fuEmail").value.trim();
  const role     = document.getElementById("fuRole").value;
  const password = document.getElementById("fuPassword").value;

  if (!username) { setUserError("fuUsername", "err-fuUsername", "Username is required."); valid = false; }
  if (!email || !email.includes("@")) { setUserError("fuEmail", "err-fuEmail", "Valid email is required."); valid = false; }
  if (!role) { setUserError("fuRole", "err-fuRole", "Please select a role."); valid = false; }
  if (!state.editingUserId && !password) { setUserError("fuPassword", "err-fuPassword", "Password is required for new users."); valid = false; }

  return valid;
}

function setUserError(inputId, errorId, msg) {
  document.getElementById(inputId).classList.add("error");
  document.getElementById(errorId).textContent = msg;
}

function clearUserFormErrors() {
  ["fuUsername","fuEmail","fuRole","fuPassword"].forEach(id => {
    const el = document.getElementById(id); if (el) el.classList.remove("error");
  });
  ["err-fuUsername","err-fuEmail","err-fuRole","err-fuPassword"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = "";
  });
}

/* ============================================================
   LOGS TABLE
============================================================ */
function renderLogsTable() {
  const tbody = document.getElementById("logsTableBody");
  tbody.innerHTML = "";
  const data = state.logs;
  document.getElementById("logRecordCount").textContent = `${data.length} record${data.length !== 1 ? "s" : ""}`;

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row">No logs found</td></tr>`;
    return;
  }

  data.forEach((log, idx) => {
    const tr = document.createElement("tr");
    const change    = (log.qty_after !== null && log.qty_before !== null) ? log.qty_after - log.qty_before : null;
    const changeStr = change !== null ? (change >= 0 ? `<span style="color:var(--success)">+${change}</span>` : `<span style="color:var(--danger)">${change}</span>`) : "—";
    const actionBadge = getActionBadge(log.action);

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><strong>${escapeHtml(log.product_name || "—")}</strong></td>
      <td>${actionBadge}</td>
      <td>${log.qty_before !== null ? log.qty_before : "—"}</td>
      <td>${log.qty_after  !== null ? log.qty_after  : "—"}</td>
      <td>${changeStr}</td>
      <td>${log.changed_by_name ? escapeHtml(log.changed_by_name) : (log.changed_by_username ? escapeHtml(log.changed_by_username) : "System")}</td>
      <td><small>${escapeHtml(log.note || "—")}</small></td>
      <td><small>${log.loggedAt || "—"}</small></td>`;
    tbody.appendChild(tr);
  });
}

function getActionBadge(action) {
  const map = {
    ADD:    `<span class="status-badge status-ok"><i class="fa-solid fa-plus"></i> ADD</span>`,
    UPDATE: `<span class="status-badge" style="background:#dbeafe;color:#1d4ed8"><i class="fa-solid fa-pen"></i> UPDATE</span>`,
    RESTOCK:`<span class="status-badge" style="background:#d1fae5;color:#065f46"><i class="fa-solid fa-arrow-up"></i> RESTOCK</span>`,
    DELETE: `<span class="status-badge status-low"><i class="fa-solid fa-trash"></i> DELETE</span>`,
    ADJUST: `<span class="status-badge status-warning"><i class="fa-solid fa-sliders"></i> ADJUST</span>`
  };
  return map[action] || `<span class="status-badge">${escapeHtml(action)}</span>`;
}

function filterLogs() {
  const query  = document.getElementById("logSearchInput").value.toLowerCase().trim();
  const action = document.getElementById("filterLogAction").value;

  state.logs = state.allLogs.filter(l => {
    const matchQ = !query || (l.product_name || "").toLowerCase().includes(query) ||
                   (l.note || "").toLowerCase().includes(query) ||
                   (l.changed_by_name || "").toLowerCase().includes(query);
    const matchA = !action || l.action === action;
    return matchQ && matchA;
  });
  renderLogsTable();
}

/* ============================================================
   LOG ENTRY MODAL (manual)
============================================================ */
function openAddLogModal() {
  // --- NEW: Block viewers from adding logs ---
  const session = getSession();
  if (session?.role === 'viewer') {
    showToast("Access Denied: Viewers cannot add logs.", "error");
    return;
  }
  // -------------------------------------------

  document.getElementById("logForm").reset();
  document.getElementById("logModal").classList.add("open");
}

function closeLogModal() {
  document.getElementById("logModal").classList.remove("open");
}

async function saveLogEntry() {
  const productId = document.getElementById("flProduct").value;
  if (!productId) {
    document.getElementById("err-flProduct").textContent = "Please select a product.";
    document.getElementById("flProduct").classList.add("error");
    return;
  }
  document.getElementById("err-flProduct").textContent = "";
  document.getElementById("flProduct").classList.remove("error");

  const session = getSession();
  const data = {
    product_id: parseInt(productId),
    changed_by: session?.id || null,
    action:     document.getElementById("flAction").value,
    qty_before: document.getElementById("flQtyBefore").value !== "" ? parseInt(document.getElementById("flQtyBefore").value) : null,
    qty_after:  document.getElementById("flQtyAfter").value  !== "" ? parseInt(document.getElementById("flQtyAfter").value)  : null,
    note:       document.getElementById("flNote").value.trim() || null
  };

  try {
    await addLog(data);
    showToast("Log entry saved!", "success");
    closeLogModal();
    await loadLogsPage();
  } catch (err) {
    showToast("Error saving log: " + err.message, "error");
  }
}

/* ============================================================
   CRUD — PRODUCTS MODAL
============================================================ */
function openAddModal() {
  // --- NEW: Block viewers from opening the modal ---
  const session = getSession();
  if (session?.role === 'viewer') {
    showToast("Access Denied: Viewers cannot add products.", "error");
    return; // Stops the function from running
  }
  // -------------------------------------------------

  state.editingId = null;
  document.getElementById("modalTitle").innerHTML = '<i class="fa-solid fa-plus"></i> Add New Product';
  document.getElementById("productForm").reset();
  document.getElementById("editId").value = "";
  clearFormErrors();
  document.getElementById("productModal").classList.add("open");
}

function openEditModal(id) {
  const product = state.allProducts.find(p => p.id === id);
  if (!product) return;
  state.editingId = id;
  document.getElementById("modalTitle").innerHTML = '<i class="fa-solid fa-pen"></i> Edit Product';
  document.getElementById("editId").value    = id;
  document.getElementById("fname").value     = product.name;
  document.getElementById("fcategory").value = product.category_id;
  document.getElementById("fquantity").value = product.quantity;
  document.getElementById("fprice").value    = product.price;
  document.getElementById("fdesc").value     = product.description || "";
  clearFormErrors();
  document.getElementById("productModal").classList.add("open");
}

function closeModal() {
  document.getElementById("productModal").classList.remove("open");
  state.editingId = null;
}

async function saveProduct() {
  if (!validateForm()) return;
  const session = getSession();
  const formData = {
    name:        document.getElementById("fname").value.trim(),
    category_id: parseInt(document.getElementById("fcategory").value),
    quantity:    parseInt(document.getElementById("fquantity").value),
    price:       parseFloat(document.getElementById("fprice").value),
    description: document.getElementById("fdesc").value.trim(),
    added_by:    session?.id || null,
    updated_by:  session?.id || null
  };

  try {
    if (state.editingId) {
      await updateProduct(state.editingId, formData);
      showToast("Product updated successfully!", "success");
    } else {
      await addProduct(formData);
      showToast("Product added successfully!", "success");
    }
    await loadAllProducts();
    await loadLogsPage();
    renderAll();
    closeModal();
  } catch (err) {
    showToast("Error saving product: " + err.message, "error");
  }
}

/* ============================================================
   CRUD — DELETE (generic for product & user)
============================================================ */
function openDeleteModal(id, type) {
  state.deleteTargetId   = id;
  state.deleteTargetType = type;

  if (type === "product") {
    const item = state.allProducts.find(p => p.id === id);
    document.getElementById("deleteModalLabel").textContent = "Product";
    document.getElementById("deleteName").textContent = item ? item.name : id;
  } else if (type === "user") {
    const item = state.allUsers.find(u => u.id === id);
    document.getElementById("deleteModalLabel").textContent = "User";
    document.getElementById("deleteName").textContent = item ? item.username : id;
  }

  document.getElementById("deleteModal").classList.add("open");
}

function closeDeleteModal() {
  document.getElementById("deleteModal").classList.remove("open");
  state.deleteTargetId   = null;
  state.deleteTargetType = null;
}

async function confirmDelete() {
  if (!state.deleteTargetId) return;
  try {
    if (state.deleteTargetType === "product") {
      await deleteProduct(state.deleteTargetId);
      await loadAllProducts();
      await loadLogsPage();
      renderAll();
      showToast("Product deleted successfully.", "warning");
    } else if (state.deleteTargetType === "user") {
      await deleteUser(state.deleteTargetId);
      await loadAllUsers();
      renderUsersTable();
      updateNavBadge();
      showToast("User deleted successfully.", "warning");
    }
    closeDeleteModal();
  } catch (err) {
    showToast("Error deleting: " + err.message, "error");
  }
}

/* ============================================================
   FORM VALIDATION — PRODUCTS
============================================================ */
function validateForm() {
  clearFormErrors();
  let valid = true;
  const name     = document.getElementById("fname").value.trim();
  const category = document.getElementById("fcategory").value;
  const quantity = document.getElementById("fquantity").value;
  const price    = document.getElementById("fprice").value;

  if (!name)            { setError("fname", "err-fname", "Product name is required."); valid = false; }
  else if (name.length < 2) { setError("fname", "err-fname", "Name must be at least 2 characters."); valid = false; }
  if (!category)        { setError("fcategory", "err-fcategory", "Please select a category."); valid = false; }
  if (quantity === "" || isNaN(quantity)) { setError("fquantity", "err-fquantity", "Quantity must be a number."); valid = false; }
  else if (parseInt(quantity) < 0)        { setError("fquantity", "err-fquantity", "Quantity cannot be negative."); valid = false; }
  if (price === "" || isNaN(price))       { setError("fprice", "err-fprice", "Price must be a number."); valid = false; }
  else if (parseFloat(price) < 0)         { setError("fprice", "err-fprice", "Price cannot be negative."); valid = false; }

  return valid;
}

function setError(inputId, errorId, message) {
  document.getElementById(inputId).classList.add("error");
  document.getElementById(errorId).textContent = message;
}

function clearFormErrors() {
  ["fname","fcategory","fquantity","fprice"].forEach(id => {
    const el = document.getElementById(id); if (el) el.classList.remove("error");
  });
  ["err-fname","err-fcategory","err-fquantity","err-fprice"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = "";
  });
}

/* ============================================================
   TOAST
============================================================ */
let toastTimer = null;

function showToast(message, type = "success") {
  const toast  = document.getElementById("toast");
  const iconEl = document.getElementById("toastIcon");
  const msgEl  = document.getElementById("toastMsg");
  const icons  = { success: "fa-solid fa-circle-check", error: "fa-solid fa-circle-xmark", warning: "fa-solid fa-triangle-exclamation" };

  toast.className   = `toast ${type} show`;
  iconEl.className  = `toast-icon ${icons[type] || icons.success}`;
  msgEl.textContent = message;

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove("show"); }, 3000);
}

/* ============================================================
   UTILITY FUNCTIONS
============================================================ */
function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key]; if (!acc[k]) acc[k] = []; acc[k].push(item); return acc;
  }, {});
}

function formatNumber(n) { return Number(n).toLocaleString("en-PH", { maximumFractionDigits: 2 }); }
function truncate(str, max) { return str.length > max ? str.slice(0, max - 1) + "…" : str; }
function escapeHtml(str) { const d = document.createElement("div"); d.textContent = str; return d.innerHTML; }

async function refreshAll() {
  state.categories = await fetchCategories().catch(() => state.categories);
  state.roles      = await fetchRoles().catch(() => state.roles);
  await loadAllProducts();
  await loadAllUsers();
  await loadLogsPage();
  renderAll();
  showToast("Data refreshed.", "success");
}

/* ============================================================
   MODAL OVERLAY CLICK TO CLOSE
============================================================ */
document.getElementById("productModal").addEventListener("click", function(e) { if (e.target === this) closeModal(); });
document.getElementById("deleteModal").addEventListener("click",  function(e) { if (e.target === this) closeDeleteModal(); });
document.getElementById("logoutModal").addEventListener("click",  function(e) { if (e.target === this) closeLogoutModal(); });
document.getElementById("userModal").addEventListener("click",    function(e) { if (e.target === this) closeUserModal(); });
document.getElementById("logModal").addEventListener("click",     function(e) { if (e.target === this) closeLogModal(); });

/* ============================================================
   KEYBOARD SHORTCUTS
============================================================ */
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeModal(); closeDeleteModal(); closeLogoutModal(); closeUserModal(); closeLogModal(); }
  
  if ((e.ctrlKey || e.metaKey) && e.key === "n") { 
    e.preventDefault(); 
    const session = getSession();
    // NEW: Only open if they are logged in AND not a viewer
    if (session && session.role !== 'viewer') {
      openAddModal(); 
    }
  }
});