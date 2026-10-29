/** Visões da wiki de regras: árvore, busca, página e prévia. Funções puras sobre os dados gerados do vault. */

const SEARCH_LIMIT = 30;
const SNIPPET_RADIUS = 70;
const PREVIEW_LENGTH = 240;

export const normalize = (text) => String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Ids das páginas na ordem de leitura da árvore. */
export function readingOrder(tree) {
  const order = [];
  const visit = (node) => {
    if (node.page && !order.includes(node.page)) order.push(node.page);
    node.children.forEach(visit);
  };
  tree.forEach(visit);
  return order;
}

/** Nós da árvore que contêm a página aberta, para abri-los ao navegar. */
export function ancestorsOf(tree, pageId) {
  const path = [];
  const visit = (node, trail) => {
    if (node.page === pageId) {
      path.push(...trail);
      return true;
    }
    return node.children.some((child) => visit(child, [...trail, node.id]));
  };
  tree.some((node) => visit(node, []));
  return path;
}

/**
 * Árvore achatada com profundidade; filhos de grupos fechados ficam de fora. Os grupos da página aberta
 * começam abertos, a não ser que tenham sido fechados à mão.
 */
export function treeView(tree, { page, expanded = [], collapsed = [] }) {
  const open = new Set([...expanded, ...ancestorsOf(tree, page), page].filter((id) => !collapsed.includes(id)));
  const rows = [];
  const visit = (node, depth) => {
    const hasChildren = node.children.length > 0;
    const isOpen = hasChildren && open.has(node.id);
    rows.push({ id: node.id, title: node.title, page: node.page, depth, hasChildren, open: isOpen, active: Boolean(node.page) && node.page === page, root: depth === 0, secret: Boolean(node.secret) });
    if (isOpen) node.children.forEach((child) => visit(child, depth + 1));
  };
  tree.forEach((node) => visit(node, 0));
  return rows;
}

/** Trecho do texto em volta da primeira ocorrência, em partes marcadas para destacar os termos. */
export function snippet(text, terms, radius = SNIPPET_RADIUS) {
  const plain = String(text ?? "").replace(/\s+/g, " ");
  const folded = normalize(plain);
  const first = Math.min(...terms.map((term) => folded.indexOf(term)).filter((index) => index >= 0));
  if (!Number.isFinite(first)) return [{ text: plain.slice(0, radius * 2), hit: false }];
  let start = Math.max(0, first - radius);
  let end = Math.min(plain.length, first + radius);
  if (start > 0) start = plain.indexOf(" ", start) + 1 || start;
  if (end < plain.length) end = plain.lastIndexOf(" ", end) > first ? plain.lastIndexOf(" ", end) : end;
  return highlight(plain.slice(start, end), terms, start > 0, end < plain.length);
}

function highlight(text, terms, before = false, after = false) {
  const folded = normalize(text);
  const marks = new Array(text.length).fill(false);
  for (const term of terms) {
    for (let index = folded.indexOf(term); index >= 0 && term; index = folded.indexOf(term, index + term.length)) {
      marks.fill(true, index, index + term.length);
    }
  }
  const parts = [];
  for (let index = 0; index < text.length; index += 1) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marks[index]) last.text += text[index];
    else parts.push({ text: text[index], hit: marks[index] });
  }
  if (before) parts.unshift({ text: "… ", hit: false });
  if (after) parts.push({ text: " …", hit: false });
  return parts;
}

/**
 * Busca sem acento e sem caixa: toda palavra da consulta precisa aparecer na página. Títulos pesam mais
 * que seções, que pesam mais que o texto; quando uma seção casa, o resultado abre nela.
 */
export function searchWiki(data, query, limit = SEARCH_LIMIT) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const phrase = terms.join(" ");
  const results = [];
  for (const [id, page] of Object.entries(data.pages)) {
    const title = normalize(page.title);
    const text = normalize(page.text);
    const headings = page.headings.map((heading) => ({ ...heading, folded: normalize(heading.title) }));
    const haystack = `${title} ${headings.map(({ folded }) => folded).join(" ")} ${text}`;
    if (!terms.every((term) => haystack.includes(term))) continue;
    const heading = headings.find(({ folded }) => terms.every((term) => folded.includes(term)));
    let score = 0;
    if (title === phrase) score += 100;
    else if (title.startsWith(phrase)) score += 60;
    else if (terms.every((term) => title.includes(term))) score += 40;
    if (heading) score += heading.folded === phrase ? 30 : 15;
    score += Math.min(10, terms.reduce((sum, term) => sum + text.split(term).length - 1, 0));
    const trail = page.trail.map((pageId) => data.pages[pageId]?.title).filter(Boolean);
    results.push({
      page: id,
      anchor: heading && !terms.every((term) => title.includes(term)) ? heading.anchor : "",
      title: highlight(page.title, terms),
      section: heading && !terms.every((term) => title.includes(term)) ? heading.title : "",
      context: trail.join(" › "),
      snippet: snippet(page.text, terms),
      score
    });
  }
  return results.sort((a, b) => b.score - a.score || a.page.localeCompare(b.page)).slice(0, limit);
}

const stripTags = (html) => String(html).replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");

const clip = (text, length = PREVIEW_LENGTH) => {
  const plain = text.replace(/\s+/g, " ").trim();
  return plain.length > length ? `${plain.slice(0, length).replace(/\s+\S*$/, "")}…` : plain;
};

/** Texto de uma seção: o que vem depois do título até o próximo título. */
function sectionText(html, anchor) {
  const start = html.indexOf(`data-anchor="${anchor}"`);
  if (start < 0) return "";
  const body = html.slice(html.indexOf(">", html.indexOf("</h", start)) + 1);
  const next = body.search(/<h[1-6][ >]/);
  return stripTags((next >= 0 ? body.slice(0, next) : body).replace(/<\/(p|li|tr)>/g, " "));
}

/** Prévia de um link: título, onde fica e o começo do texto (da seção, quando o link aponta para uma). */
export function previewView(data, pageId, anchor = "") {
  const page = data.pages[pageId];
  if (!page) return null;
  const heading = anchor ? page.headings.find((entry) => entry.anchor === anchor) : null;
  const text = anchor ? clip(sectionText(page.html, anchor)) : "";
  return {
    title: heading?.title ?? page.title,
    context: [...page.trail.map((id) => data.pages[id]?.title), heading ? page.title : null].filter(Boolean).join(" › "),
    summary: text || page.summary
  };
}

/** Página aberta: trilha e citações. */
export function pageView(data, pageId, { canBack = false, canForward = false } = {}) {
  const id = data.pages[pageId] ? pageId : data.home;
  const page = data.pages[id];
  const link = (target) => (target && data.pages[target] ? { id: target, title: data.pages[target].title } : null);
  const trail = page.trail.map(link).filter(Boolean);
  return {
    id,
    home: data.home,
    title: page.title,
    section: trail[0]?.title ?? "",
    trail,
    html: page.html,
    backlinks: page.backlinks.map(link).filter(Boolean),
    canBack,
    canForward,
    isHome: id === data.home,
    untranslated: Boolean(page.fallback)
  };
}
