/**
 * AF Braga — Flashcards (SRS) + official exam simulation
 * Exam scoring: correct +5, blank 0, wrong -2 (max 100)
 */

const STORAGE_PREFIX = "afbraga-srs";
const POINTS_CORRECT = 5;
const POINTS_WRONG = -2;
const POINTS_BLANK = 0;

const INTERVALS = { again: 0, hard: 1, good: 3, easy: 7 };
const EASE_DELTA = { again: -0.2, hard: -0.1, good: 0, easy: 0.15 };
const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;

/** @type {{ decks: Array<{id:string,file:string,title:string,cardCount?:number}> }} */
let deckIndex = null;
/** @type {Record<string, object>} */
const deckCache = {};

let homeMode = "study"; // "study" | "exam"

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
const viewHome = $("#view-home");
const viewStudy = $("#view-study");
const viewExam = $("#view-exam");
const deckGrid = $("#deck-grid");
const flashcard = $("#flashcard");
const ratingPanel = $("#rating-panel");
const sessionDone = $("#session-done");

function storageKey(deckId) {
  return `${STORAGE_PREFIX}-${deckId}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

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

function showView(name) {
  viewHome.classList.toggle("hidden", name !== "home");
  viewStudy.classList.toggle("hidden", name !== "study");
  viewExam.classList.toggle("hidden", name !== "exam");
}

function escapeHtml(str) {
  const el = document.createElement("span");
  el.textContent = str ?? "";
  return el.innerHTML;
}

function setHomeMode(mode) {
  homeMode = mode;
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  const hint = $("#mode-hint");
  const label = $("#home-section-label");
  const rules = $("#exam-rules-note");
  if (mode === "exam") {
    hint.textContent = "Simulação do teste escrito com cotação oficial da AF Braga.";
    label.textContent = "Escolher teste";
    rules.hidden = false;
  } else {
    hint.textContent = "Repetição espaçada para estudar carta a carta.";
    label.textContent = "Escolher baralho";
    rules.hidden = true;
  }
  renderHome();
}

async function renderHome() {
  showView("home");
  deckGrid.innerHTML = "";

  for (const meta of deckIndex.decks) {
    const deck = await loadDeck(meta);
    const total = deck.cards.length;
    const btn = document.createElement("button");
    btn.className = "deck-card";
    btn.type = "button";

    if (homeMode === "exam") {
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
      `;
      btn.addEventListener("click", () => startExam(meta));
    } else {
      const state = loadDeckState(meta.id);
      const due = deck.cards.filter((c) => {
        const cs = getCardState(state, c.id);
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
          ${due > 0 ? `<div class="deck-due">${due} por rever</div>` : `<div class="deck-due" style="color:var(--green-muted)">En dia</div>`}
        </div>
      `;
      btn.addEventListener("click", () => startStudy(meta));
    }
    deckGrid.appendChild(btn);
  }
}

// --- Study ---

async function startStudy(meta) {
  const deck = await loadDeck(meta);
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
    };
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
  $("#answer-text").textContent =
    card.answerText || (card.options && card.options[letter]) || "";

  fillOptionsList($("#options-list-front"), card.options, null);
  fillOptionsList($("#options-list"), card.options, letter);
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
  if (viewStudy.classList.contains("hidden")) return;
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
    session.queue.splice(session.currentIndex + 1, 0, { ...card });
  } else {
    cs.ease = Math.max(MIN_EASE, cs.ease + (EASE_DELTA[rating] ?? 0));
    let days;
    if (cs.interval === 0) days = INTERVALS[rating];
    else if (rating === "hard") days = Math.max(1, Math.round(cs.interval * 1.2));
    else if (rating === "good") days = Math.max(1, Math.round(cs.interval * cs.ease));
    else days = Math.max(1, Math.round(cs.interval * cs.ease * 1.3));
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
  $("#done-text").textContent = alreadyDone
    ? "Todas as cartas deste baralho estão em dia. Volta mais tarde ou escolhe outro baralho."
    : `Reviste ${session.completed} carta${session.completed !== 1 ? "s" : ""} nesta sessão.`;
  updateProgress();
}

// --- Exam ---

async function startExam(meta) {
  const deck = await loadDeck(meta);
  const cards = [...deck.cards].sort((a, b) => a.number - b.number);
  const answers = {};
  for (const c of cards) answers[c.number] = null;

  exam = {
    deckId: meta.id,
    deckTitle: deck.title || meta.title,
    cards,
    answers,
    index: 0,
    meta,
  };

  showView("exam");
  $("#exam-sheet").classList.remove("hidden");
  $("#exam-results").classList.add("hidden");
  $("#exam-deck-name").textContent = exam.deckTitle;
  renderExamQuestion();
}

function answeredCount() {
  if (!exam) return 0;
  return Object.values(exam.answers).filter((v) => v != null).length;
}

function renderExamQuestion() {
  if (!exam) return;
  const card = exam.cards[exam.index];
  const total = exam.cards.length;
  const n = exam.index + 1;

  $("#exam-q-number").textContent = `Pergunta ${card.number}`;
  $("#exam-question").textContent = card.question;
  $("#exam-progress-label").textContent = `Pergunta ${n} / ${total}`;
  $("#exam-answered-label").textContent = `${answeredCount()} respondida${answeredCount() !== 1 ? "s" : ""}`;
  const pct = Math.round(((n - 1) / total) * 100);
  $("#exam-progress-fill").style.width = `${pct}%`;
  $("#exam-progress-bar").setAttribute("aria-valuenow", String(pct));

  const selected = exam.answers[card.number];
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
      exam.answers[card.number] = key;
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
  exam.answers[card.number] = null;
  renderExamQuestion();
}

function scoreExam() {
  let score = 0;
  let correct = 0;
  let wrong = 0;
  let blank = 0;
  const rows = [];

  for (const card of exam.cards) {
    const chosen = exam.answers[card.number];
    let status;
    let points;
    if (chosen == null) {
      status = "blank";
      points = POINTS_BLANK;
      blank += 1;
    } else if (chosen === card.answer) {
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
    const right = `${row.card.answer}. ${row.card.options?.[row.card.answer] || row.card.answerText || ""}`;
    div.innerHTML = `
      <div class="exam-review-head">Pergunta ${row.card.number} · ${row.points} pts</div>
      <div class="exam-review-detail"><strong>Sua resposta:</strong> ${escapeHtml(your)}</div>
      <div class="exam-review-detail"><strong>Correta:</strong> ${escapeHtml(right)}</div>
    `;
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
  if (!$("#exam-results").classList.contains("hidden")) {
    renderHome();
    return;
  }
  const ok = window.confirm("Sair do exame? As respostas atuais serão perdidas.");
  if (ok) {
    exam = null;
    renderHome();
  }
}

// --- Events ---

function initEvents() {
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setHomeMode(btn.dataset.mode));
  });

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
    btn.addEventListener("click", () => rateCard(btn.dataset.rating));
  });

  $("#btn-back").addEventListener("click", () => renderHome());
  $("#btn-done-home").addEventListener("click", () => renderHome());

  $("#btn-exam-back").addEventListener("click", leaveExam);
  $("#btn-exam-prev").addEventListener("click", () => examGo(-1));
  $("#btn-exam-next").addEventListener("click", () => examGo(1));
  $("#btn-exam-clear").addEventListener("click", clearExamAnswer);
  $("#btn-exam-submit").addEventListener("click", submitExam);
  $("#btn-exam-home").addEventListener("click", () => {
    exam = null;
    renderHome();
  });
  $("#btn-exam-retry").addEventListener("click", () => {
    if (exam?.meta) startExam(exam.meta);
  });

  document.addEventListener("keydown", (e) => {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (!viewExam.classList.contains("hidden") && exam && $("#exam-results").classList.contains("hidden")) {
      const keyMap = { KeyA: "A", KeyB: "B", KeyC: "C", KeyD: "D", Digit1: "A", Digit2: "B", Digit3: "C", Digit4: "D" };
      if (keyMap[e.code]) {
        e.preventDefault();
        const card = exam.cards[exam.index];
        exam.answers[card.number] = keyMap[e.code];
        renderExamQuestion();
        return;
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        examGo(-1);
        return;
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        if (exam.index >= exam.cards.length - 1) submitExam();
        else examGo(1);
        return;
      }
    }

    if (viewStudy.classList.contains("hidden")) return;

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

async function init() {
  try {
    await loadDeckIndex();
    initEvents();
    setHomeMode("study");
  } catch (err) {
    deckGrid.innerHTML = `<p style="color:var(--again);padding:1rem;">Erro ao carregar dados: ${escapeHtml(err.message)}. Serve a pasta com um servidor local (ver README).</p>`;
  }
}

init();
