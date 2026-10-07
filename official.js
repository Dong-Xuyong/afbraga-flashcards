/**
 * Alterações 2026/27, testes escritos e circulares.
 * Depends on globals from core.js and app.js (called after both load).
 */

const SEASON_NOTE = "Época 2025/26 – pode estar desatualizado";
const DELETED_RE = /\[Eliminado:\s*([^\]]*)\]|Texto eliminado:\s*(«[^»]*»(?:\s*(?:em|e|;|,)\s*«[^»]*»)*)|Eliminada a entrada\s+(«.*»)/g;

let laws2627 = null;
let laws2627Promise = null;
let quizBundle = null;
let quizPromise = null;
let circularesHtmlReady = false;
let testesMode = "study";
let testesLaw = "";
let alteracoesTimer = 0;
let alteracoesFocus = "";
let alteracoesItem = "";

function isOutdatedTest(title) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(title || "");
  if (!match) return false;
  return match[3] + "-" + match[2] + "-" + match[1] < "2026-07-01";
}

function slugify(text) {
  return normalize(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
}

function extraKey(entry) {
  const title = normalize(entry && entry.title);
  if (title.indexOf("var") !== -1) return "var";
  if (title.indexOf("glossario") !== -1) return "glossario";
  if (title.indexOf("orientac") !== -1) return "orientacoes";
  return "extra";
}

function lawAnchor(entry) {
  if (entry && entry.law != null) return String(entry.law);
  return extraKey(entry);
}

async function ensureLaws2627() {
  if (laws2627) return laws2627;
  if (!laws2627Promise) {
    laws2627Promise = fetch("data/alteracoes-leis-2627.json")
      .then((res) => {
        if (!res.ok) throw new Error("Não foi possível carregar as alterações.");
        return res.json();
      })
      .then((data) => {
        laws2627 = data;
        return data;
      })
      .catch((err) => {
        laws2627Promise = null;
        throw err;
      });
  }
  return laws2627Promise;
}

function optionMap(options) {
  const out = {};
  for (const raw of options || []) {
    const match = /^([A-D])\)\s*([\s\S]*)$/.exec(raw);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

function buildQuiz(raw) {
  const tests = [];
  const byTitle = new Map();
  for (const item of raw || []) {
    let test = byTitle.get(item.test);
    if (!test) {
      test = {
        id: slugify(item.test) || "teste",
        title: item.test,
        outdated: isOutdatedTest(item.test),
        english: /english/i.test(item.test || ""),
        cards: [],
      };
      byTitle.set(item.test, test);
      tests.push(test);
    }
    const options = optionMap(item.options);
    const letters = String(item.answer_letter || "")
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    const answerText = letters.map((letter) => options[letter]).filter(Boolean).join(" ou ");
    const number = Number(item.n);
    test.cards.push({
      id: "te-" + test.id + "-" + String(number).padStart(2, "0"),
      number: number,
      question: item.q,
      options: options,
      answer: letters.join("/"),
      answers: letters,
      answerText: answerText,
      law: item.law == null ? null : item.law,
      source: item.test,
      outdated: test.outdated,
      written: true,
    });
  }
  return tests;
}

async function ensureQuiz() {
  if (quizBundle) return quizBundle;
  if (!quizPromise) {
    quizPromise = fetch("data/quiz-escritos.json")
      .then((res) => {
        if (!res.ok) throw new Error("Não foi possível carregar os testes escritos.");
        return res.json();
      })
      .then((data) => {
        quizBundle = buildQuiz(data);
        return quizBundle;
      })
      .catch((err) => {
        quizPromise = null;
        throw err;
      });
  }
  return quizPromise;
}

function appendHighlighted(parent, text, query) {
  const src = String(text || "");
  const terms = searchTerms(query);
  if (!terms.length || !src) {
    parent.appendChild(document.createTextNode(src));
    return;
  }
  const folded = foldWithMap(src);
  const ranges = [];
  for (let t = 0; t < terms.length; t += 1) {
    const term = terms[t];
    let from = 0;
    while (from < folded.norm.length) {
      const at = folded.norm.indexOf(term, from);
      if (at < 0) break;
      const start = folded.map[at];
      const end = charEnd(src, folded.map[at + term.length - 1]);
      if (end > start) ranges.push({ start: start, end: end });
      from = at + Math.max(term.length, 1);
    }
  }
  const merged = mergeRanges(ranges);
  let cursor = 0;
  for (let i = 0; i < merged.length; i += 1) {
    const range = merged[i];
    if (range.start > cursor) parent.appendChild(document.createTextNode(src.slice(cursor, range.start)));
    const mark = document.createElement("mark");
    mark.textContent = src.slice(range.start, range.end);
    parent.appendChild(mark);
    cursor = range.end;
  }
  if (cursor < src.length) parent.appendChild(document.createTextNode(src.slice(cursor)));
}

function appendDeletedLine(parent, line) {
  const re = new RegExp(DELETED_RE.source, "g");
  let last = 0;
  let match;
  while ((match = re.exec(line))) {
    if (match.index > last) parent.appendChild(document.createTextNode(line.slice(last, match.index)));
    const label = document.createElement("span");
    label.className = "deleted-label";
    if (match[1] != null) label.textContent = "Eliminado: ";
    else if (match[2] != null) label.textContent = "Texto eliminado: ";
    else label.textContent = "Eliminada a entrada: ";
    const body = match[1] != null ? match[1] : (match[2] != null ? match[2] : match[3]);
    const del = document.createElement("del");
    del.className = "deleted-text";
    del.textContent = (body || "").trim();
    parent.appendChild(label);
    parent.appendChild(del);
    last = match.index + match[0].length;
  }
  if (last < line.length) parent.appendChild(document.createTextNode(line.slice(last)));
}

function appendDetail(parent, text) {
  const lines = String(text || "").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    const p = document.createElement("p");
    p.className = "change-detail";
    appendDeletedLine(p, lines[i]);
    parent.appendChild(p);
  }
}

function orderedLaws(entries) {
  const numbered = [];
  const extras = [];
  for (const entry of entries || []) {
    if (entry && entry.law != null && entry.law !== "") numbered.push(entry);
    else extras.push(entry);
  }
  numbered.sort((a, b) => Number(a.law) - Number(b.law));
  return { numbered: numbered, extras: extras };
}

function entryHay(entry) {
  return normalize("lei " + (entry.law == null ? "" : entry.law) + " " + (entry.title || ""));
}

function changeHay(entry, change) {
  return normalize(
    entryHay(entry) + " " +
    (change.summary || "") + " " +
    (change.detail || "") + " " +
    (change.source || "")
  );
}

function termsMatch(hay, terms) {
  for (let i = 0; i < terms.length; i += 1) {
    if (hay.indexOf(terms[i]) === -1) return false;
  }
  return true;
}

function paintAlteracoes(focus) {
  const root = $("#alteracoes-list");
  if (!root || !laws2627) return;
  root.innerHTML = "";
  const query = ($("#alteracoes-query") && $("#alteracoes-query").value) || "";
  const terms = searchTerms(query);
  const groups = orderedLaws(laws2627);
  let shown = 0;

  function paintGroup(list, heading) {
    const visible = [];
    for (const entry of list) {
      const changes = entry.changes || [];
      const titleHit = terms.length > 0 && termsMatch(entryHay(entry), terms);
      const emptyHit = !changes.length && terms.length > 0 && termsMatch(normalize("sem alteracoes " + entryHay(entry)), terms);
      let picked = changes;
      if (terms.length) {
        if (titleHit || emptyHit) picked = changes;
        else picked = changes.filter((change) => termsMatch(changeHay(entry, change), terms));
      }
      if (terms.length && !titleHit && !emptyHit && !picked.length) continue;
      visible.push({ entry: entry, changes: picked, open: terms.length > 0 && (titleHit || emptyHit || picked.length > 0) });
    }
    if (!visible.length) return;
    if (heading) {
      const h = document.createElement("h3");
      h.className = "section-label reader-heading";
      h.textContent = heading;
      root.appendChild(h);
    }
    for (const row of visible) {
      shown += 1;
      root.appendChild(lawFold(row.entry, row.changes, row.open || lawAnchor(row.entry) === focus, query));
    }
  }

  paintGroup(groups.numbered, "");
  paintGroup(groups.extras, "Fora das Leis 1–17");

  if (!shown) {
    const empty = document.createElement("p");
    empty.className = "mode-hint";
    empty.textContent = "Sem resultados.";
    root.appendChild(empty);
  }

  if (focus) {
    const itemId = alteracoesItem;
    requestAnimationFrame(() => {
      const itemEl = itemId ? document.getElementById("alt-item-" + focus + "-" + itemId) : null;
      const el = itemEl || document.getElementById("alt-" + focus);
      if (el) el.scrollIntoView({ block: "start" });
    });
  }
}

function lawFold(entry, changes, open, query) {
  const details = document.createElement("details");
  details.className = "fold";
  details.id = "alt-" + lawAnchor(entry);
  if (open) details.open = true;
  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.className = "fold-title";
  const label = entry.law == null ? entry.title : "Lei " + entry.law + " — " + entry.title;
  appendHighlighted(title, label, query);
  const meta = document.createElement("span");
  meta.className = "fold-meta";
  meta.textContent = changes.length ? changes.length + (changes.length === 1 ? " alteração" : " alterações") : "Sem alterações";
  summary.appendChild(title);
  summary.appendChild(meta);
  if (typeof backlinkAnchor === "function") {
    const related = backlinkAnchor("alt-" + lawAnchor(entry));
    if (related) summary.appendChild(related);
  }
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "fold-body";
  if (!changes.length) {
    const p = document.createElement("p");
    p.className = "mode-hint";
    p.textContent = "Sem alterações.";
    body.appendChild(p);
  }
  for (let i = 0; i < changes.length; i += 1) {
    const change = changes[i];
    const article = document.createElement("article");
    article.className = "change-item";
    const h = document.createElement("h3");
    h.className = "change-summary";
    appendHighlighted(h, change.summary || "", query);
    article.id = "alt-item-" + lawAnchor(entry) + "-" + (i + 1);
    article.appendChild(h);
    if (typeof backlinkAnchor === "function") {
      const related = backlinkAnchor("alt-" + lawAnchor(entry) + "-" + (i + 1));
      if (related) article.appendChild(related);
    }
    appendDetail(article, change.detail || "");
    if (change.source) {
      const src = document.createElement("p");
      src.className = "change-source";
      src.textContent = change.source;
      article.appendChild(src);
    }
    body.appendChild(article);
  }
  details.appendChild(body);
  return details;
}

async function openAlteracoes(focus, item) {
  const token = routeToken;
  alteracoesFocus = focus || "";
  alteracoesItem = item || "";
  showView("alteracoes");
  const root = $("#alteracoes-list");
  if (!laws2627) root.innerHTML = '<p class="mode-hint">A carregar…</p>';
  try {
    await ensureLaws2627();
  } catch (err) {
    if (token !== routeToken) return;
    root.textContent = err.message;
    return;
  }
  if (token !== routeToken) return;
  const changes = (laws2627 || []).reduce((sum, entry) => sum + ((entry.changes && entry.changes.length) || 0), 0);
  const lead = $("#alteracoes-lead");
  if (lead) {
    lead.textContent = (laws2627 || []).length + " entradas · " + changes + " alterações. Leis sem texto novo ficam como «Sem alterações».";
  }
  paintAlteracoes(alteracoesFocus);
}

function cardsForLaw(cards, law) {
  if (!law) return cards;
  if (law === "none") return cards.filter((card) => card.law == null);
  return cards.filter((card) => String(card.law) === String(law));
}

function writtenDeckId(testId, law) {
  return "te-" + testId + (law ? "-l" + law : "");
}

function startWritten(test, cards, mode) {
  const deckId = writtenDeckId(test.id, testesLaw);
  let title = test.title;
  if (testesLaw === "none") title += " · sem lei indicada";
  else if (testesLaw) title += " · Lei " + testesLaw;
  const deck = { title: title, cards: cards };
  deckCache[deckId] = deck;
  const meta = { id: deckId, title: title, file: "quiz-escritos.json", origin: "testes" };
  if (mode === "exam") startExam(meta);
  else startStudy(meta);
}

function paintTestes() {
  const grid = $("#testes-grid");
  if (!grid || !quizBundle) return;
  grid.innerHTML = "";
  const examMode = testesMode === "exam";
  $("#testes-rules").hidden = !examMode;
  $("#testes-mode-study").classList.toggle("active", !examMode);
  $("#testes-mode-exam").classList.toggle("active", examMode);
  $("#testes-mode-study").setAttribute("aria-pressed", examMode ? "false" : "true");
  $("#testes-mode-exam").setAttribute("aria-pressed", examMode ? "true" : "false");

  const all = [];
  for (const test of quizBundle) all.push.apply(all, test.cards);
  const rows = [{
    id: "todos",
    title: "Todos os testes",
    outdated: false,
    english: false,
    mixedSeason: all.some((card) => card.outdated),
    cards: all,
  }].concat(quizBundle);

  let visible = 0;
  for (const test of rows) {
    const cards = cardsForLaw(test.cards, testesLaw);
    if (!cards.length) continue;
    visible += 1;
    grid.appendChild(testDeckButton(test, cards, examMode));
  }
  if (!visible) {
    const empty = document.createElement("p");
    empty.className = "mode-hint";
    empty.textContent = "Sem perguntas para este filtro.";
    grid.appendChild(empty);
  }
}

function testDeckButton(test, cards, examMode) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "deck-card";
  const total = cards.length;
  const info = document.createElement("div");
  info.className = "deck-card-info";
  const h = document.createElement("h3");
  h.textContent = test.title;
  const p = document.createElement("p");
  const bits = [total + (total === 1 ? " pergunta" : " perguntas")];
  if (test.english) bits.push("em inglês");
  if (test.outdated) bits.push(SEASON_NOTE);
  else if (test.mixedSeason) bits.push("Inclui testes da época 2025/26");
  p.textContent = bits.join(" · ");
  info.appendChild(h);
  info.appendChild(p);
  const stats = document.createElement("div");
  stats.className = "deck-card-stats";
  const count = document.createElement("div");
  count.className = "deck-count";
  const label = document.createElement("div");
  label.className = "deck-count-label";
  const due = document.createElement("div");
  due.className = "deck-due";
  if (examMode) {
    count.textContent = String(total * POINTS_CORRECT);
    label.textContent = "pts máx.";
    due.textContent = "Iniciar exame";
  } else {
    const state = loadDeckState(writtenDeckId(test.id, testesLaw));
    const left = cards.filter((card) => {
      const cs = getCardState(state, card.id);
      return !cs.seen || isDue(cs);
    }).length;
    count.textContent = String(total);
    label.textContent = "cartas";
    due.textContent = left > 0 ? left + " por rever" : "Em dia";
    if (!left) due.style.color = "var(--green-muted)";
  }
  stats.appendChild(count);
  stats.appendChild(label);
  stats.appendChild(due);
  const chev = document.createElement("span");
  chev.className = "deck-chevron";
  chev.setAttribute("aria-hidden", "true");
  chev.textContent = "›";
  btn.appendChild(info);
  btn.appendChild(stats);
  btn.appendChild(chev);
  btn.addEventListener("click", () => startWritten(test, cards, examMode ? "exam" : "study"));
  return btn;
}

