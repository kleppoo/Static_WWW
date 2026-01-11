// Minimal JavaScript for UI interactions only
// All data is hardcoded in HTML by build process

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

function setupLangToggle() {
  const btns = Array.from(document.querySelectorAll('[data-action="lang"]'));
  let lang = "pl";

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
      if (content) el.textContent = content;
    });
  }

  btns.forEach((b) => b.addEventListener("click", () => applyLang(b.getAttribute("data-lang"))));
  applyLang("pl");
}

(function main() {
  setupTabs();
  setupLangToggle();
})();
