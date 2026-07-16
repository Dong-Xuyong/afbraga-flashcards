/**
 * AF Braga Flashcards — spaced repetition study app
 */

const STORAGE_PREFIX = "afbraga-srs";

/** Interval presets in days (approximate, Anki-flavored) */
const INTERVALS = {
  again: 0,      // re-queue in session
  hard: 1,
  good: 3,
  easy: 7,
};

const EASE_DELTA = {
  again: -0.2,
  hard: -0.1,
  good: 0,
  easy: 0.15,
};

const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;

/** @type {{ decks: Array<{id:string,file:string,title:string,description:string}> }} */
let deckIndex = null;

/** @type {Record<string, object>} */
const deckCache = {};

/** Current session state */
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

// DOM refs
const $ = (sel) => document.querySelector(sel);

const viewHome = $("#view-home");
const viewStudy = $("#view-study");
const deckGrid = $("#deck-grid");
const flashcard = $("#flashcard");
const flashcardInner = $("#flashcard-inner");
const ratingPanel = $("#rating-panel");
const sessionDone = $("#session-done");

// --- Storage helpers ---

function storageKey(deckId) {
  return `${STORAGE_PREFIX}-${deckId}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** @returns {{ cards: Record<string, CardState>, lastStudyDate: string, reviewedToday: number }} */
function loadDeckState(deckId) {
  try {
    const raw = localStorage.getItem(storageKey(deckId));
    if (raw) {
      const state = JSON.parse(raw);
      if (state.lastStudyDate !== todayKey()) {
        state.reviewedToday = 0;
        state.lastStudyDate = todayKey();
      }
      return state;
    }
  } catch (_) { /* ignore */ }
  return { cards: {}, lastStudyDate: todayKey(), reviewedToday: 0 };
}

function saveDeckState(deckId, state) {
  localStorage.setItem(storageKey(deckId), JSON.stringify(state));
}

/**
 * @typedef {object} CardState
 * @property {number} interval - days until next review
 * @property {number} ease
 * @property {string} dueDate - ISO date (YYYY-MM-DD)
 * @property {number} reviews
 * @property {number} lapses
 * @property {boolean} seen
 */

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

// --- Data loading ---

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

// --- Views ---

function showView(name) {
  viewHome.classList.toggle("hidden", name !== "home");
  viewStudy.classList.toggle("hidden", name !== "study");
}

async function renderHome() {
  showView("home");
  deckGrid.innerHTML = "";

  for (const meta of deckIndex.decks) {
    const deck = await loadDeck(meta);
    const state = loadDeckState(meta.id);
    const total = deck.cards.length;
    const due = deck.cards.filter((c) => {
      const cs = getCardState(state, c.id);
      return !cs.seen || isDue(cs);
    }).length;

    const btn = document.createElement("button");
    btn.className = "deck-card";
    btn.type = "button";
    btn.innerHTML = `
      <div class="deck-card-info">
        <h3>${escapeHtml(meta.title)}</h3>
        <p>${escapeHtml(meta.description)}</p>
      </div>
      <div class="deck-card-stats">
        <div class="deck-count">${total}</div>
        <div class="deck-count-label">cartas</div>
        ${due > 0 ? `<div class="deck-due">${due} por rever</div>` : `<div class="deck-due" style="color:var(--green-muted)">em dia</div>`}
      </div>
    `;
    btn.addEventListener("click", () => startStudy(meta));
    deckGrid.appendChild(btn);
  }
}

function escapeHtml(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

// --- Study session ---

async function startStudy(meta) {
  const deck = await loadDeck(meta);
  const state = loadDeckState(meta.id);

  const dueCards = [];
  const newCards = [];

  for (const card of deck.cards) {
    const cs = getCardState(state, card.id);
    if (!cs.seen) {
      newCards.push(card);
    } else if (isDue(cs)) {
      dueCards.push(card);
    }
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
    };
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
    _state: state,
  };

  showView("study");
  sessionDone.classList.add("hidden");
  flashcard.classList.remove("hidden");
  ratingPanel.classList.add("hidden");
  flashcard.classList.remove("is-flipped");

  $("#study-deck-name").textContent = deck.title;
  renderCurrentCard();
  updateProgress();
}

function getCurrentCard() {
  return session.queue[session.currentIndex] ?? null;
}

function renderCurrentCard() {
  const card = getCurrentCard();
  if (!card) {
    showStudyComplete(false);
    return;
  }

  session.isFlipped = false;
  flashcard.classList.remove("is-flipped");
  ratingPanel.classList.add("hidden");
  flashcard.classList.remove("hidden");

  const numLabel = `Carta ${card.number}`;
  $("#card-number").textContent = numLabel;
  $("#card-number-back").textContent = numLabel;
  $("#card-question").textContent = card.question;

  const letter = card.answer;
  $("#answer-letter").textContent = letter;
  $("#answer-text").textContent = card.answerText || (card.options && card.options[letter]) || "";

  fillOptionsList($("#options-list-front"), card.options, null);
  fillOptionsList($("#options-list"), card.options, letter);

  updateProgress();
}

/** @param {HTMLElement|null} listEl @param {Record<string,string>|undefined} options @param {string|null} correctLetter */
function fillOptionsList(listEl, options, correctLetter) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!options) return;
  for (const key of ["A", "B", "C", "D"]) {
    const text = options[key];
    if (text == null || text === "") continue;
    const li = document.createElement("li");
    li.className =
      "option-item" + (correctLetter && key === correctLetter ? " is-correct" : "");
    li.innerHTML = `<span class="option-key">${key}.</span>${escapeHtml(text)}`;
    listEl.appendChild(li);
  }
}

function updateProgress() {
  const remaining = session.queue.length - session.currentIndex;
  const done = session.completed;
  const total = session.totalInSession;
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;

  $("#stat-remaining").textContent = `${remaining} restante${remaining !== 1 ? "s" : ""}`;
  $("#stat-reviewed").textContent = `${session.reviewedToday} revista${session.reviewedToday !== 1 ? "s" : ""} hoje`;

  const fill = $("#progress-fill");
  fill.style.width = `${pct}%`;
  const bar = $("#progress-bar");
  bar.setAttribute("aria-valuenow", String(pct));
}

function flipCard() {
  if (session.isFlipped || !getCurrentCard()) return;
  session.isFlipped = true;
  flashcard.classList.add("is-flipped");
  ratingPanel.classList.remove("hidden");
}

function rateCard(rating) {
  const card = getCurrentCard();
  if (!card || !session.isFlipped) return;

  const state = session._state;
  const cs = getCardState(state, card.id);
  cs.seen = true;
  cs.reviews += 1;

  if (rating === "again") {
    cs.lapses += 1;
    cs.ease = Math.max(MIN_EASE, cs.ease + EASE_DELTA.again);
    cs.interval = 0;
    cs.dueDate = todayKey();
    const requeue = { ...card };
    session.queue.splice(session.currentIndex + 1, 0, requeue);
  } else {
    cs.ease = Math.max(MIN_EASE, cs.ease + (EASE_DELTA[rating] ?? 0));

    let days;
    if (cs.interval === 0) {
      days = INTERVALS[rating];
    } else if (rating === "hard") {
      days = Math.max(1, Math.round(cs.interval * 1.2));
    } else if (rating === "good") {
      days = Math.max(1, Math.round(cs.interval * cs.ease));
    } else {
      days = Math.max(1, Math.round(cs.interval * cs.ease * 1.3));
    }

    cs.interval = days;
    cs.dueDate = addDays(todayKey(), days);
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
  flashcard.classList.add("hidden");
  ratingPanel.classList.add("hidden");
  sessionDone.classList.remove("hidden");

  const text = alreadyDone
    ? "Todas as cartas deste baralho estão em dia. Volta mais tarde ou escolhe outro baralho."
    : `Reviste ${session.completed} carta${session.completed !== 1 ? "s" : ""} nesta sessão.`;
  $("#done-text").textContent = text;
  updateProgress();
}

// --- Event listeners ---

function initEvents() {
  flashcard.addEventListener("click", (e) => {
    if (e.target.closest(".rating-panel")) return;
    flipCard();
  });

  flashcard.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      flipCard();
    }
  });

  document.querySelectorAll(".rate-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      rateCard(btn.dataset.rating);
    });
  });

  $("#btn-back").addEventListener("click", () => renderHome());
  $("#btn-done-home").addEventListener("click", () => renderHome());

  document.addEventListener("keydown", (e) => {
    if (viewStudy.classList.contains("hidden")) return;

    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.code === "Space" && !session.isFlipped) {
      e.preventDefault();
      flipCard();
      return;
    }

    if (session.isFlipped) {
      const map = { Digit1: "again", Digit2: "hard", Digit3: "good", Digit4: "easy" };
      const rating = map[e.code];
      if (rating) {
        e.preventDefault();
        rateCard(rating);
      }
    }
  });
}

// --- Boot ---

async function init() {
  try {
    await loadDeckIndex();
    initEvents();
    await renderHome();
  } catch (err) {
    deckGrid.innerHTML = `<p style="color:var(--again);padding:1rem;">Erro ao carregar dados: ${escapeHtml(err.message)}. Serve a pasta com um servidor local (ver README).</p>`;
  }
}

init();