async function openTestes() {
  const token = routeToken;
  showView("testes");
  const grid = $("#testes-grid");
  if (!quizBundle) grid.innerHTML = '<p class="mode-hint">A carregar…</p>';
  try {
    await ensureQuiz();
  } catch (err) {
    if (token !== routeToken) return;
    grid.textContent = err.message;
    return;
  }
  if (token !== routeToken) return;
  const questions = quizBundle.reduce((sum, test) => sum + test.cards.length, 0);
  const untagged = quizBundle.reduce((sum, test) => sum + test.cards.filter((card) => card.law == null).length, 0);
  const lead = $("#testes-lead");
  if (lead) {
    lead.textContent = questions + " perguntas em " + quizBundle.length +
      " testes, com resposta oficial. A lei é uma indicação não oficial (" + untagged + " sem lei).";
  }
  paintTestes();
}

function inlineMd(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?»]|$)/g, "$1<em>$2</em>");
  return html;
}

function headingId(text) {
  // Keep in sync with scripts/build_citations.js headingId().
  const folded = normalize(text);
  if (/^co n/.test(folded)) {
    const co = /co n[^\d]*(\d+)/.exec(folded);
    if (co) return "co-" + co[1];
  }
  if (folded.indexOf("jogador lesionado") !== -1 || folded.indexOf("requisito de 1 minuto") !== -1) {
    return "esclarecimento-minuto";
  }
  if (/^2\.1\s+bolas oficiais/.test(folded)) return "bolas-oficiais";
  if (/^2\.2\s+substituicoes no futebol/.test(folded)) return "substituicoes-f11";
  const slug = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return slug || "sec";
}

