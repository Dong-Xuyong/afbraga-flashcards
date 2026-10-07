/**
 * AF Braga — Hoje, flashcards (SRS), exame, leis e wiki.
 * Exam scoring: correct +5, blank 0, wrong -2 (max 100)
 */

const STORAGE_PREFIX = "afbraga-srs";
const DAILY_KEY = "afbraga-daily";
const STATS_KEY = "afbraga-stats";
const NOTES_KEY = "afbraga-notes";
const POINTS_CORRECT = 5;
const POINTS_WRONG = -2;
const POINTS_BLANK = 0;

const INTERVALS = { again: 0, hard: 1, good: 3, easy: 7 };
const EASE_DELTA = { again: -0.2, hard: -0.1, good: 0, easy: 0.15 };
const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;

const NORMA_CHAPTERS = {
  0: "Cap. 0",
  1: "Cap. 1 — Antes do Jogo",
  2: "Cap. 2 — Durante o Jogo",
  3: "Cap. 3 — Após o Jogo",
  4: "Cap. 4 — Anexos",
};

const VIEWS = ["hoje", "home", "study", "exam", "leis", "reader", "wiki", "wiki-page", "alteracoes", "testes", "circulares"];

/** @type {{ decks: Array<{id:string,file:string,title:string,cardCount?:number,kind?:string}> }} */
let deckIndex = null;
/** @type {Record<string, object>} */
const deckCache = {};
/** @type {Record<string, object>} */
const cardIndex = {};

let lawsData = null;
let lawsPromise = null;
let sectionById = {};
let wikiData = null;
let wikiPromise = null;
let decksReady = null;

let homeMode = "study";
let routeToken = 0;
let leisTimer = 0;
let daily = null;
let hojeIndex = 0;
let hojeForceCard = false;
let hojeShowSummary = false;

let session = {
  deckId: null,
  deckTitle: null,
  cards: [],
  queue: [],
  currentIndex: 0,
  reviewedToday: 0,
  totalInSession: 0,
  completed: 0,
  isFlipped: false,
};

/** @type {{ deckId: string, deckTitle: string, cards: any[], answers: Record<number, string|null>, index: number } | null} */
let exam = null;

const $ = (sel) => document.querySelector(sel);

