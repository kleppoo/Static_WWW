/**
 * api.js — API client for Battery Info backend (multi-tenant)
 *
 * Uses Cognito JWT from Auth module.
 * Superadmin can set X-Tenant-Id header to operate on any tenant.
 */

const API = (() => {
  let BASE_URL = "";

  function configure({ apiUrl }) {
    BASE_URL = apiUrl.replace(/\/$/, "");
  }

  async function request(method, path, body, extraHeaders = {}) {
    const token = await Auth.ensureValidToken();

    const headers = {
      "Content-Type": "application/json",
      Authorization: token,
      ...extraHeaders,
    };

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${BASE_URL}${path}`, opts);

    if (res.status === 401 || res.status === 403) {
      const text = await res.text();
      let msg;
      try { msg = JSON.parse(text).error || text; } catch { msg = text; }
      // If truly unauthorized, redirect to login
      if (res.status === 401) {
        Auth.signOut();
        window.location.reload();
      }
      throw new Error(`${res.status}: ${msg}`);
    }

    if (!res.ok) {
      const text = await res.text();
      let msg;
      try { msg = JSON.parse(text).error || text; } catch { msg = text; }
      throw new Error(`${res.status}: ${msg}`);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  // ── Battery CRUD (tenant-scoped) ──

  function listBatteries(tenantId) {
    const h = tenantId ? { "X-Tenant-Id": tenantId } : {};
    return request("GET", "/batteries", null, h);
  }

  function getBattery(code, tenantId) {
    const h = tenantId ? { "X-Tenant-Id": tenantId } : {};
    return request("GET", `/batteries/${encodeURIComponent(code)}`, null, h);
  }

  function createBattery(data, tenantId) {
    const h = tenantId ? { "X-Tenant-Id": tenantId } : {};
    return request("POST", "/batteries", data, h);
  }

  function updateBattery(code, data, tenantId) {
    const h = tenantId ? { "X-Tenant-Id": tenantId } : {};
    return request("PUT", `/batteries/${encodeURIComponent(code)}`, data, h);
  }

  function deleteBattery(code, tenantId) {
    const h = tenantId ? { "X-Tenant-Id": tenantId } : {};
    return request("DELETE", `/batteries/${encodeURIComponent(code)}`, null, h);
  }

  function publishBattery(code, tenantId) {
    const h = tenantId ? { "X-Tenant-Id": tenantId } : {};
    return request("POST", `/batteries/${encodeURIComponent(code)}/publish`, null, h);
  }

  // ── Tenant management (superadmin only) ──

  function listTenants() {
    return request("GET", "/tenants");
  }

  function getTenant(tenantId) {
    return request("GET", `/tenants/${encodeURIComponent(tenantId)}`);
  }

  function createTenant(data) {
    return request("POST", "/tenants", data);
  }

  function updateTenant(tenantId, data) {
    return request("PUT", `/tenants/${encodeURIComponent(tenantId)}`, data);
  }

  function deleteTenant(tenantId) {
    return request("DELETE", `/tenants/${encodeURIComponent(tenantId)}`);
  }

  // ── Tenant user management (superadmin only) ──

  function listTenantUsers(tenantId) {
    return request("GET", `/tenants/${encodeURIComponent(tenantId)}/users`);
  }

  function createTenantUser(tenantId, data) {
    return request("POST", `/tenants/${encodeURIComponent(tenantId)}/users`, data);
  }

  function deleteTenantUser(tenantId, userId) {
    return request(
      "DELETE",
      `/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userId)}`
    );
  }

  return {
    configure,
    listBatteries, getBattery, createBattery, updateBattery, deleteBattery, publishBattery,
    listTenants, getTenant, createTenant, updateTenant, deleteTenant,
    listTenantUsers, createTenantUser, deleteTenantUser,
  };
})();