function renderTable(lines) {
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const body = document.createElement("tbody");
  let headerDone = false;
  for (const line of lines) {
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    const tr = document.createElement("tr");
    const cellTag = headerDone ? "td" : "th";
    for (const cell of cells) {
      const el = document.createElement(cellTag);
      el.innerHTML = inlineMd(cell);
      tr.appendChild(el);
    }
    if (!headerDone) {
      head.appendChild(tr);
      headerDone = true;
    } else body.appendChild(tr);
  }
  if (head.childElementCount) table.appendChild(head);
  table.appendChild(body);
  return table;
}

function renderMarkdown(markdown) {
  const root = document.createElement("div");
  root.className = "reading-body wiki-body";
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      root.appendChild(document.createElement("hr"));
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const el = document.createElement("h" + level);
      el.id = headingId(heading[2]);
      el.innerHTML = inlineMd(heading[2]);
      if (typeof decorateHeading === "function") decorateHeading(el);
      root.appendChild(el);
      i += 1;
      continue;
    }
    if (line.trim().charAt(0) === "|") {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().charAt(0) === "|") {
        tableLines.push(lines[i]);
        i += 1;
      }
      root.appendChild(renderTable(tableLines));
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const ul = document.createElement("ul");
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const li = document.createElement("li");
        li.innerHTML = inlineMd(lines[i].replace(/^\s*[-*]\s+/, ""));
        ul.appendChild(li);
        i += 1;
      }
      root.appendChild(ul);
      continue;
    }
    const para = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|---|\||\s*[-*]\s)/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    const p = document.createElement("p");
    p.innerHTML = inlineMd(para.join(" "));
    root.appendChild(p);
  }
  return root;
}