function storageKey(deckId) {
  return `${STORAGE_PREFIX}-${deckId}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && typeof data === "object") return data;
    }
  } catch (_) { /* ignore */ }
  return fallback;
}

function loadDeckState(deckId) {
  const state = loadJsonStorage(storageKey(deckId), null);
  if (state && state.cards) {
    if (state.lastStudyDate !== todayKey()) {
      state.reviewedToday = 0;
      state.lastStudyDate = todayKey();
    }
    return state;
  }
  return { cards: {}, lastStudyDate: todayKey(), reviewedToday: 0 };
}

function saveDeckState(deckId, state) {
  localStorage.setItem(storageKey(deckId), JSON.stringify(state));
}

function getCardState(state, cardId) {
  if (!state.cards[cardId]) {
    state.cards[cardId] = {
      interval: 0,
      ease: DEFAULT_EASE,
      dueDate: todayKey(),
      reviews: 0,
      lapses: 0,
      seen: false,
    };
  }
  return state.cards[cardId];
}

function isDue(cardState) {
  return cardState.dueDate <= todayKey();
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function scheduleCard(cs, rating) {
  cs.seen = true;
  cs.reviews += 1;
  if (rating === "again") {
    cs.lapses += 1;
    cs.ease = Math.max(MIN_EASE, cs.ease + EASE_DELTA.again);
    cs.interval = 0;
    cs.dueDate = todayKey();
    return true;
  }
  cs.ease = Math.max(MIN_EASE, cs.ease + (EASE_DELTA[rating] ?? 0));
  let days;
  if (cs.interval === 0) days = INTERVALS[rating];
  else if (rating === "hard") days = Math.max(1, Math.round(cs.interval * 1.2));
  else if (rating === "good") days = Math.max(1, Math.round(cs.interval * cs.ease));
  else days = Math.max(1, Math.round(cs.interval * cs.ease * 1.3));
  cs.interval = days;
  cs.dueDate = addDays(todayKey(), days);
  return false;
}

function rateDeckCard(deckId, cardId, rating) {
  const state = loadDeckState(deckId);
  const cs = getCardState(state, cardId);
  scheduleCard(cs, rating);
  state.reviewedToday += 1;
  state.lastStudyDate = todayKey();
  saveDeckState(deckId, state);
}

async function loadDeckIndex() {
  const res = await fetch("data/index.json");
  if (!res.ok) throw new Error("Não foi possível carregar data/index.json");
  deckIndex = await res.json();
}

async function loadDeck(deckMeta) {
  if (deckCache[deckMeta.id]) return deckCache[deckMeta.id];
  const res = await fetch(`data/${deckMeta.file}`);
  if (!res.ok) throw new Error(`Não foi possível carregar ${deckMeta.file}`);
  const data = await res.json();
  deckCache[deckMeta.id] = data;
  return data;
}

async function ensureDecksLoaded() {
  if (!decksReady) {
    decksReady = (async () => {
      for (const meta of deckIndex.decks) {
        const deck = await loadDeck(meta);
        for (const card of deck.cards || []) {
          cardIndex[card.id] = Object.assign({}, card, {
            deckId: meta.id,
            deckKind: meta.kind || "exam",
          });
        }
      }
    })().catch((err) => {
      decksReady = null;
      throw err;
    });
  }
  return decksReady;
}

async function ensureLaws() {
  if (lawsData) return lawsData;
  if (!lawsPromise) {
    lawsPromise = fetch("data/laws.json")
      .then((res) => {
        if (!res.ok) throw new Error("Não foi possível carregar as leis.");
        return res.json();
      })
      .then((data) => {
        lawsData = data;
        sectionById = {};
        for (const section of data.sections || []) sectionById[section.id] = section;
        return data;
      })
      .catch((err) => {
        lawsPromise = null;
        throw err;
      });
  }
  return lawsPromise;
}

async function ensureWiki() {
  if (wikiData) return wikiData;
  if (!wikiPromise) {
    wikiPromise = fetch("data/wiki.json")
      .then((res) => {
        if (!res.ok) throw new Error("Não foi possível carregar a wiki.");
        return res.json();
      })
      .then((data) => {
        wikiData = data;
        return data;
      })
      .catch((err) => {
        wikiPromise = null;
        throw err;
      });
  }
  return wikiPromise;
}

function showView(name) {
  for (const view of VIEWS) {
    const el = document.getElementById("view-" + view);
    if (el) el.classList.toggle("hidden", view !== name);
  }
  const tab = tabForView(name);
  document.querySelectorAll("#app-nav [role='tab']").forEach((link) => {
    const on = link.dataset.tab === tab;
    link.setAttribute("aria-selected", on ? "true" : "false");
    link.classList.toggle("active", on);
  });
  const titles = {
    hoje: "Hoje",
    flashcards: "Flashcards",
    exame: "Exame",
    leis: "Leis",
    wiki: "Wiki",
    testes: "Testes",
    alteracoes: "Alterações",
    circulares: "Circulares",
  };
  document.title = "AF Braga — " + (titles[tab] || "Hoje");
  const current = document.querySelector("#app-nav [aria-selected='true']");
  const nav = document.getElementById("app-nav");
  if (current && nav) {
    const navRect = nav.getBoundingClientRect();
    const tabRect = current.getBoundingClientRect();
    if (tabRect.left < navRect.left || tabRect.right > navRect.right) {
      nav.scrollLeft += tabRect.left - navRect.left - (navRect.width - tabRect.width) / 2;
    }
  }
}

function tabForView(name) {
  if (name === "home") return homeMode === "exam" ? "exame" : "flashcards";
  if (name === "study") return session.origin === "testes" ? "testes" : "flashcards";
  if (name === "exam") return exam && exam.origin === "testes" ? "testes" : "exame";
  if (name === "leis" || name === "reader") return "leis";
  if (name === "wiki" || name === "wiki-page") return "wiki";
  if (name === "alteracoes" || name === "testes" || name === "circulares") return name;
  return "hoje";
}

function escapeHtml(str) {
  const el = document.createElement("span");
  el.textContent = str ?? "";
  return el.innerHTML;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

function parseHash() {
  const raw = (location.hash || "#/hoje").replace(/^#/, "");
  const parts = raw.split("/").filter(Boolean).map(safeDecode);
  const name = parts[0] || "hoje";
  if (name === "flashcards") return { name: "flashcards" };
  if (name === "exame") return { name: "exame" };
  if (name === "leis") {
    if (parts[1] === "page" && parts[2]) {
      return { name: "leis-page", slug: parts.slice(2).join("/") };
    }
    if (parts[1]) return { name: "leis-block", id: parts[1] };
    return { name: "leis" };
  }
  if (name === "wiki") {
    if (parts[1]) return { name: "wiki-page", slug: parts.slice(1).join("/") };
    return { name: "wiki" };
  }
  if (name === "alteracoes") return { name: "alteracoes", law: parts[1] || "" };
  if (name === "testes") return { name: "testes" };
  if (name === "circulares") return { name: "circulares", anchor: parts[1] || "" };
  return { name: "hoje" };
}

function answerLettersOf(card) {
  if (!card) return [];
  if (Array.isArray(card.answers) && card.answers.length) {
    return card.answers.map((letter) => String(letter));
  }
  const raw = card.answer == null ? "" : String(card.answer).trim();
  if (/^[A-D](?:\/[A-D])+$/.test(raw)) return raw.split("/");
  return raw ? [raw] : [];
}

function choiceIsCorrect(card, letter) {
  return answerLettersOf(card).indexOf(letter) !== -1;
}

function examKey(card) {
  return card && card.id ? card.id : String(card.number);
}

function formatCorrectAnswer(card) {
  const letters = answerLettersOf(card);
  if (!letters.length) return (card && card.answerText) || "";
  return letters.map((letter) => {
    const text = card.options && card.options[letter];
    return text ? letter + ". " + text : letter;
  }).join(" · ");
}

function setStatusChip(el, card) {
  if (!el) return;
  el.classList.remove("change-chip--season", "change-chip--gone");
  if (card && card.outdated) {
    el.classList.remove("hidden");
    el.textContent = "Época 2025/26";
    el.classList.add("change-chip--season");
    return;
  }
  el.textContent = "Alterado 26/27";
  el.classList.toggle("hidden", !cardHasChange(card));
}

function appendWrittenMeta(container, card) {
  if (!container || !card || !card.written) return;
  const src = document.createElement("p");
  src.className = "card-source";
  const strong = document.createElement("strong");
  strong.textContent = "Teste: ";
  src.appendChild(strong);
  src.appendChild(document.createTextNode(card.source || ""));
  container.appendChild(src);
  const law = document.createElement("p");
  law.className = "card-source";
  law.textContent = card.law == null
    ? "Sem lei indicada (não oficial)."
    : "Lei " + card.law + " (não oficial).";
  container.appendChild(law);
}

function returnToOrigin(origin) {
  if (origin === "testes") {
    if ((location.hash || "") !== "#/testes") location.hash = "#/testes";
    else openTestes();
    return;
  }
  renderHome();
}

function cardHasChange(card) {
  for (const id of (card && card.lawRefs) || []) {
    const section = sectionById[id];
    if (section && (section.changed || section.isNew)) return true;
  }
  return false;
}

function headingNumber(heading) {
  const parts = String(heading || "").split("›").map((part) => part.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const num = parts[i].match(/^(\d+(?:\.\d+)*)/);
    if (num) return num[1];
  }
  return "";
}

function lawLinkLabel(section) {
  const title = section.pageTitle || section.slug || section.id;
  const lei = title.match(/^Lei\s+\d+/);
  const normas = title.match(/^Normas\s+Cap\.\s*\d+\s*§\s*[\d.]+/);
  const base = (lei && lei[0]) || (normas && normas[0]) || title;
  const num = headingNumber(section.heading);
  if (num) return "Ver " + base + " · " + num;
  return "Ver " + base;
}

function explanationHtml(text) {
  const source = String(text || "");
  const re = /(?<![A-Za-z0-9-])\^?(l\d+-\d+-\d+[a-z]?|n\d-\d+-[0-9a-z-]+|x-[a-z-]+-\d+)(?![A-Za-z0-9-])/g;
  let html = "";
  let last = 0;
  let match;
  while ((match = re.exec(source))) {
    html += escapeHtml(source.slice(last, match.index));
    const id = match[1];
    const section = sectionById[id];
    const label = section ? lawLinkLabel(section).replace(/^Ver\s+/, "") : id;
    html += '<a href="#/leis/' + encodeURIComponent(id) + '">' + escapeHtml(label) + "</a>";
    last = match.index + match[0].length;
  }
  html += escapeHtml(source.slice(last));
  return html;
}

function fillExplanation(container, text, prefix) {
  const p = document.createElement("p");
  p.className = "card-explanation";
  if (prefix) {
    const strong = document.createElement("strong");
    strong.textContent = prefix;
    p.appendChild(strong);
  }
  const body = document.createElement("span");
  body.innerHTML = explanationHtml(text);
  p.appendChild(body);
  container.appendChild(p);
}

function buildLawLinks(card) {
  const refs = (card && card.lawRefs) || [];
  const wrap = document.createElement("div");
  wrap.className = "law-links";
  for (const id of refs) {
    const section = sectionById[id];
    if (!section) continue;
    const link = document.createElement("a");
    link.href = "#/leis/" + encodeURIComponent(id);
    link.textContent = lawLinkLabel(section);
    link.addEventListener("click", (event) => event.stopPropagation());
    wrap.appendChild(link);
  }
  return wrap.childElementCount ? wrap : null;
}

function fillCardAside(container, card) {
  if (!container) return;
  container.innerHTML = "";
  if (card && card.explanation) fillExplanation(container, card.explanation, "Explicação: ");
  const links = buildLawLinks(card);
  if (links) container.appendChild(links);
  appendWrittenMeta(container, card);
}

async function renderHome() {
  const token = routeToken;
  showView("home");
  const examMode = homeMode === "exam";
  $("#home-title").textContent = examMode ? "Exame" : "Flashcards";
  $("#mode-hint").textContent = examMode
    ? "Simulação do teste escrito com cotação oficial da AF Braga."
    : "Repetição espaçada para estudar carta a carta.";
  $("#home-section-label").textContent = examMode ? "Escolher teste" : "Escolher baralho";
  $("#exam-rules-note").hidden = !examMode;

  const deckGrid = $("#deck-grid");
  const extraGrid = $("#deck-grid-extra");
  const extraSection = $("#extra-deck-section");
  deckGrid.innerHTML = "";
  extraGrid.innerHTML = "";

  const decks = deckIndex.decks || [];
  const examDecks = decks.filter((meta) => !meta.kind || meta.kind === "exam");
  const extraDecks = decks.filter((meta) => meta.kind === "scenario" || meta.kind === "changes");

  for (const meta of examDecks) {
    if (token !== routeToken) return;
    deckGrid.appendChild(await deckButton(meta, examMode ? "exam" : "study"));
  }
  if (!examMode && extraDecks.length) {
    extraSection.classList.remove("hidden");
    for (const meta of extraDecks) {
      if (token !== routeToken) return;
      extraGrid.appendChild(await deckButton(meta, "study"));
    }
  } else {
    extraSection.classList.add("hidden");
  }
}

async function deckButton(meta, mode) {
  const deck = await loadDeck(meta);
  const total = deck.cards.length;
  const btn = document.createElement("button");
  btn.className = "deck-card";
  btn.type = "button";
  if (mode === "exam") {
    const maxPts = total * POINTS_CORRECT;
    btn.innerHTML = `
      <div class="deck-card-info">
        <h3>${escapeHtml(meta.title)}</h3>
        <p>Exame escrito · ${total} perguntas</p>
      </div>
      <div class="deck-card-stats">
        <div class="deck-count">${maxPts}</div>
        <div class="deck-count-label">pts máx.</div>
        <div class="deck-due">Iniciar exame</div>
      </div>
      <span class="deck-chevron" aria-hidden="true">›</span>
    `;
    btn.addEventListener("click", () => startExam(meta));
  } else {
    const state = loadDeckState(meta.id);
    const due = deck.cards.filter((card) => {
      const cs = getCardState(state, card.id);
      return !cs.seen || isDue(cs);
    }).length;
    btn.innerHTML = `
      <div class="deck-card-info">
        <h3>${escapeHtml(meta.title)}</h3>
        <p>Flashcards · repetição espaçada</p>
      </div>
      <div class="deck-card-stats">
        <div class="deck-count">${total}</div>
        <div class="deck-count-label">cartas</div>
        ${due > 0 ? `<div class="deck-due">${due} por rever</div>` : `<div class="deck-due" style="color:var(--green-muted)">Em dia</div>`}
      </div>
      <span class="deck-chevron" aria-hidden="true">›</span>
    `;
    btn.addEventListener("click", () => startStudy(meta));
  }
  return btn;
}

async function maybeLoadLaws(cards) {
  const needs = (cards || []).some((card) =>
    (card.lawRefs && card.lawRefs.length) ||
    (card.explanation && /\^?(?:l\d|n\d-|x-)/.test(card.explanation))
  );
  if (needs) {
    try {
      await ensureLaws();
    } catch (_) { /* links stay as ids */ }
  }
}

// --- Study ---

async function startStudy(meta) {
  const deck = await loadDeck(meta);
  await maybeLoadLaws(deck.cards);
  const state = loadDeckState(meta.id);
  const dueCards = [];
  const newCards = [];

  for (const card of deck.cards) {
    const cs = getCardState(state, card.id);
    if (!cs.seen) newCards.push(card);
    else if (isDue(cs)) dueCards.push(card);
  }

  const queue = [...dueCards, ...newCards];

  if (queue.length === 0) {
    session = {
      deckId: meta.id,
      deckTitle: deck.title,
      cards: deck.cards,
      queue: [],
      currentIndex: 0,
      reviewedToday: state.reviewedToday,
      totalInSession: 0,
      completed: 0,
      isFlipped: false,
      origin: meta.origin || null,
    };
    const backLabel = $("#btn-back-label");
    if (backLabel) backLabel.textContent = meta.origin === "testes" ? "Testes" : "Baralhos";
    showView("study");
    showStudyComplete(true);
    return;
  }

  session = {
    deckId: meta.id,
    deckTitle: deck.title,
    cards: deck.cards,
    queue: [...queue],
    currentIndex: 0,
    reviewedToday: state.reviewedToday,
    totalInSession: queue.length,
    completed: 0,
    isFlipped: false,
    origin: meta.origin || null,
    _state: state,
  };

  const backLabel = $("#btn-back-label");
  if (backLabel) backLabel.textContent = meta.origin === "testes" ? "Testes" : "Baralhos";
  const backBtn = $("#btn-back");
  if (backBtn) backBtn.setAttribute("aria-label", meta.origin === "testes" ? "Voltar aos testes" : "Voltar aos baralhos");
  showView("study");
  $("#session-done").classList.add("hidden");
  $("#flashcard").classList.remove("hidden");
  $("#rating-panel").classList.add("hidden");
  $("#flashcard").classList.remove("is-flipped");
  $("#study-deck-name").textContent = deck.title;
  renderCurrentCard();
  updateProgress();
}

function getCurrentCard() {
  return session.queue[session.currentIndex] ?? null;
}

function fillOptionsList(listEl, options, correct) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!options) return;
  const letters = Array.isArray(correct) ? correct : (correct ? [correct] : []);
  for (const key of ["A", "B", "C", "D"]) {
    const text = options[key];
    if (text == null || text === "") continue;
    const li = document.createElement("li");
    li.className = "option-item" + (letters.indexOf(key) !== -1 ? " is-correct" : "");
    li.innerHTML = `<span class="option-key">${key}.</span>${escapeHtml(text)}`;
    listEl.appendChild(li);
  }
}

function renderCurrentCard() {
  const card = getCurrentCard();
  if (!card) {
    showStudyComplete(false);
    return;
  }

  session.isFlipped = false;
  $("#flashcard").classList.remove("is-flipped");
  $("#rating-panel").classList.add("hidden");
  $("#flashcard").classList.remove("hidden");

  const numLabel = `Carta ${card.number}`;
  $("#card-number").textContent = numLabel;
  $("#card-number-back").textContent = numLabel;
  $("#card-question").textContent = card.question;

  setStatusChip($("#card-change-chip"), card);
  setStatusChip($("#card-change-chip-back"), card);

  const letters = answerLettersOf(card);
  $("#answer-letter").textContent = letters.join(" / ");
  $("#answer-text").textContent =
    card.answerText || letters.map((letter) => card.options && card.options[letter]).filter(Boolean).join(" ou ");

  const sourceEl = $("#card-source");
  if (sourceEl) {
    const repeated = card.source && session.deckTitle && session.deckTitle.indexOf(card.source) === 0;
    sourceEl.hidden = !card.source || repeated;
    sourceEl.textContent = card.source || "";
  }

  fillOptionsList($("#options-list-front"), card.options, null);
  fillOptionsList($("#options-list"), card.options, letters);
  fillCardAside($("#card-aside"), card);
  updateProgress();
}

function updateProgress() {
  const remaining = session.queue.length - session.currentIndex;
  const done = session.completed;
  const total = session.totalInSession;
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;

  $("#stat-remaining").textContent = `${remaining} restante${remaining !== 1 ? "s" : ""}`;
  $("#stat-reviewed").textContent = `${session.reviewedToday} revista${session.reviewedToday !== 1 ? "s" : ""} hoje`;
  $("#progress-fill").style.width = `${pct}%`;
  $("#progress-bar").setAttribute("aria-valuenow", String(pct));
}

function flipCard() {
  if ($("#view-study").classList.contains("hidden")) return;
  if (session.isFlipped || !getCurrentCard()) return;
  session.isFlipped = true;
  $("#flashcard").classList.add("is-flipped");
  $("#rating-panel").classList.remove("hidden");
}

function rateCard(rating) {
  const card = getCurrentCard();
  if (!card || !session.isFlipped) return;

  const state = session._state;
  const cs = getCardState(state, card.id);
  const requeue = scheduleCard(cs, rating);
  if (requeue) {
    session.queue.splice(session.currentIndex + 1, 0, Object.assign({}, card));
  } else {
    session.currentIndex += 1;
  }

  state.reviewedToday += 1;
  state.lastStudyDate = todayKey();
  session.reviewedToday = state.reviewedToday;
  session.completed += 1;
  saveDeckState(session.deckId, state);
  renderCurrentCard();
}

function showStudyComplete(alreadyDone) {
  $("#flashcard").classList.add("hidden");
  $("#rating-panel").classList.add("hidden");
  $("#session-done").classList.remove("hidden");
  $("#done-text").textContent = alreadyDone
    ? "Todas as cartas deste baralho estão em dia. Volta mais tarde ou escolhe outro baralho."
    : `Reviste ${session.completed} carta${session.completed !== 1 ? "s" : ""} nesta sessão.`;
  updateProgress();
}

// --- Exam ---

async function startExam(meta) {
  const deck = await loadDeck(meta);
  await maybeLoadLaws(deck.cards);
  const numbers = new Set(deck.cards.map((card) => card.number));
  const cards = numbers.size === deck.cards.length
    ? [...deck.cards].sort((a, b) => a.number - b.number)
    : [...deck.cards];
  const answers = {};
  for (const card of cards) answers[examKey(card)] = null;

  exam = {
    deckId: meta.id,
    deckTitle: deck.title || meta.title,
    cards,
    answers,
    index: 0,
    meta,
    origin: meta.origin || null,
  };
  const homeBtn = $("#btn-exam-home");
  if (homeBtn) homeBtn.textContent = meta.origin === "testes" ? "Voltar aos testes" : "Voltar ao início";

  showView("exam");
  $("#exam-sheet").classList.remove("hidden");
  $("#exam-results").classList.add("hidden");
  $("#exam-deck-name").textContent = exam.deckTitle;
  renderExamQuestion();
}

function answeredCount() {
  if (!exam) return 0;
  return Object.values(exam.answers).filter((value) => value != null).length;
}

function renderExamQuestion() {
  if (!exam) return;
  const card = exam.cards[exam.index];
  const total = exam.cards.length;
  const n = exam.index + 1;

  $("#exam-q-number").textContent = `Pergunta ${card.number}`;
  setStatusChip($("#exam-change-chip"), card);
  $("#exam-question").textContent = card.question;
  const examSource = $("#exam-source");
  if (examSource) {
    const repeated = card.source && exam.deckTitle && exam.deckTitle.indexOf(card.source) === 0;
    examSource.hidden = !card.source || repeated;
    examSource.textContent = card.source || "";
  }
  $("#exam-progress-label").textContent = `Pergunta ${n} / ${total}`;
  $("#exam-answered-label").textContent = `${answeredCount()} respondida${answeredCount() !== 1 ? "s" : ""}`;
  const pct = Math.round(((n - 1) / total) * 100);
  $("#exam-progress-fill").style.width = `${pct}%`;
  $("#exam-progress-bar").setAttribute("aria-valuenow", String(pct));

  const selected = exam.answers[examKey(card)];
  const box = $("#exam-options");
  box.innerHTML = "";
  for (const key of ["A", "B", "C", "D"]) {
    const text = card.options?.[key];
    if (!text) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "exam-option" + (selected === key ? " is-selected" : "");
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", selected === key ? "true" : "false");
    btn.innerHTML = `<span class="exam-option-key">${key}</span><span>${escapeHtml(text)}</span>`;
    btn.addEventListener("click", () => {
      exam.answers[examKey(card)] = key;
      renderExamQuestion();
    });
    box.appendChild(btn);
  }

  $("#btn-exam-prev").disabled = exam.index === 0;
  const isLast = exam.index >= total - 1;
  $("#btn-exam-next").classList.toggle("hidden", isLast);
  $("#btn-exam-submit").classList.toggle("hidden", !isLast);
}

function examGo(delta) {
  if (!exam) return;
  exam.index = Math.max(0, Math.min(exam.cards.length - 1, exam.index + delta));
  renderExamQuestion();
}

function clearExamAnswer() {
  if (!exam) return;
  const card = exam.cards[exam.index];
  exam.answers[examKey(card)] = null;
  renderExamQuestion();
}

function scoreExam() {
  let score = 0;
  let correct = 0;
  let wrong = 0;
  let blank = 0;
  const rows = [];

  for (const card of exam.cards) {
    const chosen = exam.answers[examKey(card)];
    let status;
    let points;
    if (chosen == null) {
      status = "blank";
      points = POINTS_BLANK;
      blank += 1;
    } else if (choiceIsCorrect(card, chosen)) {
      status = "correct";
      points = POINTS_CORRECT;
      correct += 1;
    } else {
      status = "wrong";
      points = POINTS_WRONG;
      wrong += 1;
    }
    score += points;
    rows.push({ card, chosen, status, points });
  }

  const max = exam.cards.length * POINTS_CORRECT;
  return { score, max, correct, wrong, blank, rows };
}

function submitExam() {
  if (!exam) return;
  const blanks = answeredCount() < exam.cards.length;
  if (blanks) {
    const ok = window.confirm(
      `Ainda há ${exam.cards.length - answeredCount()} pergunta(s) em branco.\nSubmeter mesmo assim?`
    );
    if (!ok) return;
  }

  const result = scoreExam();
  $("#exam-sheet").classList.add("hidden");
  $("#exam-results").classList.remove("hidden");

  $("#exam-score").textContent = String(result.score);
  $("#exam-score-max").textContent = String(result.max);
  const pct = result.max ? Math.round((result.score / result.max) * 100) : 0;
  $("#exam-score-pct").textContent = `${pct}% da cotação máxima`;

  $("#exam-breakdown").innerHTML = `
    <div class="exam-stat">
      <span class="exam-stat-value">${result.correct}</span>
      <span class="exam-stat-label">Certas</span>
    </div>
    <div class="exam-stat exam-stat--wrong">
      <span class="exam-stat-value">${result.wrong}</span>
      <span class="exam-stat-label">Erradas</span>
    </div>
    <div class="exam-stat">
      <span class="exam-stat-value">${result.blank}</span>
      <span class="exam-stat-label">Em branco</span>
    </div>
  `;

  const review = $("#exam-review");
  review.innerHTML = "";
  for (const row of result.rows) {
    if (row.status === "correct") continue;
    const div = document.createElement("div");
    div.className = `exam-review-item is-${row.status}`;
    const your =
      row.chosen == null
        ? "Sem resposta"
        : `${row.chosen}. ${row.card.options?.[row.chosen] || ""}`;
    const right = formatCorrectAnswer(row.card);
    div.innerHTML = `
      <div class="exam-review-head">Pergunta ${row.card.number} · ${row.points} pts</div>
      <div class="exam-review-detail"><strong>Sua resposta:</strong> ${escapeHtml(your)}</div>
      <div class="exam-review-detail"><strong>Correta:</strong> ${escapeHtml(right)}</div>
    `;
    if (row.card.explanation) {
      const detail = document.createElement("div");
      detail.className = "exam-review-detail";
      const strong = document.createElement("strong");
      strong.textContent = "Explicação: ";
      const body = document.createElement("span");
      body.innerHTML = explanationHtml(row.card.explanation);
      detail.appendChild(strong);
      detail.appendChild(body);
      div.appendChild(detail);
    }
    const links = buildLawLinks(row.card);
    if (links) div.appendChild(links);
    appendWrittenMeta(div, row.card);
    review.appendChild(div);
  }
  if (!review.children.length) {
    review.innerHTML =
      '<div class="exam-review-item is-correct"><div class="exam-review-head">Todas corretas</div><div class="exam-review-detail">Excelente trabalho.</div></div>';
  }

  $("#exam-progress-fill").style.width = "100%";
  $("#exam-progress-label").textContent = "Exame concluído";
  $("#exam-answered-label").textContent = `${result.score} pts`;
}

function leaveExam() {
  const origin = exam && exam.origin;
  if (!$("#exam-results").classList.contains("hidden")) {
    exam = null;
    returnToOrigin(origin);
    return;
  }
  const ok = window.confirm("Sair do exame? As respostas atuais serão perdidas.");
  if (ok) {
    exam = null;
    returnToOrigin(origin);
  }
}

// --- Hoje ---

function loadStats() {
  const data = loadJsonStorage(STATS_KEY, null);
  if (!data) return { byLaw: {}, streak: { count: 0, lastDate: null } };
  if (!data.byLaw) data.byLaw = {};
  if (!data.streak) data.streak = { count: 0, lastDate: null };
  return data;
}

function saveStats(stats) {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

function loadNotes() {
  return loadJsonStorage(NOTES_KEY, {});
}

function saveNotes(notes) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function updateNote(id, patch) {
  const all = loadNotes();
  const cur = all[id] || { bookmarked: false, note: "" };
  const next = Object.assign({}, cur, patch, { updated: new Date().toISOString() });
  if (!next.bookmarked && !(next.note || "").trim()) delete all[id];
  else all[id] = next;
  saveNotes(all);
  return next;
}

function loadDaily() {
  const data = loadJsonStorage(DAILY_KEY, null);
  if (!data || data.date !== todayKey() || !Array.isArray(data.ids) || !data.answers) return null;
  return data;
}

function saveDaily(data) {
  localStorage.setItem(DAILY_KEY, JSON.stringify(data));
}

function isoShift(iso, days) {
  const parts = String(iso).split("-");
  const dt = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function visibleStreakCount(streak, today) {
  if (!streak || !streak.lastDate) return 0;
  if (streak.lastDate === today || streak.lastDate === isoShift(today, -1)) return streak.count || 0;
  return 0;
}

function hashDate(dateStr) {
  let hash = 2166136261;
  for (let i = 0; i < dateStr.length; i += 1) {
    hash ^= dateStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function () {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dailyPool() {
  const kinds = { exam: true, scenario: true, changes: true };
  return Object.keys(cardIndex)
    .map((id) => cardIndex[id])
    .filter((card) => kinds[card.deckKind || "exam"])
    .sort((a, b) => (a.deckId || "").localeCompare(b.deckId || "") || (a.number || 0) - (b.number || 0) || a.id.localeCompare(b.id));
}

function srsSnapshot(cards) {
  const byDeck = {};
  const out = {};
  for (const card of cards) {
    if (!byDeck[card.deckId]) byDeck[card.deckId] = loadDeckState(card.deckId);
    const cs = byDeck[card.deckId].cards[card.id];
    if (cs) out[card.id] = cs;
  }
  return out;
}

function ensureDailySet() {
  const stored = loadDaily();
  if (stored) return stored;
  const today = todayKey();
  const cards = dailyPool();
  const ids = pickDaily(cards, srsSnapshot(cards), loadStats(), today, 10, mulberry32(hashDate(today)), sectionById);
  const answers = {};
  for (const id of ids) answers[id] = null;
  const created = { date: today, ids, answers };
  saveDaily(created);
  return created;
}

function recordLawStats(card, correct) {
  const keys = lawKeysOfCard(card, sectionById);
  if (!keys.length) return;
  const stats = loadStats();
  for (const key of keys) {
    if (!stats.byLaw[key]) stats.byLaw[key] = { right: 0, wrong: 0 };
    if (correct) stats.byLaw[key].right += 1;
    else stats.byLaw[key].wrong += 1;
  }
  saveStats(stats);
}

function dailyDone() {
  return !!(daily && daily.ids.length && daily.ids.every((id) => daily.answers[id]));
}

function syncStreakIfComplete() {
  if (!dailyDone()) return;
  const stats = loadStats();
  const next = nextStreak(stats.streak, todayKey());
  if (!stats.streak || next.count !== stats.streak.count || next.lastDate !== stats.streak.lastDate) {
    stats.streak = next;
    saveStats(stats);
  }
}

function paintHojeHeader() {
  const stats = loadStats();
  const count = visibleStreakCount(stats.streak, todayKey());
  $("#hoje-streak").textContent = "🔥 " + count + (count === 1 ? " dia" : " dias");
  const total = daily && daily.ids ? daily.ids.length : 0;
  const answered = daily ? daily.ids.filter((id) => daily.answers[id]).length : 0;
  $("#hoje-progress").textContent = total ? answered + " de " + total : "Sem perguntas";
  const pct = total ? Math.round((answered / total) * 100) : 0;
  $("#hoje-progress-fill").style.width = pct + "%";
  $("#hoje-progress-bar").setAttribute("aria-valuenow", String(pct));
}

function paintHeatmap() {
  const root = $("#law-heatmap");
  root.innerHTML = "";
  const stats = loadStats();
  for (let n = 1; n <= 17; n += 1) {
    const row = stats.byLaw[String(n)] || { right: 0, wrong: 0 };
    const total = (row.right || 0) + (row.wrong || 0);
    const link = document.createElement("a");
    link.className = "heat-cell" + (total ? "" : " is-empty");
    if (total) {
      const acc = row.right / total;
      link.classList.add(acc >= 0.8 ? "heat-high" : acc >= 0.5 ? "heat-mid" : "heat-low");
      link.setAttribute("aria-label", "Lei " + n + ", " + Math.round(acc * 100) + "% de acertos");
    } else {
      link.setAttribute("aria-label", "Lei " + n + ", sem dados");
    }
    link.href = "#/leis/page/lei-" + String(n).padStart(2, "0");
    link.textContent = String(n);
    root.appendChild(link);
  }
}

function paintHoje() {
  paintHojeHeader();
  paintHeatmap();
  const stage = $("#hoje-stage");
  stage.innerHTML = "";
  if (!daily || !daily.ids.length) {
    stage.innerHTML = '<p class="mode-hint">Ainda não há perguntas.</p>';
    return;
  }
  if (hojeShowSummary && !hojeForceCard) {
    stage.appendChild(hojeSummary());
    return;
  }
  stage.appendChild(hojeCard());
}

function hojeSummary() {
  const wrap = document.createElement("div");
  const title = document.createElement("h2");
  title.className = "done-title";
  title.textContent = "Dia concluído";
  wrap.appendChild(title);
  const list = document.createElement("ol");
  list.className = "daily-summary";
  daily.ids.forEach((id, index) => {
    const card = cardIndex[id];
    const chosen = daily.answers[id];
    const ok = card && choiceIsCorrect(card, chosen);
    const li = document.createElement("li");
    li.className = ok ? "is-correct" : "is-wrong";
    const meta = document.createElement("p");
    meta.className = "summary-meta";
    meta.textContent = (index + 1) + ". " + (ok ? "Certa" : "Errada");
    const q = document.createElement("p");
    q.className = "summary-q";
    q.textContent = card ? card.question : id;
    li.appendChild(meta);
    li.appendChild(q);
    if (card && card.explanation) fillExplanation(li, card.explanation, "");
    const links = card ? buildLawLinks(card) : null;
    if (links) li.appendChild(links);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "btn-ghost text-action";
    open.textContent = "Rever";
    open.addEventListener("click", () => {
      hojeIndex = index;
      hojeForceCard = true;
      hojeShowSummary = false;
      paintHoje();
    });
    li.appendChild(open);
    list.appendChild(li);
  });
  wrap.appendChild(list);
  return wrap;
}

function hojeCard() {
  const id = daily.ids[hojeIndex];
  const card = cardIndex[id];
  const chosen = daily.answers[id];
  const sheet = document.createElement("div");
  sheet.className = "exam-sheet hoje-sheet";
  const kicker = document.createElement("span");
  kicker.className = "card-number";
  kicker.textContent = "Pergunta " + (hojeIndex + 1) + " de " + daily.ids.length;
  sheet.appendChild(kicker);
  if (!card) {
    const p = document.createElement("p");
    p.textContent = "Esta pergunta já não está no baralho.";
    sheet.appendChild(p);
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "btn-primary";
    skip.textContent = "Saltar";
    skip.addEventListener("click", () => {
      if (!daily.answers[id]) {
        daily.answers[id] = "?";
        saveDaily(daily);
      }
      hojeNext();
    });
    sheet.appendChild(skip);
    return sheet;
  }
  if (cardHasChange(card)) {
    const chip = document.createElement("span");
    chip.className = "change-chip";
    chip.textContent = "Alterado 26/27";
    sheet.appendChild(chip);
  }
  const question = document.createElement("p");
  question.className = "card-question";
  question.textContent = card.question;
  sheet.appendChild(question);
  const box = document.createElement("div");
  box.className = "exam-options";
  box.setAttribute("role", "radiogroup");
  box.setAttribute("aria-label", "Opções de resposta");
  for (const key of ["A", "B", "C", "D"]) {
    const text = card.options?.[key];
    if (!text) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "exam-option";
    btn.setAttribute("role", "radio");
    if (chosen) {
      btn.disabled = true;
      if (choiceIsCorrect(card, key)) btn.classList.add("is-correct");
      if (key === chosen && !choiceIsCorrect(card, key)) btn.classList.add("is-wrong");
    }
    btn.innerHTML = `<span class="exam-option-key">${key}</span><span>${escapeHtml(text)}</span>`;
    btn.addEventListener("click", () => answerHoje(key));
    box.appendChild(btn);
  }
  sheet.appendChild(box);
  if (chosen && chosen !== "?") {
    const reveal = document.createElement("div");
    fillCardAside(reveal, card);
    const verdict = document.createElement("p");
    verdict.className = "summary-meta";
    verdict.textContent = choiceIsCorrect(card, chosen) ? "Certa" : "Errada";
    reveal.insertBefore(verdict, reveal.firstChild);
    sheet.appendChild(reveal);
    const next = document.createElement("button");
    next.type = "button";
    next.className = "btn-primary";
    const open = daily.ids.findIndex((item) => !daily.answers[item]);
    next.textContent = open === -1 ? (hojeShowSummary ? "Seguinte" : "Ver resumo") : "Seguinte";
    if (dailyDone()) next.textContent = "Ver resumo";
    next.addEventListener("click", hojeNext);
    sheet.appendChild(next);
  }
  return sheet;
}

function answerHoje(letter) {
  const id = daily.ids[hojeIndex];
  if (!id || daily.answers[id]) return;
  const card = cardIndex[id];
  daily.answers[id] = letter;
  saveDaily(daily);
  if (card) {
    recordLawStats(card, choiceIsCorrect(card, letter));
    rateDeckCard(card.deckId, card.id, choiceIsCorrect(card, letter) ? "good" : "again");
  }
  hojeForceCard = true;
  syncStreakIfComplete();
  paintHoje();
}

function hojeNext() {
  const open = daily.ids.findIndex((id) => !daily.answers[id]);
  hojeForceCard = false;
  if (open === -1) hojeShowSummary = true;
  else {
    hojeIndex = open;
    hojeShowSummary = false;
  }
  paintHoje();
}

async function openHoje() {
  const token = routeToken;
  showView("hoje");
  $("#hoje-stage").innerHTML = '<p class="mode-hint">A carregar…</p>';
  await ensureDecksLoaded();
  if (token !== routeToken) return;
  try {
    await ensureLaws();
  } catch (_) { /* weights fall back to 0.5 */ }
  if (token !== routeToken) return;
  daily = ensureDailySet();
  syncStreakIfComplete();
  const open = daily.ids.findIndex((id) => !daily.answers[id]);
  hojeShowSummary = open === -1 && daily.ids.length > 0;
  hojeForceCard = false;
  hojeIndex = open === -1 ? 0 : open;
  paintHoje();
}

// --- Leis ---

function currentLawFilters() {
  return {
    doc: $("#leis-doc").value || "",
    law: $("#leis-law").value || "",
    changedOnly: $("#leis-changed").getAttribute("aria-pressed") === "true",
  };
}

function sectionPasses(section, filters) {
  if (filters.doc && section.doc !== filters.doc) return false;
  if (filters.law !== "" && filters.law != null && String(section.law) !== String(filters.law)) return false;
  if (filters.changedOnly && !(section.changed || section.isNew)) return false;
  return true;
}

function markedHtml(text, query) {
  const sn = snippet(String(text || ""), query, 90);
  let html = "";
  let cursor = 0;
  for (const range of sn.ranges || []) {
    const start = Math.max(0, Math.min(sn.text.length, range.start));
    const end = Math.max(start, Math.min(sn.text.length, range.end));
    html += escapeHtml(sn.text.slice(cursor, start));
    html += "<mark>" + escapeHtml(sn.text.slice(start, end)) + "</mark>";
    cursor = end;
  }
  html += escapeHtml(sn.text.slice(cursor));
  return html;
}

function pagesFrom(sections) {
  const map = new Map();
  for (const section of sections) {
    if (!map.has(section.slug)) {
      map.set(section.slug, {
        slug: section.slug,
        title: section.pageTitle,
        law: section.law,
        doc: section.doc,
        order: section.order,
        changed: false,
      });
    }
    if (section.changed || section.isNew) map.get(section.slug).changed = true;
  }
  return [...map.values()].sort((a, b) => a.order - b.order);
}

function tocLink(page) {
  const link = document.createElement("a");
  link.className = "toc-link";
  link.href = "#/leis/page/" + encodeURIComponent(page.slug);
  link.textContent = page.title || page.slug;
  if (page.changed) {
    const chip = document.createElement("small");
    chip.textContent = "Alterado 26/27";
    link.appendChild(chip);
  }
  return link;
}

function paintToc(root, filters) {
  const sections = (lawsData.sections || []).filter((section) => sectionPasses(section, filters));
  const pages = pagesFrom(sections);
  const narrowed = !!(filters.doc || filters.law || filters.changedOnly);
  const laws = document.createElement("div");
  const lawsTitle = document.createElement("h3");
  lawsTitle.className = "section-label reader-heading";
  lawsTitle.textContent = "Leis do Jogo";
  const lawsList = document.createElement("div");
  lawsList.className = "toc";
  if (filters.doc !== "normas-2018") {
    for (let n = 1; n <= 17; n += 1) {
      if (filters.law && String(filters.law) !== String(n)) continue;
      const page = pages.find((item) => item.doc === "leis-2526" && Number(item.law) === n);
      if (narrowed && !page) continue;
      if (page) lawsList.appendChild(tocLink(page));
      else if (!narrowed) {
        const missing = document.createElement("span");
        missing.className = "toc-link is-missing";
        missing.textContent = "Lei " + n;
        lawsList.appendChild(missing);
      }
    }
  }
  if (lawsList.childElementCount) {
    laws.appendChild(lawsTitle);
    laws.appendChild(lawsList);
    root.appendChild(laws);
  }

  const extras = pages.filter((page) => String(page.slug || "").startsWith("extra-"));
  if (extras.length && filters.doc !== "normas-2018" && !filters.law) {
    const title = document.createElement("h3");
    title.className = "section-label reader-heading";
    title.textContent = "Outras partes";
    const list = document.createElement("div");
    list.className = "toc";
    extras.forEach((page) => list.appendChild(tocLink(page)));
    root.appendChild(title);
    root.appendChild(list);
  }

  const normas = pages.filter((page) => page.doc === "normas-2018");
  if (normas.length && filters.doc !== "leis-2526") {
    const groups = new Map();
    for (const page of normas) {
      const match = /^c(\d+)-/.exec(page.slug || "");
      const chapter = match ? Number(match[1]) : 0;
      if (!groups.has(chapter)) groups.set(chapter, []);
      groups.get(chapter).push(page);
    }
    [...groups.keys()].sort((a, b) => a - b).forEach((chapter) => {
      const title = document.createElement("h3");
      title.className = "section-label reader-heading";
      title.textContent = NORMA_CHAPTERS[chapter] || "Cap. " + chapter;
      const list = document.createElement("div");
      list.className = "toc";
      groups.get(chapter).forEach((page) => list.appendChild(tocLink(page)));
      root.appendChild(title);
      root.appendChild(list);
    });
  }

  if (!root.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "mode-hint";
    empty.textContent = "Ainda não há páginas.";
    root.appendChild(empty);
  }
}

function paintLeis() {
  if (!lawsData) return;
  const root = $("#leis-results");
  root.innerHTML = "";
  const query = $("#leis-query").value || "";
  const filters = currentLawFilters();
  if (!query.trim()) {
    paintToc(root, filters);
    return;
  }
  const hits = searchSections(lawsData.sections || [], query, {
    doc: filters.doc,
    law: filters.law,
    changedOnly: filters.changedOnly,
  });
  if (!hits.length) {
    root.innerHTML = '<p class="mode-hint">Sem resultados.</p>';
    return;
  }
  const list = document.createElement("div");
  list.className = "result-list";
  for (const hit of hits) {
    const link = document.createElement("a");
    link.className = "result-card";
    link.href = "#/leis/" + encodeURIComponent(hit.id);
    const kicker = document.createElement("span");
    kicker.className = "result-kicker";
    const label = hit.heading ? hit.pageTitle + " › " + hit.heading : hit.pageTitle;
    kicker.innerHTML = markedHtml(label, query);
    link.appendChild(kicker);
    if (hit.isNew || hit.changed) {
      const chip = document.createElement("span");
      chip.className = "change-chip";
      chip.textContent = hit.isNew ? "Novo em 26/27" : "Alterado 26/27";
      link.appendChild(chip);
    }
    const source = snippetSource(hit, query);
    const snippetText = source === "change" ? (hit.changeText || "") : (hit.text || "");
    if (source === "change") {
      const tag = document.createElement("span");
      tag.className = "result-source";
      tag.textContent = "Texto 26/27";
      link.appendChild(tag);
    }
    const snip = document.createElement("p");
    snip.className = "result-snippet";
    snip.innerHTML = markedHtml(snippetText, query);
    link.appendChild(snip);
    list.appendChild(link);
  }
  root.appendChild(list);
  if (hits.length === 50) {
    const note = document.createElement("p");
    note.className = "results-note";
    note.textContent = "Mostram-se os 50 primeiros.";
    root.appendChild(note);
  }
}

async function openLeis() {
  const token = routeToken;
  showView("leis");
  const root = $("#leis-results");
  if (!lawsData) root.innerHTML = '<p class="mode-hint">A carregar…</p>';
  try {
    await ensureLaws();
  } catch (err) {
    if (token !== routeToken) return;
    root.textContent = err.message;
    return;
  }
  if (token !== routeToken) return;
  paintLeis();
}

function docPdf(docId) {
  const doc = (lawsData.docs || []).find((item) => item.id === docId);
  return doc ? doc.pdf : null;
}

function renderReader(slug, focusId) {
  const sections = (lawsData.sections || [])
    .filter((section) => section.slug === slug)
    .sort((a, b) => a.order - b.order);
  const title = $("#reader-title");
  const body = $("#reader-body");
  body.innerHTML = "";
  if (!sections.length) {
    $("#reader-kicker").textContent = "";
    title.textContent = slug;
    body.innerHTML = '<p class="mode-hint">Esta página ainda não tem blocos.</p>';
    return;
  }
  const first = sections[0];
  const doc = (lawsData.docs || []).find((item) => item.id === first.doc);
  $("#reader-kicker").textContent = doc ? doc.title : "";
  title.textContent = first.pageTitle || slug;
  let lastHeading = null;
  for (const section of sections) {
    if (section.heading !== lastHeading) {
      const heading = document.createElement("h3");
      heading.className = "reader-heading";
      heading.textContent = section.heading || "Introdução";
      body.appendChild(heading);
      lastHeading = section.heading;
    }
    body.appendChild(renderLawBlock(section, focusId === section.id));
  }
  if (focusId) {
    requestAnimationFrame(() => {
      const el = document.getElementById("blk-" + focusId);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.classList.add("is-flash");
      setTimeout(() => el.classList.remove("is-flash"), 1600);
    });
  }
}

function isEliminatedChange(section) {
  const folded = normalize(section.changeText || "").replace(/[.\s]+$/g, "");
  return folded === "texto eliminado em 2026/27";
}

function appendRich(parent, html, text) {
  if (html) {
    const wrap = document.createElement("div");
    wrap.className = "law-block-html";
    wrap.innerHTML = html;
    parent.appendChild(wrap);
    return;
  }
  const p = document.createElement("p");
  p.className = "law-block-text";
  p.textContent = text || "";
  parent.appendChild(p);
}

function appendStruck(parent, section) {
  const oldWrap = document.createElement("div");
  oldWrap.className = "law-old";
  const label = document.createElement("span");
  label.className = "change-kicker change-kicker--old";
  label.textContent = "Texto 2025/26";
  const del = document.createElement("del");
  if (section.html) del.innerHTML = section.html;
  else del.textContent = section.text || "";
  oldWrap.appendChild(label);
  oldWrap.appendChild(del);
  parent.appendChild(oldWrap);
}

function appendInForce(parent, html, text, kickerText) {
  const box = document.createElement("div");
  box.className = "change-box";
  const kicker = document.createElement("span");
  kicker.className = "change-kicker";
  kicker.textContent = kickerText;
  box.appendChild(kicker);
  appendRich(box, html, text);
  parent.appendChild(box);
}

function renderLawBlock(section, actionsOpen) {
  const article = document.createElement("article");
  article.className = "law-block" + (actionsOpen ? " is-open" : "");
  article.id = "blk-" + section.id;
  article.tabIndex = 0;
  article.setAttribute("aria-expanded", actionsOpen ? "true" : "false");
  const eliminated = section.changed && !section.isNew && isEliminatedChange(section);

  if (section.isNew) {
    appendInForce(article, section.html, section.text, "Novo em 26/27");
  } else if (eliminated) {
    const chip = document.createElement("span");
    chip.className = "change-chip change-chip--gone";
    chip.textContent = "Eliminado em 26/27";
    article.appendChild(chip);
    appendStruck(article, section);
  } else if (section.changed && section.changeText) {
    const chip = document.createElement("span");
    chip.className = "change-chip";
    chip.textContent = "Alterado 26/27";
    article.appendChild(chip);
    appendInForce(article, section.changeHtml, section.changeText, "Texto 26/27");
    appendStruck(article, section);
  } else {
    appendRich(article, section.html, section.text);
  }

  const actions = document.createElement("div");
  actions.className = "block-actions";
  const notes = loadNotes();
  const note = notes[section.id] || { bookmarked: false, note: "" };

  const star = document.createElement("button");
  star.type = "button";
  star.setAttribute("aria-pressed", note.bookmarked ? "true" : "false");
  star.setAttribute("aria-label", note.bookmarked ? "Remover marcador" : "Marcar");
  star.textContent = note.bookmarked ? "★" : "☆";
  star.addEventListener("click", () => {
    const current = loadNotes()[section.id] || { bookmarked: false, note: "" };
    const saved = updateNote(section.id, { bookmarked: !current.bookmarked, note: current.note || "" });
    const on = !!(saved && saved.bookmarked);
    star.setAttribute("aria-pressed", on ? "true" : "false");
    star.setAttribute("aria-label", on ? "Remover marcador" : "Marcar");
    star.textContent = on ? "★" : "☆";
    refreshMarks();
  });
  actions.appendChild(star);

  const noteBtn = document.createElement("button");
  noteBtn.type = "button";
  noteBtn.textContent = "Nota";
  const area = document.createElement("textarea");
  area.className = "block-note" + (note.note ? "" : " hidden");
  area.value = note.note || "";
  area.setAttribute("aria-label", "Nota sobre este bloco");
  noteBtn.setAttribute("aria-expanded", note.note ? "true" : "false");
  noteBtn.addEventListener("click", () => {
    const open = area.classList.toggle("hidden");
    noteBtn.setAttribute("aria-expanded", open ? "false" : "true");
    if (!open) area.focus();
  });
  area.addEventListener("blur", () => {
    const current = loadNotes()[section.id] || { bookmarked: false, note: "" };
    updateNote(section.id, { bookmarked: !!current.bookmarked, note: area.value });
    refreshMarks();
  });
  actions.appendChild(noteBtn);

  const pdf = docPdf(section.doc);
  if (pdf && section.page != null) {
    const link = document.createElement("a");
    link.href = pdf + "#page=" + section.page;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "PDF p." + section.page;
    actions.appendChild(link);
  }
  if ((section.changed || section.isNew) && section.changePage != null) {
    const alt = docPdf("alteracoes-2627");
    if (alt) {
      const link = document.createElement("a");
      link.href = alt + "#page=" + section.changePage;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Alterações p." + section.changePage;
      actions.appendChild(link);
    }
  }

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copiar ligação";
  copy.addEventListener("click", async () => {
    const url = location.href.split("#")[0] + "#/leis/" + encodeURIComponent(section.id);
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch (_) {
      const field = document.createElement("textarea");
      field.value = url;
      document.body.appendChild(field);
      field.select();
      try { ok = document.execCommand("copy"); } catch (__) { ok = false; }
      field.remove();
    }
    if (ok) {
      copy.textContent = "Copiado";
      setTimeout(() => { copy.textContent = "Copiar ligação"; }, 1200);
    }
  });
  actions.appendChild(copy);
  article.appendChild(actions);
  article.appendChild(area);

  const marks = document.createElement("div");
  marks.className = "block-indicators";
  const starMark = document.createElement("span");
  starMark.className = "block-indicator";
  starMark.textContent = "★";
  starMark.setAttribute("aria-hidden", "true");
  const noteMark = document.createElement("span");
  noteMark.className = "block-indicator";
  noteMark.textContent = "📝";
  noteMark.setAttribute("aria-hidden", "true");
  marks.appendChild(starMark);
  marks.appendChild(noteMark);
  article.appendChild(marks);

  function refreshMarks() {
    const current = loadNotes()[section.id] || {};
    starMark.hidden = !current.bookmarked;
    noteMark.hidden = !(current.note || "").trim();
  }
  refreshMarks();

  function toggleActions(event) {
    if (event.target.closest("a, button, textarea, input, select")) return;
    const open = article.classList.toggle("is-open");
    article.setAttribute("aria-expanded", open ? "true" : "false");
  }
  article.addEventListener("click", toggleActions);
  article.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.target !== article) return;
    event.preventDefault();
    const open = article.classList.toggle("is-open");
    article.setAttribute("aria-expanded", open ? "true" : "false");
  });
  return article;
}

async function openReader(slug, focusId) {
  const token = routeToken;
  showView("reader");
  $("#reader-body").innerHTML = '<p class="mode-hint">A carregar…</p>';
  try {
    await ensureLaws();
  } catch (err) {
    if (token !== routeToken) return;
    $("#reader-title").textContent = "Leis";
    $("#reader-body").textContent = err.message;
    return;
  }
  if (token !== routeToken) return;
  let pageSlug = slug;
  if (!pageSlug && focusId) {
    const section = sectionById[focusId];
    if (!section) {
      $("#reader-kicker").textContent = "";
      $("#reader-title").textContent = "Bloco não encontrado";
      $("#reader-body").innerHTML = '<p class="mode-hint">Este bloco ainda não está nas leis.</p>';
      return;
    }
    pageSlug = section.slug;
  }
  renderReader(pageSlug, focusId);
}

// --- Wiki ---

function paintBookmarks(root) {
  const title = document.createElement("h2");
  title.className = "section-label";
  title.textContent = "Os meus marcadores";
  root.appendChild(title);
  const notes = loadNotes();
  const ids = Object.keys(notes).filter((id) => notes[id].bookmarked || (notes[id].note || "").trim());
  if (!ids.length) {
    const empty = document.createElement("p");
    empty.className = "mode-hint";
    empty.textContent = "Ainda não há marcadores.";
    root.appendChild(empty);
    return;
  }
  for (const id of ids) {
    const card = document.createElement("article");
    card.className = "bookmark-card";
    const section = sectionById[id];
    const link = document.createElement("a");
    link.href = "#/leis/" + encodeURIComponent(id);
    const label = section
      ? (section.heading ? section.pageTitle + " › " + section.heading : section.pageTitle)
      : id;
    link.textContent = label;
    card.appendChild(link);
    if ((notes[id].note || "").trim()) {
      const p = document.createElement("p");
      p.textContent = notes[id].note;
      card.appendChild(p);
    }
    root.appendChild(card);
  }
}

function paintWiki() {
  const root = $("#wiki-list");
  root.innerHTML = "";
  const order = ["Visão geral", "Conceitos", "Fontes", "Alterações"];
  const pages = (wikiData && wikiData.pages) || [];
  const seen = new Set();
  for (const group of order) {
    const items = pages.filter((page) => page.group === group);
    if (!items.length) continue;
    seen.add(group);
    const title = document.createElement("h2");
    title.className = "section-label";
    title.textContent = group;
    const list = document.createElement("div");
    list.className = "toc";
    for (const page of items) {
      const link = document.createElement("a");
      link.className = "toc-link";
      link.href = "#/wiki/" + encodeURIComponent(page.slug);
      link.textContent = page.title || page.slug;
      if (page.updated) {
        const small = document.createElement("small");
        small.textContent = page.updated;
        link.appendChild(small);
      }
      list.appendChild(link);
    }
    root.appendChild(title);
    root.appendChild(list);
  }
  if (!pages.length) {
    const empty = document.createElement("p");
    empty.className = "mode-hint";
    empty.textContent = "Ainda não há páginas na wiki.";
    root.appendChild(empty);
  }
  paintBookmarks(root);
}

async function openWiki() {
  const token = routeToken;
  showView("wiki");
  $("#wiki-list").innerHTML = '<p class="mode-hint">A carregar…</p>';
  try {
    await ensureWiki();
    try { await ensureLaws(); } catch (_) { /* bookmarks still list ids */ }
  } catch (err) {
    if (token !== routeToken) return;
    $("#wiki-list").textContent = err.message;
    return;
  }
  if (token !== routeToken) return;
  paintWiki();
}

async function openWikiPage(slug) {
  const token = routeToken;
  showView("wiki-page");
  $("#wiki-article").innerHTML = '<p class="mode-hint">A carregar…</p>';
  try {
    await ensureWiki();
  } catch (err) {
    if (token !== routeToken) return;
    $("#wiki-article").textContent = err.message;
    return;
  }
  if (token !== routeToken) return;
  const page = (wikiData.pages || []).find((item) => item.slug === slug);
  if (!page) {
    $("#wiki-article").textContent = "Página não encontrada.";
    return;
  }
  $("#wiki-article").innerHTML = page.html || "";
}

// --- Routing ---

async function renderRoute() {
  const token = ++routeToken;
  const route = parseHash();
  const examVisible = !$("#view-exam").classList.contains("hidden");
  const resultsHidden = $("#exam-results").classList.contains("hidden");
  if (exam && examVisible && resultsHidden && route.name !== "exame") {
    const ok = window.confirm("Sair do exame? As respostas atuais serão perdidas.");
    if (!ok) {
      if (location.hash !== "#/exame") location.hash = "#/exame";
      return;
    }
    exam = null;
  }
  if (token !== routeToken) return;

  if (route.name === "hoje") return openHoje();
  if (route.name === "flashcards") {
    homeMode = "study";
    return renderHome();
  }
  if (route.name === "exame") {
    if (exam && !$("#view-exam").classList.contains("hidden")) {
      showView("exam");
      return;
    }
    exam = null;
    homeMode = "exam";
    return renderHome();
  }
  if (route.name === "leis") return openLeis();
  if (route.name === "leis-page") return openReader(route.slug, null);
  if (route.name === "leis-block") return openReader(null, route.id);
  if (route.name === "wiki") return openWiki();
  if (route.name === "wiki-page") return openWikiPage(route.slug);
  if (route.name === "alteracoes") return openAlteracoes(route.law);
  if (route.name === "testes") return openTestes();
  if (route.name === "circulares") return openCirculares(route.anchor);
  return openHoje();
}

function showBootError(message) {
  const text = "Erro ao carregar dados: " + message + ". Serve a pasta com um servidor local (ver README).";
  const grid = $("#deck-grid");
  if (grid) grid.innerHTML = `<p class="boot-error">${escapeHtml(text)}</p>`;
  const stage = $("#hoje-stage");
  if (stage) stage.textContent = text;
}

function initEvents() {
  $("#flashcard").addEventListener("click", (event) => {
    if (event.target.closest("a, button")) return;
    flipCard();
  });
  $("#flashcard").addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      flipCard();
    }
  });
  document.querySelectorAll(".rate-btn").forEach((btn) => {
    btn.addEventListener("click", () => rateCard(btn.dataset.rating));
  });
  $("#btn-back").addEventListener("click", () => returnToOrigin(session.origin));
  $("#btn-done-home").addEventListener("click", () => returnToOrigin(session.origin));
  $("#btn-exam-back").addEventListener("click", leaveExam);
  $("#btn-exam-prev").addEventListener("click", () => examGo(-1));
  $("#btn-exam-next").addEventListener("click", () => examGo(1));
  $("#btn-exam-clear").addEventListener("click", clearExamAnswer);
  $("#btn-exam-submit").addEventListener("click", submitExam);
  $("#btn-exam-home").addEventListener("click", () => {
    const origin = exam && exam.origin;
    exam = null;
    returnToOrigin(origin);
  });
  $("#btn-exam-retry").addEventListener("click", () => {
    if (exam?.meta) startExam(exam.meta);
  });
  $("#btn-reader-back").addEventListener("click", () => { location.hash = "#/leis"; });
  $("#btn-wiki-back").addEventListener("click", () => { location.hash = "#/wiki"; });
  $("#leis-form").addEventListener("submit", (event) => event.preventDefault());
  $("#leis-query").addEventListener("input", () => {
    clearTimeout(leisTimer);
    leisTimer = setTimeout(paintLeis, 200);
  });
  $("#leis-doc").addEventListener("change", paintLeis);
  $("#leis-law").addEventListener("change", paintLeis);
  $("#leis-changed").addEventListener("click", () => {
    const on = $("#leis-changed").getAttribute("aria-pressed") === "true";
    $("#leis-changed").setAttribute("aria-pressed", on ? "false" : "true");
    paintLeis();
  });

  document.addEventListener("keydown", (event) => {
    const tag = event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (!$("#view-exam").classList.contains("hidden") && exam && $("#exam-results").classList.contains("hidden")) {
      const keyMap = { KeyA: "A", KeyB: "B", KeyC: "C", KeyD: "D", Digit1: "A", Digit2: "B", Digit3: "C", Digit4: "D" };
      if (keyMap[event.code]) {
        event.preventDefault();
        const card = exam.cards[exam.index];
        exam.answers[examKey(card)] = keyMap[event.code];
        renderExamQuestion();
        return;
      }
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        examGo(-1);
        return;
      }
      if (event.code === "ArrowRight") {
        event.preventDefault();
        if (exam.index >= exam.cards.length - 1) submitExam();
        else examGo(1);
        return;
      }
    }

    if ($("#view-study").classList.contains("hidden")) return;

    if (event.code === "Space" && !session.isFlipped) {
      event.preventDefault();
      flipCard();
      return;
    }

    if (session.isFlipped) {
      const map = { Digit1: "again", Digit2: "hard", Digit3: "good", Digit4: "easy" };
      const rating = map[event.code];
      if (rating) {
        event.preventDefault();
        rateCard(rating);
      }
    }
  });

  document.querySelectorAll("#app-nav [role='tab']").forEach((link) => {
    link.addEventListener("click", () => {
      if (link.getAttribute("href") === (location.hash || "")) {
        renderRoute().catch((err) => showBootError(err.message));
      }
    });
  });

  window.addEventListener("hashchange", () => {
    renderRoute().catch((err) => showBootError(err.message));
  });
}

async function init() {
  try {
    await loadDeckIndex();
    initEvents();
    initOfficialEvents();
    if (!location.hash || location.hash === "#") location.replace("#/hoje");
    else await renderRoute();
  } catch (err) {
    showBootError(err.message);
  }
}

init();
