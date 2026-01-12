function setupTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = Array.from(document.querySelectorAll(".panel"));

  if (!tabs.length || !panels.length) return; // Not on tabbed page

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
  
  // Handle buttons with data-tab-target (e.g., "Go to Safety" button)
  document.querySelectorAll("[data-tab-target]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const targetTab = btn.getAttribute("data-tab-target");
      activate(targetTab);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  const hash = (location.hash || "").replace("#", "");
  if (hash === "docs") activate("docs");
  if (hash === "safety") activate("safety");
}

function applyDecimalSeparators(lang) {
  const toPl = lang === "pl";

  const targets = Array.from(
    document.querySelectorAll(".metric__value, .metric__sub, .infoValue")
  );

  for (const el of targets) {
    // Avoid touching URLs/links.
    if (el.tagName === "A" || el.querySelector("a")) continue;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.nodeValue;
      if (!t) continue;
      node.nodeValue = toPl
        ? t.replace(/(\d)\.(\d)/g, "$1,$2")
        : t.replace(/(\d),(\d)/g, "$1.$2");
    }
  }
}

function setupLangToggle() {
  const btns = Array.from(document.querySelectorAll('[data-action="lang"]'));
  if (!btns.length) return;
  
  let lang = "pl";

  function decodeHtmlEntities(str) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = str;
    return textarea.value;
  }

  function applyLang(next) {
    lang = next;
    btns.forEach((b) => {
      const on = b.getAttribute("data-lang") === lang;
      b.classList.toggle("chip--active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });

    // Switch content for elements with data-lang-content
    document.querySelectorAll("[data-lang-content]").forEach((el) => {
      const content = el.getAttribute(`data-${lang}`);
      if (!content) return;
      el.innerHTML = decodeHtmlEntities(content);
    });

    applyDecimalSeparators(lang);
  }

  btns.forEach((b) => b.addEventListener("click", () => applyLang(b.getAttribute("data-lang"))));
  applyLang("pl");
}

function setupCopyID() {
  const btn = document.querySelector('[data-action="copy-id"]');
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const idElement = document.querySelector('[data-copy="page.code"]');
    if (!idElement) return;
    
    const id = idElement.textContent.trim();
    
    try {
      await navigator.clipboard.writeText(id);
      btn.textContent = "✓";
      setTimeout(() => {
        btn.textContent = "📋";
      }, 2000);
    } catch (err) {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = id;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      btn.textContent = "✓";
      setTimeout(() => {
        btn.textContent = "📋";
      }, 2000);
    }
  });
}

(function main() {
  setupTabs();
  setupLangToggle();
  // If language toggle is not present, keep PL decimal separator.
  applyDecimalSeparators("pl");
  setupCopyID();
})();
