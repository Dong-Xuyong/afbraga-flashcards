/**
 * Citations, keyword tags and backlinks.
 * Data comes from data/citations.json (node scripts/build_citations.js).
 */

let citeData = null;
let citePromise = null;

function ensureCites() {
  if (citeData) return Promise.resolve(citeData);
  if (!citePromise) {
    citePromise = fetch("data/citations.json")
      .then((res) => {
        if (!res.ok) throw new Error("Não foi possível carregar as fontes.");
        return res.json();
      })
      .then((data) => {
        citeData = data;
        return data;
      })
      .catch((err) => {
        citePromise = null;
        throw err;
      });
  }
  return citePromise;
}

function citeEntry(card) {
  if (!citeData || !card || !card.id) return null;
  return citeData.cards[card.id] || null;
}

function tagLabel(id) {
  const tags = (citeData && citeData.tags) || [];
  for (const tag of tags) {
    if (tag.id === id) return tag.label;
  }
  return id;
}

function legendLine() {
  const legend = (citeData && citeData.legend) || {};
  return "Contínuo: o texto nomeia a fonte. Tracejado: ligação por tema, não está escrita na pergunta.";
}

function appendCardCites(container, card) {
  const entry = citeEntry(card);
  if (!container || !entry) return false;
  const cites = entry.citations || [];
  const tags = entry.tags || [];
  if (!cites.length && !tags.length) return false;

  if (cites.length) {
    const row = document.createElement("div");
    row.className = "cite-row";
    for (const cite of cites) {
      const link = document.createElement("a");
      link.className = "cite-chip cite-chip--" + (cite.basis === "official" ? "official" : "inferred");
      link.href = cite.href || "#/hoje";
      const label = cite.label || "Fonte";
      link.textContent = cite.weak ? label + " · aproximada" : label;
      const legend = citeData.legend || {};
      link.title = cite.basis === "official"
        ? (legend.official || "O texto nomeia esta fonte.")
        : (legend.inferred || "Ligação por tema, não está escrita na pergunta.");
      link.addEventListener("click", (event) => event.stopPropagation());
      row.appendChild(link);
    }
    container.appendChild(row);
    const note = document.createElement("p");
    note.className = "cite-legend";
    note.textContent = legendLine();
    container.appendChild(note);
  }

  if (tags.length) {
    const row = document.createElement("div");
    row.className = "tag-row";
    for (const id of tags) {
      const link = document.createElement("a");
      link.className = "tag-chip";
      link.href = "#/tema/" + encodeURIComponent(id);
      link.textContent = tagLabel(id);
      link.addEventListener("click", (event) => event.stopPropagation());
      row.appendChild(link);
    }
    container.appendChild(row);
  }
  return true;
}

function backlinkAnchor(target) {
  if (!citeData || !target) return null;
  const ids = (citeData.backlinks && citeData.backlinks[target]) || [];
  if (!ids.length) return null;
  const link = document.createElement("a");
  link.className = "backlink";
  link.href = "#/fonte/" + encodeURIComponent(target);
  link.textContent = ids.length === 1 ? "1 cartão relacionado" : ids.length + " cartões relacionados";
  link.addEventListener("click", (event) => event.stopPropagation());
  return link;
}

function decorateHeading(heading) {
  if (!heading || !heading.id) return;
  const link = backlinkAnchor(heading.id);
  if (link) heading.appendChild(link);
}

const DECK_LABELS = {
  "c5-a": "C5 — Versão A",
  "c6-a": "C6 — Versão A",
  "cf": "CF",
  "cenarios": "Cenários",
  "alteracoes-2627": "Alterações 2026/27",
  testes: "Testes escritos",
};

async function cardById(id) {
  await ensureDecksLoaded();
  if (cardIndex[id]) return cardIndex[id];
  await ensureQuiz();
  for (const test of quizBundle || []) {
    for (const card of test.cards || []) {
      if (card.id === id) return card;
    }
  }
  return null;
}

function filterRoot() {
  return {
    kicker: $("#filter-kicker"),
    title: $("#filter-title"),
    lead: $("#filter-lead"),
    legend: $("#filter-legend"),
    actions: $("#filter-actions"),
    body: $("#filter-body"),
  };
}

function showMore(list, limit) {
  const hidden = [];
  for (let i = 0; i < list.length; i += 1) {
    if (i < limit) continue;
    list[i].hidden = true;
    hidden.push(list[i]);
  }
  if (!hidden.length) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-ghost text-action show-more";
  button.textContent = "Mostrar mais (" + hidden.length + ")";
  button.addEventListener("click", () => {
    for (const el of hidden) el.hidden = false;
    button.remove();
  });
  list[0].parentNode.appendChild(button);
}