function paintCircularesToc() {
  const toc = $("#circulares-toc");
  const body = $("#circulares-body");
  toc.innerHTML = "";
  const heads = body.querySelectorAll("h2");
  for (const head of heads) {
    const link = document.createElement("a");
    link.className = "toc-link";
    link.href = "#/circulares/" + encodeURIComponent(head.id);
    link.textContent = head.textContent;
    toc.appendChild(link);
  }
}

async function openCirculares(anchor) {
  const token = routeToken;
  showView("circulares");
  const body = $("#circulares-body");
  if (!circularesHtmlReady) body.innerHTML = '<p class="mode-hint">A carregar…</p>';
  try {
    if (!circularesHtmlReady) {
      const files = ["data/circulares.md", "data/esclarecimentos.md"];
      const parts = [];
      for (const file of files) {
        const res = await fetch(file);
        if (!res.ok) throw new Error("Não foi possível carregar " + file + ".");
        parts.push(await res.text());
      }
      if (token !== routeToken) return;
      body.innerHTML = "";
      for (let i = 0; i < parts.length; i += 1) {
        if (i) body.appendChild(document.createElement("hr"));
        body.appendChild(renderMarkdown(parts[i]));
      }
      paintCircularesToc();
      circularesHtmlReady = true;
    }
  } catch (err) {
    if (token !== routeToken) return;
    body.textContent = err.message;
    return;
  }
  if (token !== routeToken) return;
  if (anchor) {
    requestAnimationFrame(() => {
      const el = document.getElementById(anchor);
      if (el) el.scrollIntoView({ block: "start" });
    });
  }
}

function initOfficialEvents() {
  const form = $("#alteracoes-form");
  if (form) form.addEventListener("submit", (event) => event.preventDefault());
  const query = $("#alteracoes-query");
  if (query) {
    query.addEventListener("input", () => {
      clearTimeout(alteracoesTimer);
      alteracoesTimer = setTimeout(() => paintAlteracoes(""), 200);
    });
  }
  const law = $("#testes-law");
  if (law) {
    law.addEventListener("change", () => {
      testesLaw = law.value || "";
      if (quizBundle) paintTestes();
    });
  }
  document.querySelectorAll("#testes-mode .seg").forEach((btn) => {
    btn.addEventListener("click", () => {
      testesMode = btn.dataset.mode === "exam" ? "exam" : "study";
      if (quizBundle) paintTestes();
    });
  });
  const testesForm = $("#testes-form");
  if (testesForm) testesForm.addEventListener("submit", (event) => event.preventDefault());
}
