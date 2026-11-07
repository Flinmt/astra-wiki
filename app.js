import { ancestorsOf, pageView, previewView, searchWiki, treeView } from "./view.js";

/**
 * Wiki de regras na web: a mesma janela do Foundry (module/wiki/rules-wiki.js e templates/wiki/*.hbs),
 * com o endereço da página na URL (`?lang=en#/regras/condicoes/caido#seção`) no lugar do histórico interno.
 */

const SEARCH_DELAY = 120;
const PREVIEW_DELAY = 300;
const LANGS = Object.freeze({ "pt-BR": "PT", en: "EN" });
const SOURCE_LANG = "pt-BR";

const content = document.querySelector("[data-web-content]");
const labels = await fetch("data/labels.json").then((response) => response.json());
const loaded = new Map();
const ui = { lang: SOURCE_LANG, page: "", anchor: "", query: "", expanded: [], collapsed: [], menu: false };
let data = null;
let position = history.state?.position ?? 0;
let furthest = position;

const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
const t = (key) => key.split(".").reduce((node, part) => node?.[part], labels[ui.lang]) ?? key;
const marked = (parts) => parts.map(({ text, hit }) => (hit ? `<mark>${escape(text)}</mark>` : escape(text))).join("");
const attrs = (page, anchor = "") => `data-page="${escape(page)}" data-anchor="${escape(anchor)}" href="${escape(hrefOf(page, anchor))}"`;