function cardRow(card, entry) {
  const article = document.createElement("article");
  article.className = "filter-card";
  const meta = document.createElement("p");
  meta.className = "filter-meta";
  meta.textContent = DECK_LABELS[entry.deck] || entry.deck || "";
  const question = document.createElement("p");
  question.className = "filter-question";
  question.textContent = card.question || "";
  article.appendChild(meta);
  article.appendChild(question);
  const cites = (entry && entry.citations) || [];
  if (cites.length) {
    const row = document.createElement("div");
    row.className = "cite-row";
    for (const cite of cites) {
      const link = document.createElement("a");
      link.className = "cite-chip cite-chip--" + (cite.basis === "official" ? "official" : "inferred");
      link.href = cite.href || "#/hoje";
      link.textContent = cite.weak ? (cite.label || "Fonte") + " · aproximada" : (cite.label || "Fonte");
      row.appendChild(link);
    }
    article.appendChild(row);
  }
  return article;
}

async function paintCardList(body, ids) {
  const cards = [];
  for (const id of ids) {
    const card = await cardById(id);
    const entry = citeData.cards[id];
    if (!card || !entry) continue;
    cards.push({ card: card, entry: entry });
  }
  const rows = [];
  for (const row of cards) rows.push(cardRow(row.card, row.entry));
  for (const row of rows) body.appendChild(row);
  showMore(rows, 12);
  return cards.map((row) => row.card);
}

function studyButton(cards, deckId, title, origin) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-primary";
  button.textContent = "Estudar estas cartas";
  button.addEventListener("click", () => {
    deckCache[deckId] = { deckId: deckId, title: title, cards: cards };
    startStudy({ id: deckId, title: title, origin: origin, file: "citations.json" });
  });
  return button;
}

async function openTema(slug) {
  const token = routeToken;
  showView("filter");
  document.title = "AF Braga — Tema";
  const ui = filterRoot();
  ui.body.innerHTML = '<p class="mode-hint">A carregar…</p>';
  ui.actions.innerHTML = "";
  ui.legend.textContent = "";
  try {
    await ensureCites();
    await ensureLaws();
  } catch (err) {
    if (token !== routeToken) return;
    ui.body.textContent = err.message;
    return;
  }
  if (token !== routeToken) return;
  const label = tagLabel(slug);
  ui.kicker.textContent = "Tema";
  ui.title.textContent = label;
  const index = (citeData.tagIndex && citeData.tagIndex[slug]) || { passages: [], circulars: [] };
  const ids = [];
  for (const id of Object.keys(citeData.cards)) {
    const entry = citeData.cards[id];
    if ((entry.tags || []).indexOf(slug) !== -1) ids.push(id);
  }
  ui.lead.textContent = ids.length + (ids.length === 1 ? " carta" : " cartas") +
    " · " + (index.passages || []).length + " passagens · " + (index.circulars || []).length + " circulares";
  ui.legend.textContent = legendLine();
  ui.body.innerHTML = "";

  const cards = await paintCardList(ui.body, ids);
  if (token !== routeToken) return;
  if (cards.length) ui.actions.appendChild(studyButton(cards, "tema-" + slug, "Tema · " + label, "tema:" + slug));

  const passages = index.passages || [];
  if (passages.length) {
    const h = document.createElement("h3");
    h.className = "section-label";
    h.textContent = "Passagens";
    ui.body.appendChild(h);
    const links = [];
    for (const passage of passages) {
      const link = document.createElement("a");
      link.className = "toc-link";
      link.href = passage.href;
      link.textContent = passage.label;
      ui.body.appendChild(link);
      links.push(link);
    }
    showMore(links, 12);
  }

  const circulars = index.circulars || [];
  if (circulars.length) {
    const h = document.createElement("h3");
    h.className = "section-label";
    h.textContent = "Circulares e esclarecimentos";
    ui.body.appendChild(h);
    for (const row of circulars) {
      const link = document.createElement("a");
      link.className = "toc-link";
      link.href = row.href;
      link.textContent = row.label;
      ui.body.appendChild(link);
    }
  }

  if (!ids.length && !passages.length && !circulars.length) {
    const empty = document.createElement("p");
    empty.className = "mode-hint";
    empty.textContent = "Sem resultados para este tema.";
    ui.body.appendChild(empty);
  }
}

async function openFonte(target) {
  const token = routeToken;
  showView("filter");
  document.title = "AF Braga — Cartões relacionados";
  const ui = filterRoot();
  ui.body.innerHTML = '<p class="mode-hint">A carregar…</p>';
  ui.actions.innerHTML = "";
  ui.legend.textContent = "";
  try {
    await ensureCites();
  } catch (err) {
    if (token !== routeToken) return;
    ui.body.textContent = err.message;
    return;
  }
  if (token !== routeToken) return;
  const ids = (citeData.backlinks && citeData.backlinks[target]) || [];
  ui.kicker.textContent = "Fonte";
  ui.title.textContent = ids.length === 1 ? "1 cartão relacionado" : ids.length + " cartões relacionados";
  ui.lead.textContent = "Cartas que apontam para esta passagem.";
  ui.legend.textContent = legendLine();
  ui.body.innerHTML = "";
  const cards = await paintCardList(ui.body, ids);
  if (token !== routeToken) return;
  if (cards.length) ui.actions.appendChild(studyButton(cards, "fonte-" + target, "Fonte", "fonte:" + target));
  if (!ids.length) {
    const empty = document.createElement("p");
    empty.className = "mode-hint";
    empty.textContent = "Nenhuma carta aponta para esta fonte.";
    ui.body.appendChild(empty);
  }
}
