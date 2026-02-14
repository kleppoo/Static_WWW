/**
 * app.js — Main admin panel application (multi-tenant)
 *
 * Detects user role from JWT:
 *   - superadmin: sees "Firmy" tab (tenants CRUD + user management) + "Baterie" tab (all tenants)
 *   - tenant user: sees only "Baterie" tab (own tenant only)
 */

const app = (() => {
  let userRole = null;       // "superadmin" | "tenant"
  let userTenantId = null;   // tenant user's own tenant or selected tenant for superadmin
  let editingCode = null;
  let editingTenantId = null;
  let currentDetailTenantId = null;
  let tenantsCache = [];     // cached tenant list for superadmin

  // ── Initialize ──

  async function init() {
    const cfg = window.BATTERY_CONFIG;
    if (!cfg) {
      document.body.innerHTML = "<p style='padding:2rem;color:red'>Brak pliku config.js.</p>";
      return;
    }

    Auth.configure({ region: cfg.region, userPoolId: cfg.userPoolId, clientId: cfg.clientId });
    API.configure({ apiUrl: cfg.apiUrl });

    if (Auth.isLoggedIn()) {
      showApp();
    } else {
      showLogin();
    }

    document.getElementById("login-form").addEventListener("submit", handleLogin);
    document.getElementById("new-password-form").addEventListener("submit", handleNewPassword);
    document.getElementById("battery-form").addEventListener("submit", handleBatterySave);
    document.getElementById("tenant-form").addEventListener("submit", handleTenantSave);
    document.getElementById("user-form").addEventListener("submit", handleUserCreate);
  }

  // ── Login ──

  function showLogin() {
    document.getElementById("login-screen").hidden = false;
    document.getElementById("app-screen").hidden = true;
  }

  function showApp() {
    document.getElementById("login-screen").hidden = true;
    document.getElementById("app-screen").hidden = false;

    const claims = Auth.getClaims();
    const email = claims.email || claims.sub || "";
    const groups = claims["cognito:groups"] || [];
    const isSuperadmin = groups.includes("superadmin");

    userRole = isSuperadmin ? "superadmin" : "tenant";
    userTenantId = claims["custom:tenantId"] || null;

    document.getElementById("user-email").textContent = email;

    const roleBadge = document.getElementById("header-role");
    if (isSuperadmin) {
      roleBadge.textContent = "Super Admin";
      roleBadge.className = "role-badge role-superadmin";
    } else {
      roleBadge.textContent = userTenantId || "tenant";
      roleBadge.className = "role-badge role-tenant";
    }

    if (isSuperadmin) {
      document.getElementById("nav-tabs").hidden = false;
      document.getElementById("battery-tenant-select").hidden = false;
      switchTab("tenants");
    } else {
      document.getElementById("nav-tabs").hidden = true;
      document.getElementById("battery-tenant-select").hidden = true;
      switchTab("batteries");
    }
  }

  let _loginEmail = "";

  async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const errorEl = document.getElementById("login-error");
    errorEl.hidden = true;

    try {
      const result = await Auth.signIn(email, password);
      if (result.challenge === "NEW_PASSWORD_REQUIRED") {
        _loginEmail = email;
        document.getElementById("login-form").hidden = true;
        document.getElementById("new-password-form").hidden = false;
        return;
      }
      showApp();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function handleNewPassword(e) {
    e.preventDefault();
    const newPwd = document.getElementById("new-password").value;
    const errorEl = document.getElementById("new-password-error");
    errorEl.hidden = true;
    try {
      await Auth.completeNewPassword(_loginEmail, newPwd);
      showApp();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  function logout() {
    Auth.signOut();
    showLogin();
    document.getElementById("login-form").hidden = false;
    document.getElementById("new-password-form").hidden = true;
    document.getElementById("login-form").reset();
  }

  // ── Tab switching ──

  function switchTab(tab) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    document.getElementById("tab-tenants").hidden = tab !== "tenants";
    document.getElementById("tab-batteries").hidden = tab !== "batteries";

    if (tab === "tenants") {
      loadTenants();
    } else if (tab === "batteries") {
      if (userRole === "superadmin") {
        loadTenantSelector();
      } else {
        loadBatteries(userTenantId);
      }
    }
  }

  // ══════════════════════════════════════════════
  //  TENANTS TAB (superadmin only)
  // ══════════════════════════════════════════════

  async function loadTenants() {
    const container = document.getElementById("tenant-list");
    container.innerHTML = '<p class="loading">Ładowanie...</p>';
    showView("tenant", "list");

    try {
      const data = await API.listTenants();
      tenantsCache = data.tenants || [];

      if (tenantsCache.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>Brak firm</h3><p>Kliknij „+ Nowa firma" aby dodać pierwszą.</p></div>';
        return;
      }

      container.innerHTML = tenantsCache.map((t) => `
        <div class="card">
          <div class="card-info">
            <h3>${esc(t.name)}</h3>
            <p>ID: <strong>${esc(t.tenantId)}</strong> · ${esc(t.contactEmail || "—")}</p>
          </div>
          <div class="card-actions">
            <button class="btn btn-sm" onclick="app.showTenantDetail('${escAttr(t.tenantId)}')">Szczegóły</button>
            <button class="btn btn-sm" onclick="app.editTenant('${escAttr(t.tenantId)}')">Edytuj</button>
            <button class="btn btn-sm btn-danger" onclick="app.deleteTenant('${escAttr(t.tenantId)}')">Usuń</button>
          </div>
        </div>`).join("");
    } catch (err) {
      container.innerHTML = `<p class="error">Błąd: ${esc(err.message)}</p>`;
    }
  }

  // ── Tenant editor ──

  function showTenantEditor(tenantId) {
    editingTenantId = tenantId || null;
    document.getElementById("tenant-editor-title").textContent = tenantId ? `Edytuj: ${tenantId}` : "Nowa firma";
    document.getElementById("t-id").disabled = !!tenantId;
    document.getElementById("tenant-form").reset();
    showView("tenant", "editor");

    if (tenantId) {
      const t = tenantsCache.find((x) => x.tenantId === tenantId);
      if (t) {
        setVal("t-id", t.tenantId);
        setVal("t-name", t.name);
        setVal("t-email", t.contactEmail);
        setVal("t-notes", t.notes);
      }
    }
  }

  function hideTenantEditor() {
    editingTenantId = null;
    showView("tenant", "list");
    loadTenants();
  }

  function editTenant(tenantId) {
    showTenantEditor(tenantId);
  }

  async function handleTenantSave(e) {
    e.preventDefault();
    const payload = {
      id: getVal("t-id"),
      name: getVal("t-name"),
      contactEmail: getVal("t-email"),
      notes: getVal("t-notes"),
    };

    try {
      if (editingTenantId) {
        await API.updateTenant(editingTenantId, payload);
        toast("Firma zaktualizowana", "success");
      } else {
        await API.createTenant(payload);
        toast("Firma utworzona", "success");
      }
      hideTenantEditor();
    } catch (err) {
      toast("Błąd: " + err.message, "error");
    }
  }

  async function deleteTenant(tenantId) {
    if (!confirm(`Usunąć firmę "${tenantId}"?`)) return;
    try {
      await API.deleteTenant(tenantId);
      toast("Firma usunięta", "success");
      loadTenants();
    } catch (err) {
      toast("Błąd: " + err.message, "error");
    }
  }

  // ── Tenant detail (users) ──

  async function showTenantDetail(tenantId) {
    currentDetailTenantId = tenantId;
    showView("tenant", "detail");
    document.getElementById("tenant-detail-title").textContent = `Firma: ${tenantId}`;

    // Load tenant info
    try {
      const data = await API.getTenant(tenantId);
      const t = data.tenant;
      document.getElementById("tenant-detail-info").innerHTML = `
        <div class="detail-grid">
          <div class="detail-item"><label>ID</label><span>${esc(t.tenantId)}</span></div>
          <div class="detail-item"><label>Nazwa</label><span>${esc(t.name)}</span></div>
          <div class="detail-item"><label>E-mail</label><span>${esc(t.contactEmail || "—")}</span></div>
          <div class="detail-item"><label>Baterie</label><span>${t.batteryCount || 0}</span></div>
          <div class="detail-item"><label>Utworzona</label><span>${esc(t.createdAt?.slice(0, 10) || "—")}</span></div>
        </div>`;
    } catch (err) {
      document.getElementById("tenant-detail-info").innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }

    loadTenantUsers(tenantId);
  }

  function hideTenantDetail() {
    currentDetailTenantId = null;
    hideUserForm();
    showView("tenant", "list");
    loadTenants();
  }

  async function loadTenantUsers(tenantId) {
    const container = document.getElementById("tenant-users-list");
    container.innerHTML = '<p class="loading">Ładowanie...</p>';

    try {
      const data = await API.listTenantUsers(tenantId);
      const users = data.users || [];

      if (users.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Brak użytkowników</p></div>';
        return;
      }

      container.innerHTML = users.map((u) => {
        const fmtDate = (d) => d ? new Date(d).toLocaleString("pl-PL", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
        const emailIcon = u.emailVerified ? "✅" : "❌";
        const emailSentLabel = u.emailSent 
          ? "Tak (oczekuje na zmianę hasła)" 
          : "Nie (hasło ustawione serwisowo)";
        const statusClass = (u.status || "").toLowerCase().replace(/_/g, "-");

        return `
        <div class="card user-card">
          <div class="card-info">
            <h3>${esc(u.email)}</h3>
            <p>${esc(u.givenName || "")} ${esc(u.familyName || "")} · 
              <span class="status-badge status-${statusClass}">${esc(u.status)}</span>
              ${(u.groups || []).length ? u.groups.map(g => `<span class="role-badge">${esc(g)}</span>`).join(" ") : ""}
            </p>
            <div class="user-details-grid">
              <div class="user-detail-item">
                <span class="detail-label">Email wysłany:</span>
                <span class="detail-value">${emailSentLabel}</span>
              </div>
              <div class="user-detail-item">
                <span class="detail-label">Email potwierdzony:</span>
                <span class="detail-value">${emailIcon} ${u.emailVerified ? "Tak" : "Nie"}</span>
              </div>
              <div class="user-detail-item">
                <span class="detail-label">Data utworzenia:</span>
                <span class="detail-value">${fmtDate(u.createdAt)}</span>
              </div>
              <div class="user-detail-item">
                <span class="detail-label">Ostatnia zmiana:</span>
                <span class="detail-value">${fmtDate(u.lastModifiedAt)}</span>
              </div>
              <div class="user-detail-item">
                <span class="detail-label">Ostatnie logowanie:</span>
                <span class="detail-value">${u.lastLoginAt ? fmtDate(u.lastLoginAt) : '<span style="color:#9ca3af">Nigdy</span>'}</span>
              </div>
            </div>
          </div>
          <div class="card-actions">
            <button class="btn btn-sm btn-danger" onclick="app.deleteUser('${escAttr(tenantId)}','${escAttr(u.username)}')">Usuń</button>
          </div>
        </div>`;
      }).join("");
    } catch (err) {
      container.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  }

  function showUserForm() {
    document.getElementById("user-form-container").hidden = false;
    document.getElementById("user-form").reset();
  }

  function hideUserForm() {
    document.getElementById("user-form-container").hidden = true;
  }

  async function handleUserCreate(e) {
    e.preventDefault();
    const payload = {
      email: getVal("u-email"),
      givenName: getVal("u-givenName"),
      familyName: getVal("u-familyName"),
    };

    try {
      await API.createTenantUser(currentDetailTenantId, payload);
      toast(`Użytkownik ${payload.email} utworzony. Hasło tymczasowe wysłane na e-mail.`, "success");
      hideUserForm();
      loadTenantUsers(currentDetailTenantId);
    } catch (err) {
      toast("Błąd: " + err.message, "error");
    }
  }

  async function deleteUser(tenantId, userId) {
    if (!confirm("Usunąć tego użytkownika?")) return;
    try {
      await API.deleteTenantUser(tenantId, userId);
      toast("Użytkownik usunięty", "success");
      loadTenantUsers(tenantId);
    } catch (err) {
      toast("Błąd: " + err.message, "error");
    }
  }

  // ── View helper for tenants section ──

  function showView(section, view) {
    if (section === "tenant") {
      document.getElementById("tenant-list-view").hidden = view !== "list";
      document.getElementById("tenant-editor-view").hidden = view !== "editor";
      document.getElementById("tenant-detail-view").hidden = view !== "detail";
    } else if (section === "battery") {
      document.getElementById("battery-list-view").hidden = view !== "list";
      document.getElementById("battery-editor-view").hidden = view !== "editor";
    }
  }

  // ══════════════════════════════════════════════
  //  BATTERIES TAB
  // ══════════════════════════════════════════════

  async function loadTenantSelector() {
    const select = document.getElementById("battery-tenant-select");
    select.innerHTML = '<option value="">— wybierz firmę —</option>';

    try {
      if (tenantsCache.length === 0) {
        const data = await API.listTenants();
        tenantsCache = data.tenants || [];
      }

      for (const t of tenantsCache) {
        const opt = document.createElement("option");
        opt.value = t.tenantId;
        opt.textContent = `${t.name} (${t.tenantId})`;
        select.appendChild(opt);
      }

      const container = document.getElementById("battery-list");
      container.innerHTML = '<div class="empty-state"><p>Wybierz firmę z listy powyżej</p></div>';
    } catch (err) {
      toast("Błąd ładowania firm: " + err.message, "error");
    }
  }

  function onTenantSelectChange() {
    const tenantId = document.getElementById("battery-tenant-select").value;
    if (tenantId) {
      loadBatteries(tenantId);
    }
  }

  function getActiveTenantId() {
    if (userRole === "superadmin") {
      return document.getElementById("battery-tenant-select").value || null;
    }
    return userTenantId;
  }

  async function loadBatteries(tenantId) {
    if (!tenantId) return;

    const container = document.getElementById("battery-list");
    container.innerHTML = '<p class="loading">Ładowanie...</p>';
    showView("battery", "list");

    try {
      const data = await API.listBatteries(userRole === "superadmin" ? tenantId : null);
      const items = data.items || [];

      if (items.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>Brak baterii</h3><p>Kliknij „+ Nowa bateria" aby dodać pierwszą.</p></div>';
        return;
      }

      container.innerHTML = items.map((b) => {
        const code = b.code || b.data?.page?.code || "?";
        const model = b.data?.battery?.model || "—";
        const brand = b.data?.battery?.brand || "";
        const status = b.publishedAt ? "published" : "draft";
        const statusLabel = b.publishedAt ? "Opublikowana" : "Robocza";
        const cfg = window.BATTERY_CONFIG;

        return `
          <div class="card">
            <div class="card-info">
              <h3>${esc(model)} ${brand ? "— " + esc(brand) : ""}</h3>
              <p>Kod: <strong>${esc(code)}</strong>
                ${b.publishedAt ? ` · <a href="https://${cfg.cloudfrontDomain}/${code}/index.html" target="_blank">Zobacz stronę ↗</a>` : ""}
              </p>
            </div>
            <div class="card-actions">
              <span class="status-badge status-${status}">${statusLabel}</span>
              <button class="btn btn-sm" onclick="app.editBattery('${escAttr(code)}')">Edytuj</button>
              <button class="btn btn-sm btn-success" onclick="app.publishBattery('${escAttr(code)}')">Publikuj</button>
              <button class="btn btn-sm btn-danger" onclick="app.deleteBattery('${escAttr(code)}')">Usuń</button>
            </div>
          </div>`;
      }).join("");
    } catch (err) {
      container.innerHTML = `<p class="error">Błąd: ${esc(err.message)}</p>`;
    }
  }

  // ── Battery editor ──

  function showBatteryEditor(code) {
    const tenantId = getActiveTenantId();
    if (!tenantId) {
      toast("Najpierw wybierz firmę", "error");
      return;
    }

    editingCode = code || null;
    document.getElementById("editor-title").textContent = code ? `Edytuj: ${code}` : "Nowa bateria";
    document.getElementById("f-code").disabled = !!code;
    document.getElementById("battery-form").reset();
    document.getElementById("metrics-left").innerHTML = "";
    document.getElementById("metrics-middle").innerHTML = "";
    document.getElementById("metrics-right").innerHTML = "";
    document.getElementById("documents-list").innerHTML = "";
    showView("battery", "editor");

    if (code) loadBatteryData(code, tenantId);
  }

  async function loadBatteryData(code, tenantId) {
    try {
      const data = await API.getBattery(code, userRole === "superadmin" ? tenantId : null);
      fillBatteryForm(data);
    } catch (err) {
      toast("Błąd ładowania: " + err.message, "error");
    }
  }

  function fillBatteryForm(item) {
    const d = item.data || item;
    const p = d.page || {};
    const b = d.battery || {};
    const m = d.manufacturer || {};
    const eu = d.euResponsibleEntity || {};

    setVal("f-code", p.code || item.code);
    setVal("f-permalink", p.permalink);
    setVal("f-qrValue", p.qrValue);
    setVal("f-model", b.model);
    setVal("f-brand", b.brand);
    setVal("f-chemistry", b.chemistry);
    setVal("f-category", b.category);
    setVal("f-capacity", b.capacity);
    setVal("f-voltage", b.voltage);
    setVal("f-weight", b.weight);
    setVal("f-dimensions", b.dimensions);
    setVal("f-mfr-name", m.name);
    setVal("f-mfr-address", m.address);
    setVal("f-mfr-email", m.email);
    setVal("f-mfr-web", m.web);
    setVal("f-eu-name", eu.name);
    setVal("f-eu-address", eu.address);
    setVal("f-eu-email", eu.email);
    setVal("f-eu-web", eu.web);
    setVal("f-extinguishingAgent", b.extinguishingAgent);

    for (const col of ["left", "middle", "right"]) {
      for (const met of b[col] || []) {
        addMetric(col, met.label, met.value);
      }
    }
    for (const doc of d.documents || []) {
      addDocument(doc.title, doc.url);
    }
    if (d.wasteInfo) setVal("f-wasteInfo", JSON.stringify(d.wasteInfo, null, 2));
    if (d.video) setVal("f-video", JSON.stringify(d.video, null, 2));
  }

  function hideBatteryEditor() {
    editingCode = null;
    showView("battery", "list");
    const tid = getActiveTenantId();
    if (tid) loadBatteries(tid);
  }

  function editBattery(code) {
    showBatteryEditor(code);
  }

  // ── Metric / Document helpers ──

  function addMetric(column, label, value) {
    const container = document.getElementById(`metrics-${column}`);
    container.insertAdjacentHTML("beforeend", `
      <div class="metric-row">
        <div class="field"><input type="text" placeholder="Etykieta" value="${escAttr(label || "")}"></div>
        <div class="field"><input type="text" placeholder="Wartość" value="${escAttr(value || "")}"></div>
        <button type="button" class="btn btn-sm btn-danger" onclick="this.closest('.metric-row').remove()">✕</button>
      </div>`);
  }

  function addDocument(title, url) {
    const container = document.getElementById("documents-list");
    container.insertAdjacentHTML("beforeend", `
      <div class="document-row">
        <div class="field"><input type="text" placeholder="Tytuł" value="${escAttr(title || "")}"></div>
        <div class="field"><input type="url" placeholder="URL" value="${escAttr(url || "")}"></div>
        <button type="button" class="btn btn-sm btn-danger" onclick="this.closest('.document-row').remove()">✕</button>
      </div>`);
  }

  function collectMetrics(containerId) {
    return [...document.querySelectorAll(`#${containerId} .metric-row`)].map((row) => {
      const inputs = row.querySelectorAll("input");
      return { label: inputs[0].value.trim(), value: inputs[1].value.trim() };
    }).filter((m) => m.label || m.value);
  }

  function collectDocuments() {
    return [...document.querySelectorAll("#documents-list .document-row")].map((row) => {
      const inputs = row.querySelectorAll("input");
      return { title: inputs[0].value.trim(), url: inputs[1].value.trim() };
    }).filter((d) => d.title || d.url);
  }

  // ── Battery save ──

  async function handleBatterySave(e) {
    e.preventDefault();
    const code = document.getElementById("f-code").value.trim();
    if (!code) { toast("Kod baterii jest wymagany", "error"); return; }

    const tenantId = getActiveTenantId();

    const payload = {
      tenant: tenantId,
      page: { code, permalink: getVal("f-permalink"), qrValue: getVal("f-qrValue") },
      battery: {
        model: getVal("f-model"), brand: getVal("f-brand"),
        chemistry: getVal("f-chemistry"), category: getVal("f-category"),
        capacity: getVal("f-capacity"), voltage: getVal("f-voltage"),
        weight: getVal("f-weight"), dimensions: getVal("f-dimensions"),
        extinguishingAgent: getVal("f-extinguishingAgent"),
        left: collectMetrics("metrics-left"),
        middle: collectMetrics("metrics-middle"),
        right: collectMetrics("metrics-right"),
      },
      manufacturer: {
        name: getVal("f-mfr-name"), address: getVal("f-mfr-address"),
        email: getVal("f-mfr-email"), web: getVal("f-mfr-web"),
      },
      euResponsibleEntity: {
        name: getVal("f-eu-name"), address: getVal("f-eu-address"),
        email: getVal("f-eu-email"), web: getVal("f-eu-web"),
      },
      documents: collectDocuments(),
    };

    const wasteRaw = getVal("f-wasteInfo");
    if (wasteRaw) { try { payload.wasteInfo = JSON.parse(wasteRaw); } catch { toast("wasteInfo: nieprawidłowy JSON", "error"); return; } }
    const videoRaw = getVal("f-video");
    if (videoRaw) { try { payload.video = JSON.parse(videoRaw); } catch { toast("video: nieprawidłowy JSON", "error"); return; } }

    try {
      if (editingCode) {
        await API.updateBattery(editingCode, payload, userRole === "superadmin" ? tenantId : null);
        toast("Zapisano zmiany", "success");
      } else {
        await API.createBattery(payload, userRole === "superadmin" ? tenantId : null);
        toast("Utworzono baterię", "success");
      }
      hideBatteryEditor();
    } catch (err) {
      toast("Błąd zapisu: " + err.message, "error");
    }
  }

  async function publishBattery(code) {
    if (!confirm(`Opublikować baterię "${code}"?`)) return;
    const tenantId = getActiveTenantId();
    try {
      toast("Publikowanie...", "info");
      await API.publishBattery(code, userRole === "superadmin" ? tenantId : null);
      toast("Opublikowano!", "success");
      loadBatteries(tenantId);
    } catch (err) {
      toast("Błąd publikacji: " + err.message, "error");
    }
  }

  async function deleteBattery(code) {
    if (!confirm(`Usunąć baterię "${code}"?`)) return;
    const tenantId = getActiveTenantId();
    try {
      await API.deleteBattery(code, userRole === "superadmin" ? tenantId : null);
      toast("Usunięto", "success");
      loadBatteries(tenantId);
    } catch (err) {
      toast("Błąd: " + err.message, "error");
    }
  }

  // ── Utilities ──

  function getVal(id) { return document.getElementById(id)?.value?.trim() || ""; }
  function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val || ""; }
  function esc(s) { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }
  function escAttr(s) { return (s || "").replace(/'/g, "&#39;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function toast(msg, type = "info") {
    const container = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // ── Boot ──
  document.addEventListener("DOMContentLoaded", init);

  return {
    switchTab,
    showTenantEditor, hideTenantEditor, editTenant, deleteTenant,
    showTenantDetail, hideTenantDetail,
    showUserForm, hideUserForm, deleteUser,
    showBatteryEditor, hideBatteryEditor, editBattery, deleteBattery, publishBattery,
    onTenantSelectChange,
    addMetric, addDocument,
    logout,
  };
})();