function hrefOf(page, anchor = "", lang = ui.lang) {
  const query = lang === SOURCE_LANG ? "" : `?lang=${lang}`;
  return `${location.pathname}${query}#/${page}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
}

function preferredLang() {
  const asked = new URLSearchParams(location.search).get("lang");
  if (asked && LANGS[asked]) return asked;
  try {
    const saved = localStorage.getItem("astra-wiki-lang");
    if (saved && LANGS[saved]) return saved;
  } catch {}
  return navigator.language?.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

function loadData(lang) {
  if (!loaded.has(lang)) loaded.set(lang, fetch(`data/rules-wiki.${lang}.json`).then((response) => response.json()));
  return loaded.get(lang);
}

/** Página e seção do endereço: `#/id/da/pagina#seção`. */
function readLocation() {
  const [path = "", anchor = ""] = location.hash.replace(/^#\/?/, "").split("#");
  const page = decodeURIComponent(path);
  return { page: data.pages[page] ? page : data.home, anchor: decodeURIComponent(anchor) };
}

/* Partes da janela, na mesma ordem e com as mesmas classes dos templates do Foundry */

function searchHtml() {
  return `<div class="astra-wiki__search">
    <label class="astra-wiki__field">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.8" stroke="currentColor" stroke-width="1.5"></circle><path d="M10.6 10.6L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>
      <span class="astra-sr-only">${escape(t("Search"))}</span>
      <input type="search" data-wiki-search value="${escape(ui.query)}" placeholder="${escape(t("SearchPlaceholder"))}" autocomplete="off" spellcheck="false">
    </label>
  </div>`;
}

function navHtml() {
  const results = ui.query.trim() ? searchWiki(data, ui.query) : null;
  if (results) {
    const items = results.map((result) => `<li>
      <a class="astra-wiki__result" data-action="openWikiPage" ${attrs(result.page, result.anchor)}>
        ${result.context ? `<span class="astra-wiki__result-context">${escape(result.context)}</span>` : ""}
        <span class="astra-wiki__result-title">${marked(result.title)}${result.section ? `<span class="astra-wiki__result-section"> › ${escape(result.section)}</span>` : ""}</span>
        <span class="astra-wiki__result-snippet">${marked(result.snippet)}</span>
      </a>
    </li>`).join("") || `<li class="astra-wiki__empty">${escape(t("NoResults"))}</li>`;
    return `<nav class="astra-wiki__nav astra-scroll" aria-label="${escape(t("Results"))}">
      <div class="astra-wiki__nav-head">
        <span class="astra-wiki__caption">${escape(t("Results"))} · ${results.length}</span>
        <button type="button" class="astra-wiki__clear" data-action="clearWikiSearch">${escape(t("ClearSearch"))}</button>
      </div>
      <ol class="astra-wiki__results">${items}</ol>
    </nav>`;
  }
  const toggle = (row) => `<button type="button" class="astra-wiki__toggle" data-action="toggleWikiGroup" data-id="${escape(row.id)}" aria-expanded="${row.open}" aria-label="${escape(row.title)}"><svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5L7 5L3 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>`;
  const rows = treeView(data.tree, ui).map((row) => `<li class="astra-wiki__node${row.root ? " is-root" : ""}${row.active ? " is-active" : ""}" style="--depth: ${row.depth}">
      ${row.page
        ? `<a class="astra-wiki__node-link" data-action="openWikiPage" ${attrs(row.page)}${row.active ? " aria-current=\"page\"" : ""}>${escape(row.title)}</a>`
        : `<button type="button" class="astra-wiki__node-link is-group" data-action="toggleWikiGroup" data-id="${escape(row.id)}" aria-expanded="${row.open}">${escape(row.title)}</button>`}
      ${row.hasChildren ? toggle(row) : ""}
    </li>`).join("");
  return `<nav class="astra-wiki__nav astra-scroll" aria-label="${escape(t("Contents"))}"><ul class="astra-wiki__tree">${rows}</ul></nav>`;
}

function pageHtml() {
  const page = pageView(data, ui.page, { canBack: position > 0, canForward: position < furthest });
  const crumbs = [
    ...(page.isHome ? [] : [`<li><button type="button" data-page="${escape(page.home)}">${escape(t("Home"))}</button></li>`]),
    ...page.trail.map((crumb) => `<li><button type="button" data-page="${escape(crumb.id)}">${escape(crumb.title)}</button></li>`),
    `<li aria-current="page">${escape(page.title)}</li>`
  ].join("");
  const backlinks = page.backlinks.map((link) => `<li><button type="button" data-page="${escape(link.id)}">${escape(link.title)}</button></li>`).join("");
  return `<section class="astra-wiki__main">
    <header class="astra-wiki__bar">
      <span class="astra-wiki__history">
        <button type="button" data-action="wikiBack" aria-label="${escape(t("Back"))}" title="${escape(t("Back"))}"${page.canBack ? "" : " disabled"}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>
        <button type="button" data-action="wikiForward" aria-label="${escape(t("Forward"))}" title="${escape(t("Forward"))}"${page.canForward ? "" : " disabled"}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>
      </span>
      <ol class="astra-wiki__crumbs" aria-label="${escape(t("Trail"))}">${crumbs}</ol>
    </header>
    <div class="astra-wiki__scroll astra-scroll">
      <div class="astra-wiki__layout">
        <article class="astra-wiki__article">
          <p class="astra-wiki__eyebrow">${escape(page.section || t("Eyebrow"))}</p>
          <h1 class="astra-wiki__title">${escape(page.title)}</h1>
          <div class="astra-wiki__rule" aria-hidden="true"></div>
          ${page.untranslated ? `<p class="astra-wiki__notice"><i class="fa-solid fa-language" inert></i>${escape(t("Untranslated"))}</p>` : ""}
          <div class="astra-wiki__content">${page.html}</div>
          ${backlinks ? `<section class="astra-wiki__related"><h2 class="astra-wiki__caption">${escape(t("CitedIn"))}</h2><ul>${backlinks}</ul></section>` : ""}
        </article>
      </div>
    </div>
    <div class="astra-wiki__preview" role="tooltip" hidden>
      <span class="astra-wiki__preview-context" data-preview-context></span>
      <strong class="astra-wiki__preview-title" data-preview-title></strong>
      <span class="astra-wiki__preview-summary" data-preview-summary></span>
    </div>
  </section>`;
}

/* Desenho */

function renderChrome() {
  document.documentElement.lang = ui.lang;
  document.querySelector("[data-web-title]").textContent = t("Title");
  document.querySelector("[data-action=toggleMenu]").setAttribute("aria-label", t("Contents"));
  document.querySelector("[data-web-langs]").setAttribute("aria-label", t("Language"));
  document.querySelector("[data-web-langs]").innerHTML = Object.entries(LANGS)
    .map(([lang, code]) => `<a href="${escape(hrefOf(ui.page, ui.anchor, lang))}" data-lang="${lang}" hreflang="${lang}"${lang === ui.lang ? " aria-current=\"true\"" : ""}>${code}</a>`).join("");
}

function renderNav() {
  const scroll = content.querySelector(".astra-wiki__nav")?.scrollTop ?? 0;
  content.querySelector(".astra-wiki__nav")?.remove();
  content.querySelector(".astra-wiki__search").insertAdjacentHTML("afterend", navHtml());
  content.querySelector(".astra-wiki__nav").scrollTop = scroll;
}

function renderPage() {
  hidePreview();
  content.querySelector(".astra-wiki__main")?.remove();
  content.insertAdjacentHTML("beforeend", pageHtml());
  // Os links do texto vêm do gerador sem href; aqui ganham endereço para abrir em outra aba.
  for (const link of content.querySelectorAll(".astra-wiki__content a.astra-wiki__link")) link.href = hrefOf(link.dataset.page, link.dataset.anchor ?? "");
  const page = data.pages[ui.page];
  document.title = ui.page === data.home ? t("Title") : `${page.title} · ${t("Title")}`;
  scrollToAnchor();
}

function render() {
  renderChrome();
  content.innerHTML = searchHtml();
  renderNav();
  renderPage();
  bindSearch();
}

function scrollToAnchor() {
  const scroller = content.querySelector(".astra-wiki__scroll");
  const target = ui.anchor ? scroller.querySelector(`[data-anchor="${CSS.escape(ui.anchor)}"]`) : null;
  if (!target) {
    scroller.scrollTop = 0;
    return;
  }
  scroller.scrollTop = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
  target.classList.add("is-target");
  setTimeout(() => target.classList.remove("is-target"), 1600);
}

/* Navegação */

function setMenu(open) {
  ui.menu = open;
  document.body.classList.toggle("is-menu-open", open);
  document.querySelector("[data-action=toggleMenu]").setAttribute("aria-expanded", String(open));
}

/** Abre uma página (e a seção) como uma nova entrada no histórico do navegador. */
function open(page, anchor = "") {
  const target = data.pages[page] ? page : data.home;
  setMenu(false);
  if (target === ui.page && anchor === ui.anchor) return scrollToAnchor();
  position += 1;
  furthest = position;
  history.pushState({ position, furthest }, "", hrefOf(target, anchor));
  show(target, anchor);
}

function show(page, anchor) {
  const ancestors = ancestorsOf(data.tree, page);
  ui.collapsed = ui.collapsed.filter((id) => !ancestors.includes(id));
  Object.assign(ui, { page, anchor });
  renderChrome();
  renderNav();
  renderPage();
}

async function switchLang(lang) {
  ui.lang = lang;
  try {
    localStorage.setItem("astra-wiki-lang", lang);
  } catch {}
  data = await loadData(lang);
  history.replaceState(history.state, "", hrefOf(ui.page, ui.anchor));
  render();
}

window.addEventListener("popstate", (event) => {
  position = event.state?.position ?? 0;
  furthest = Math.max(furthest, event.state?.furthest ?? position);
  const { page, anchor } = readLocation();
  show(page, anchor);
});

/* Busca */

let searchTimer = null;

function bindSearch() {
  const field = content.querySelector("[data-wiki-search]");
  field.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      ui.query = field.value;
      renderNav();
    }, SEARCH_DELAY);
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && field.value) {
      event.preventDefault();
      field.value = "";
      ui.query = "";
      renderNav();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const [first] = searchWiki(data, field.value, 1);
      if (first) open(first.page, first.anchor);
    }
  });
}

