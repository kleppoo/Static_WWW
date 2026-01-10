function get(obj, path) {
  if (!path) return undefined;
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function setText(el, value) {
  el.textContent = value == null || value === "" ? "—" : String(value);
}

function setHTML(el, value) {
  el.innerHTML = value == null || value === "" ? "—" : String(value);
}

function setHref(el, value) {
  if (!value) return;
  el.setAttribute("href", value);
}

function parseEmbeddedJson() {
  const tag = document.getElementById("__PAGE_DATA__");
  if (!tag) return null;
  const txt = (tag.textContent || "").trim();
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

async function loadData() {
  // Priority:
  // 1) JSON embedded into HTML by build step (production)
  // 2) Fetch ./data/page.json (local dev)
  const embedded = parseEmbeddedJson();
  if (embedded) return embedded;

  const res = await fetch("./data/page.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Cannot load data/page.json");
  return await res.json();
}

function renderMetrics(colEl, items) {
  colEl.innerHTML = "";
  for (const it of items || []) {
    const row = document.createElement("div");
    row.className = "metric";
    row.innerHTML = `
      <div class="metric__label">${it.label ?? ""}</div>
      <div class="metric__value">${it.value ?? "—"}</div>
      ${it.sub ? `<div class="metric__sub">${it.sub}</div>` : ``}
    `;
    colEl.appendChild(row);
  }
}

function renderDocs(listEl, docs) {
  listEl.innerHTML = "";
  for (const d of docs || []) {
    const li = document.createElement("li");
    li.className = "doc";
    li.innerHTML = `
      <div>
        <div class="doc__title">${d.title ?? "Document"}</div>
        <div class="doc__meta">v${d.version ?? "—"} • ${d.language ?? "—"}</div>
      </div>
      <a class="btn" href="${d.url ?? "#"}" target="_blank" rel="noreferrer">Open</a>
    `;
    listEl.appendChild(li);
  }
}

function renderVideo(container, video) {
  container.innerHTML = "";
  if (!video || !video.url) {
    container.textContent = "—";
    return;
  }
  const a = document.createElement("a");
  a.className = "btn btnPrimary";
  a.href = video.url;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = "Open video";
  container.appendChild(a);

  if (video.note) {
    const span = document.createElement("span");
    span.className = "muted";
    span.textContent = video.note;
    container.appendChild(span);
  }
}

function renderList(container, items) {
  container.innerHTML = "";
  const arr = items || [];
  if (!arr.length) {
    const li = document.createElement("li");
    li.textContent = "—";
    container.appendChild(li);
    return;
  }
  for (const x of arr) {
    const li = document.createElement("li");
    li.textContent = x;
    container.appendChild(li);
  }
}

function bindSimple(data) {
  document.querySelectorAll("[data-bind]").forEach((el) => {
    const path = el.getAttribute("data-bind");
    setText(el, get(data, path));
  });

  document.querySelectorAll("[data-bind-html]").forEach((el) => {
    const path = el.getAttribute("data-bind-html");
    setHTML(el, get(data, path));
  });

  document.querySelectorAll("[data-bind-href]").forEach((el) => {
    const path = el.getAttribute("data-bind-href");
    const val = get(data, path);
    if (val) setHref(el, val);
  });
}

function setupTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = Array.from(document.querySelectorAll(".panel"));

  function activate(tabName) {
    tabs.forEach((t) => {
      const active = t.getAttribute("data-tab") === tabName;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    panels.forEach((p) => {
      const show = p.getAttribute("data-panel") === tabName;
      p.classList.toggle("is-visible", show);
    });
  }

  tabs.forEach((t) => {
    t.addEventListener("click", () => activate(t.getAttribute("data-tab")));
  });

  const hash = (location.hash || "").replace("#", "");
  if (hash === "docs") activate("docs");
  if (hash === "safety") activate("safety");
}

function setupLangToggle(data) {
  const btns = Array.from(document.querySelectorAll('[data-action="lang"]'));
  let lang = "pl";

  function applyLang(next) {
    lang = next;
    btns.forEach((b) => {
      const on = b.getAttribute("data-lang") === lang;
      b.classList.toggle("chip--active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });

    const hasEn = get(data, "wasteInfo.en");
    if (lang === "en" && hasEn) {
      document.querySelectorAll("[data-bind-html^='wasteInfo.pl.']").forEach((el) => {
        const plPath = el.getAttribute("data-bind-html");
        const enPath = plPath.replace("wasteInfo.pl.", "wasteInfo.en.");
        setHTML(el, get(data, enPath));
      });

      const ext = document.querySelector('[data-bind="battery.extinguishingAgent.pl"]');
      if (ext) setText(ext, get(data, "battery.extinguishingAgent.en") ?? get(data, "battery.extinguishingAgent.pl"));
    } else {
      document.querySelectorAll("[data-bind-html^='wasteInfo.pl.']").forEach((el) => {
        const plPath = el.getAttribute("data-bind-html");
        setHTML(el, get(data, plPath));
      });

      const ext = document.querySelector('[data-bind="battery.extinguishingAgent.pl"]');
      if (ext) setText(ext, get(data, "battery.extinguishingAgent.pl"));
    }
  }

  btns.forEach((b) => b.addEventListener("click", () => applyLang(b.getAttribute("data-lang"))));
  applyLang("pl");
}

(async function main() {
  setupTabs();

  const data = await loadData();
  bindSimple(data);

  document.querySelectorAll("[data-metrics]").forEach((el) => {
    const path = el.getAttribute("data-metrics");
    renderMetrics(el, get(data, path));
  });

  const docsEl = document.querySelector("[data-docs]");
  if (docsEl) renderDocs(docsEl, get(data, "documents"));

  const videoEl = document.querySelector("[data-video]");
  if (videoEl) renderVideo(videoEl, get(data, "video"));

  document.querySelectorAll("[data-list]").forEach((el) => {
    renderList(el, get(data, el.getAttribute("data-list")));
  });

  setupLangToggle(data);

  const model = get(data, "battery.model");
  if (model) document.title = `Battery Info – ${model}`;
})().catch((err) => {
  console.error(err);
  alert("Błąd ładowania danych. Uruchom lokalny serwer (nie otwieraj pliku bezpośrednio z dysku).");
});