/* Cliques: links e botões com data-action; Ctrl/⌘ e botão do meio abrem em outra aba */

document.addEventListener("click", (event) => {
  const lang = event.target.closest("[data-lang]");
  if (lang && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    if (lang.dataset.lang !== ui.lang) switchLang(lang.dataset.lang);
    return;
  }
  const target = event.target.closest("[data-page], button[data-action]");
  if (!target) {
    if (ui.menu && !event.target.closest(".astra-wiki__nav, .astra-wiki__search")) setMenu(false);
    return;
  }
  if (target.matches("a") && (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0)) return;
  event.preventDefault();
  const action = target.dataset.action;
  if (target.dataset.page) open(target.dataset.page, target.dataset.anchor ?? "");
  else if (action === "toggleWikiGroup") toggleGroup(target.dataset.id);
  else if (action === "wikiBack") history.back();
  else if (action === "wikiForward") history.forward();
  else if (action === "toggleMenu") setMenu(!ui.menu);
  else if (action === "clearWikiSearch") {
    ui.query = "";
    const field = content.querySelector("[data-wiki-search]");
    field.value = "";
    field.focus();
    renderNav();
  }
});

function toggleGroup(id) {
  const isOpen = treeView(data.tree, ui).find((entry) => entry.id === id)?.open;
  const without = (list) => list.filter((entry) => entry !== id);
  ui.expanded = isOpen ? without(ui.expanded) : [...without(ui.expanded), id];
  ui.collapsed = isOpen ? [...without(ui.collapsed), id] : without(ui.collapsed);
  renderNav();
}

/* Prévia dos links do texto */

let previewTimer = null;
let previewLink = null;

content.addEventListener("pointerover", (event) => {
  const link = event.target.closest(".astra-wiki__article a.astra-wiki__link");
  if (!link || link === previewLink || event.pointerType === "touch") return;
  previewLink = link;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => showPreview(link), PREVIEW_DELAY);
});

content.addEventListener("pointerout", (event) => {
  const link = event.target.closest(".astra-wiki__article a.astra-wiki__link");
  if (!link || link.contains(event.relatedTarget)) return;
  hidePreview();
});

function showPreview(link) {
  const preview = previewView(data, link.dataset.page, link.dataset.anchor ?? "");
  const card = content.querySelector(".astra-wiki__preview");
  if (!preview || !card || !link.isConnected) return;
  card.querySelector("[data-preview-context]").textContent = preview.context;
  card.querySelector("[data-preview-title]").textContent = preview.title;
  card.querySelector("[data-preview-summary]").textContent = preview.summary;
  card.hidden = false;
  const box = card.offsetParent.getBoundingClientRect();
  const anchor = link.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const left = Math.min(Math.max(8, anchor.left - box.left), box.width - width - 8);
  const below = anchor.bottom - box.top + 6;
  const top = below + height > box.height - 8 ? anchor.top - box.top - height - 6 : below;
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function hidePreview() {
  clearTimeout(previewTimer);
  previewLink = null;
  const card = content.querySelector(".astra-wiki__preview");
  if (card) card.hidden = true;
}

/* Início */

ui.lang = preferredLang();
data = await loadData(ui.lang);
Object.assign(ui, readLocation());
history.replaceState({ position, furthest }, "", hrefOf(ui.page, ui.anchor));
render();
