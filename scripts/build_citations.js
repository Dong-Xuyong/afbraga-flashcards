#!/usr/bin/env node
/**
 * Build data/citations.json — citations, keyword tags and backlinks.
 *
 * Official: the question, the options or the correct answer name the source
 * (a law, a section, or a circular). lawRefs and the quiz "law" tag are
 * inferred. Re-run after content changes:
 *
 *   node scripts/build_citations.js
 *
 * headingId() must stay in sync with official.js.
 */

const fs = require("fs");
const path = require("path");
const { normalize } = require("../core.js");

const ROOT = path.join(__dirname, "..");
const MAX_CITES = 3;
const MAX_TAGS = 3;
const MAX_PASSAGES = 24;

const TAGS = [
  { id: "fora-de-jogo", label: "fora de jogo", law: 11, patterns: ["fora de jogo", "offside"] },
  { id: "substituicoes", label: "substituições", law: 3, patterns: ["substitui", "suplente", "substitution", "substitute"] },
  { id: "lesao", label: "lesão", patterns: ["lesao", "lesion", "lesionado", "injury", "injured", "colid", "collide"] },
  { id: "bola-ao-solo", label: "bola ao solo", patterns: ["bola ao solo", "dropped ball"] },
  { id: "penalti", label: "penálti", law: 14, patterns: ["penalti", "penalty"] },
  { id: "pontape-livre", label: "pontapé-livre", law: 13, patterns: ["pontape livre", "pontape-livre", "livre direto", "livre indireto", "free kick"] },
  { id: "canto", label: "canto", law: 17, patterns: ["pontape de canto", "canto", "corner"] },
  { id: "pontape-baliza", label: "pontapé de baliza", law: 16, patterns: ["pontape de baliza", "goal kick"] },
  { id: "lancamento", label: "lançamento lateral", law: 15, patterns: ["lancamento lateral", "throw-in", "throw in"] },
  { id: "mao", label: "mão na bola", patterns: ["mao na bola", "toque com a mao", "com a mao", "com as maos", "handball"] },
  { id: "cartao-amarelo", label: "cartão amarelo", patterns: ["cartao amarelo", "yellow card", "advertencia"] },
  { id: "cartao-vermelho", label: "cartão vermelho", patterns: ["cartao vermelho", "red card", "expulsao", "expulso"] },
  { id: "vantagem", label: "vantagem", patterns: ["vantagem", "advantage"] },
  { id: "guarda-redes", label: "guarda-redes", patterns: ["guarda-redes", "guarda redes", "goalkeeper"] },
  { id: "equipamento", label: "equipamento", law: 4, patterns: ["equipamento", "caneleira", "equipment"] },
  { id: "duracao", label: "duração do jogo", law: 7, patterns: ["duracao do jogo", "tempo extra", "prolongamento", "added time"] },
  { id: "pontape-inicial", label: "pontapé inicial", law: 8, patterns: ["pontape inicial", "pontape de saida", "kick-off", "kick off"] },
  { id: "var", label: "VAR", patterns: ["var", "video arbitro", "video assistant"] },
  { id: "barreira", label: "barreira", patterns: ["barreira"] },
  { id: "antidesportivo", label: "comportamento antidesportivo", patterns: ["antidesportiv", "unsporting"] },
  { id: "assistente", label: "árbitro assistente", law: 6, patterns: ["arbitro assistente", "arbitros assistentes", "assistant referee"] },
  { id: "faltas", label: "faltas", law: 12, patterns: ["falta", "infracao", "foul", "tackle"] },
  { id: "terreno", label: "terreno de jogo", law: 1, patterns: ["terreno de jogo", "field of play", "playing field", "boundary line"] },
  { id: "bola", label: "bola", law: 2, patterns: ["bola oficial", "bolas suplementares", "circunferencia da bola"] },
  { id: "pontapes-marca", label: "pontapés da marca", law: 10, patterns: ["pontapes da marca", "penaltis da marca", "kicks from the penalty mark"] },
  { id: "bola-em-jogo", label: "bola em jogo", law: 9, patterns: ["bola em jogo", "bola fora de jogo", "ball in play"] },
  { id: "arbitro", label: "árbitro", law: 5, patterns: ["poderes e deveres", "decisao do arbitro"] },
  { id: "seguranca", label: "segurança", patterns: ["pirped", "policiamento", "gestor de seguranca", "pontos de contacto de seguranca"] },
  { id: "banco", label: "banco de suplentes", patterns: ["banco de suplentes", "banco suplementar", "zona tecnica"] },
  { id: "bolas-oficiais", label: "bolas oficiais", patterns: ["bolas oficiais", "bola oficial", "mka"] },
  { id: "silencio", label: "minuto de silêncio", patterns: ["minuto de silencio"] },
  { id: "oito-segundos", label: "oito segundos", patterns: ["oito segundos", "8 segundos"] },
  { id: "dez-segundos", label: "dez segundos", patterns: ["dez segundos", "10 segundos"] },
  { id: "futebol-7", label: "futebol de 7", patterns: ["futebol de 7", "futebol 7"] },
  { id: "recuo", label: "recuo", patterns: ["recuo ao guarda", "passe para tras", "back-pass", "back pass"] },
];

const TAG_BY_LAW = {};
const TAG_BY_ID = {};
for (const tag of TAGS) {
  TAG_BY_ID[tag.id] = tag;
  if (tag.law && !TAG_BY_LAW[tag.law]) TAG_BY_LAW[tag.law] = tag;
}

const CIRCULARS = [
  {
    id: "co-66",
    label: "CO 66",
    href: "#/circulares/co-66",
    numbers: [66],
    patterns: ["pirped", "policiamento", "gestor de seguranca", "pontos de contacto de seguranca"],
  },
  {
    id: "co-67",
    label: "CO 67",
    href: "#/circulares/co-67",
    numbers: [67],
    patterns: ["banco de suplentes", "banco suplementar", "zona tecnica"],
  },
  {
    id: "co-70",
    label: "CO 70",
    href: "#/circulares/co-70",
    numbers: [70],
    patterns: ["minuto de silencio"],
  },
  {
    id: "bolas-oficiais",
    label: "Bolas oficiais",
    href: "#/circulares/bolas-oficiais",
    numbers: [],
    patterns: ["bolas oficiais", "bola oficial", "mka"],
  },
  {
    id: "substituicoes-f11",
    label: "Substituições Sub-14",
    href: "#/circulares/substituicoes-f11",
    numbers: [85],
    patterns: ["sub-14", "sub 14"],
  },
  {
    id: "esclarecimento-minuto",
    label: "Esclarecimento · 1 minuto",
    href: "#/circulares/esclarecimento-minuto",
    numbers: [],
    patterns: [],
    injuryMinute: true,
  },
];

const CIRCULAR_BY_ID = {};
for (const row of CIRCULARS) CIRCULAR_BY_ID[row.id] = row;

const STOP = new Set((
  "jogador jogadores arbitro arbitros jogo jogos equipa equipas campo parte contra favor " +
  "adversario adversaria outro outra outros outras mesmo mesma pode podem deve devem quando " +
  "depois antes sobre entre desde ainda tambem sendo foram estao estava havia tinha porque " +
  "qual quais onde como para pela pelo pelas pelos numa num uma uns com sem que dos das nao " +
  "sim seu sua seus suas este esta esse essa isto isso cada todo toda todos todas mais menos " +
  "muito muita durante atraves apenas caso sempre nunca apenas qualquer quaisquer este esta"
).split(/\s+/));

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function headingId(text) {
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

function slugify(text) {
  return normalize(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
}

function topSectionNumber(heading) {
  const parts = String(heading || "").split("›").map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    const num = /^(\d+(?:\.\d+)*)/.exec(part);
    if (num) return num[1];
  }
  return "";
}

function lawSlug(law) {
  return "lei-" + String(law).padStart(2, "0");
}

function hasPattern(hay, pattern) {
  const folded = normalize(pattern);
  if (!folded) return false;
  const escaped = folded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (folded.length <= 5 || /^[a-z0-9]+$/.test(folded)) {
    return new RegExp("(^|[^a-z0-9])" + escaped + "([^a-z0-9]|$)").test(hay);
  }
  return hay.indexOf(folded) !== -1;
}

function anyPattern(hay, patterns) {
  for (const pattern of patterns || []) {
    if (hasPattern(hay, pattern)) return pattern;
  }
  return "";
}

function longestPattern(hay, tag) {
  let best = "";
  for (const pattern of tag.patterns) {
    if (!hasPattern(hay, pattern)) continue;
    if (normalize(pattern).length > best.length) best = normalize(pattern);
  }
  return best;
}

function optionMap(options) {
  const out = {};
  for (const raw of options || []) {
    const match = /^([A-D])\)\s*([\s\S]*)$/.exec(raw);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

function buildQuizCards(raw) {
  const cards = [];
  for (const item of raw || []) {
    const testId = slugify(item.test) || "teste";
    const options = optionMap(item.options);
    const letters = String(item.answer_letter || "").split("/").map((part) => part.trim()).filter(Boolean);
    const answerText = letters.map((letter) => options[letter]).filter(Boolean).join(" ou ");
    const number = Number(item.n);
    cards.push({
      id: "te-" + testId + "-" + String(number).padStart(2, "0"),
      number: number,
      question: item.q,
      options: options,
      answer: letters.join("/"),
      answerText: answerText,
      law: item.law == null ? null : item.law,
      deck: "testes",
      written: true,
    });
  }
  return cards;
}

function includesEveryOption(card) {
  return /todas as opcoes|all of the options|all options/.test(normalize(card.answerText || ""));
}

function cardBlob(card, includeExplanation) {
  const parts = [card.question || "", card.answerText || ""];
  if (includesEveryOption(card)) {
    const options = card.options || {};
    for (const key of Object.keys(options)) parts.push(options[key]);
  }
  if (includeExplanation) parts.push(card.explanation || "");
  return normalize(parts.join(" \n "));
}

function officialSurface(card) {
  return cardBlob(card, false);
}

const EN_EXPAND = [
  [/kick-?off/, " pontape de saida pontape inicial "],
  [/throw-?in|thrower/, " lancamento lateral "],
  [/offside/, " fora de jogo "],
  [/penalty/, " penalti marca de penalti "],
  [/goalkeeper/, " guarda redes "],
  [/corner/, " pontape de canto "],
  [/free kick/, " pontape livre "],
  [/yellow card/, " cartao amarelo "],
  [/red card/, " cartao vermelho "],
  [/handball/, " mao na bola "],
  [/advantage/, " vantagem "],
  [/injur|medical/, " lesao lesionado "],
  [/goal line/, " linha de baliza "],
  [/boundary line|playing field/, " linha delimitadora terreno de jogo "],
  [/incapacitated/, " arbitro assistente "],
  [/same team/, " mesma equipa "],
  [/collid/, " colidiram lesao "],
  [/deform|burst/, " bola rebentou "],
];

function expandText(text) {
  let out = text;
  for (const pair of EN_EXPAND) {
    if (pair[0].test(text)) out += pair[1];
  }
  return out;
}

const ANCHORS = [
  { id: "l1-10-4", test: (hay) => /7[,.]32|2[,.]44/.test(hay) && /baliza|goal/.test(hay) },
  { id: "l1-6-2", test: (hay) => /11\s*metros/.test(hay) && /penalti|baliza/.test(hay) },
  { id: "l12-1-7", test: (hay) => /(^|[^a-z])tackle([^a-z]|$)/.test(hay) },
  { id: "l12-4-41", test: (hay) => /celebr/.test(hay) },
  { id: "l5-3-17", test: (hay) => /mesma equipa/.test(hay) && /lesion|lesao|lesoes|colid|medical/.test(hay) },
  { id: "l4-1-1", test: (hay) => (/equipamento/.test(hay) && /perigoso/.test(hay)) || (/equipment/.test(hay) && /dangerous/.test(hay)) },
  { id: "l6-0-7", test: (hay) => /incapacitated/.test(hay) || /impossibilitad/.test(hay) },
  { id: "l2-2-4", test: (hay) => /deform|rebent|burst/.test(hay) && /kick-?off|pontape de saida|pontape inicial/.test(hay) },
  { id: "l10-1-3", test: (hay) => /bola ao solo|dropped ball/.test(hay) && /linha de baliza|goal line/.test(hay) },
];

function matchAnchor(hay, byId) {
  for (const anchor of ANCHORS) {
    if (anchor.test(hay) && byId[anchor.id]) return byId[anchor.id];
  }
  return null;
}

function overlaps(ranges, start, end) {
  for (const range of ranges) {
    if (start < range[1] && end > range[0]) return true;
  }
  return false;
}

function findLawMentions(text) {
  const found = [];
  const used = [];
  function add(law, section, start, end) {
    if (law < 1 || law > 17) return;
    if (found.some((row) => row.law === law && row.section === section)) return;
    found.push({ law: law, section: section });
    used.push([start, end]);
  }
  const dotted = /leis?\s+(\d{1,2})((?:\s*\.\s*\d+)+)/g;
  let match;
  while ((match = dotted.exec(text))) {
    const section = match[2].replace(/\s/g, "").replace(/^\./, "");
    add(Number(match[1]), section, match.index, match.index + match[0].length);
  }
  const article = /leis?\s+(\d{1,2})\s*,?\s*n[.º°o]*\s*(\d+(?:\.\d+)*)/g;
  while ((match = article.exec(text))) {
    if (overlaps(used, match.index, match.index + match[0].length)) continue;
    add(Number(match[1]), match[2], match.index, match.index + match[0].length);
  }
  const bare = /leis?\s+(\d{1,2})\b/g;
  while ((match = bare.exec(text))) {
    if (overlaps(used, match.index, match.index + match[0].length)) continue;
    const start = match.index;
    let end = match.index + match[0].length;
    add(Number(match[1]), null, start, end);
    const rest = text.slice(end);
    const list = /^((?:\s*,\s*|\s+e\s+)\d{1,2}\b)+/.exec(rest);
    if (!list) continue;
    const nums = list[0].match(/\d{1,2}/g) || [];
    for (const num of nums) add(Number(num), null, end, end + list[0].length);
    end += list[0].length;
    used[used.length - 1] = [start, end];
  }
  return found;
}

function whichLawAnswer(card) {
  const question = normalize(card.question || "");
  if (question.indexOf("em que lei") === -1) return null;
  const answers = String(card.answerText || "").split(/\s+ou\s+/);
  for (const answer of answers) {
    const folded = normalize(answer).trim();
    const bare = /^(\d{1,2})$/.exec(folded) || /^lei\s+(\d{1,2})$/.exec(folded);
    if (!bare) continue;
    const law = Number(bare[1]);
    if (law >= 1 && law <= 17) return law;
  }
  return null;
}

function findNamedCirculars(text) {
  const ids = [];
  const re = /(?:comunicado oficial|circular|co)\s*(?:n[.º°o]*)?\s*(\d+)/g;
  let match;
  while ((match = re.exec(text))) {
    const num = Number(match[1]);
    for (const row of CIRCULARS) {
      if (row.numbers.indexOf(num) === -1) continue;
      if (ids.indexOf(row.id) === -1) ids.push(row.id);
    }
  }
  return ids;
}

function tokensOf(text) {
  const out = [];
  const seen = new Set();
  for (const token of normalize(text).split(/[^a-z0-9]+/)) {
    if (token.length < 5 || STOP.has(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function sectionTokens(section) {
  return {
    heading: new Set(tokensOf((section.pageTitle || "") + " " + (section.heading || ""))),
    body: new Set(tokensOf(section.text || "")),
  };
}

function buildIdf(sections) {
  const df = {};
  let n = 0;
  const cache = new Map();
  for (const section of sections) {
    if (section.doc !== "leis-2526") continue;
    n += 1;
    const bag = sectionTokens(section);
    cache.set(section.id, bag);
    const uniq = new Set([...bag.heading, ...bag.body]);
    for (const token of uniq) df[token] = (df[token] || 0) + 1;
  }
  function idf(token) {
    const d = df[token] || 0;
    if (!d) return 0;
    return Math.log((n + 1) / (d + 1));
  }
  return { idf: idf, cache: cache, n: n };
}

function scoreSection(section, cardTokens, idf, cache) {
  const bag = cache.get(section.id) || sectionTokens(section);
  let score = 0;
  let hits = 0;
  for (const token of cardTokens) {
    const inHeading = bag.heading.has(token);
    const inBody = bag.body.has(token);
    if (!inHeading && !inBody) continue;
    hits += 1;
    score += idf(token) * (inHeading ? 1.7 : 1);
  }
  return { score: score, hits: hits };
}

function findSection(sections, law, dotted) {
  const pool = sections.filter((section) => section.doc === "leis-2526" && section.law === law);
  const exact = [];
  const prefix = [];
  for (const section of pool) {
    const num = topSectionNumber(section.heading);
    if (!num) continue;
    if (num === dotted) exact.push(section);
    else if (num.indexOf(dotted + ".") === 0 || dotted.indexOf(num + ".") === 0) prefix.push(section);
  }
  const chosen = (exact.length ? exact : prefix).sort((a, b) => (a.order || 0) - (b.order || 0));
  return chosen[0] || null;
}

function labelFor(section) {
  if (!section) return "Lei";
  if (section.doc === "leis-2526" && section.law >= 1 && section.law <= 17) {
    const num = topSectionNumber(section.heading);
    return num ? "Lei " + section.law + "." + num : "Lei " + section.law;
  }
  if (section.doc === "normas-2018") {
    const title = section.pageTitle || "Normas";
    const num = topSectionNumber(section.heading);
    return num ? title + " · " + num : title;
  }
  const title = String(section.pageTitle || "Diretrizes").replace(/\s+/g, " ");
  const short = title.length > 42 ? title.slice(0, 40).trim() + "…" : title;
  const num = topSectionNumber(section.heading);
  return num ? short + " · " + num : short;
}

function lawCite(section, basis) {
  return {
    basis: basis,
    kind: "law",
    label: labelFor(section),
    href: "#/leis/" + section.id,
    target: section.id,
    weak: false,
  };
}

function lawPageCite(law, basis, weak) {
  const slug = lawSlug(law);
  return {
    basis: basis,
    kind: "law",
    label: "Lei " + law,
    href: "#/leis/page/" + slug,
    target: slug,
    weak: !!weak,
  };
}

function pushCite(list, cite) {
  if (!cite || !cite.target) return;
  if (list.some((row) => row.target === cite.target)) return;
  if (list.length >= MAX_CITES) return;
  list.push(cite);
}

function bestSection(sections, cardTokens, idf, restrictLaw) {
  let best = null;
  let bestScore = 0;
  let bestHits = 0;
  for (const section of sections) {
    if (section.doc !== "leis-2526") continue;
    if (restrictLaw && section.law !== restrictLaw) continue;
    const scored = scoreSection(section, cardTokens, idf.idf, idf.cache);
    if (scored.score > bestScore) {
      best = section;
      bestScore = scored.score;
      bestHits = scored.hits;
    }
  }
  return { section: best, score: bestScore, hits: bestHits };
}

const PHRASES = [
  "fora de jogo", "lancamento lateral", "bola ao solo", "pontape de saida",
  "pontape inicial", "marca de penalti", "cartao amarelo", "cartao vermelho",
  "guarda-redes", "guarda redes", "linha de baliza", "pontape de canto",
  "pontape de baliza", "pontape livre", "video arbitro",
];

function phraseSection(sections, hay, restrictLaw) {
  let best = null;
  let bestScore = 0;
  for (const section of sections) {
    if (section.doc !== "leis-2526") continue;
    if (restrictLaw && section.law !== restrictLaw) continue;
    const heading = normalize((section.heading || "") + " " + (section.pageTitle || ""));
    const body = normalize(section.text || "");
    let score = 0;
    for (const phrase of PHRASES) {
      if (hay.indexOf(phrase) === -1) continue;
      if (heading.indexOf(phrase) !== -1) score += 20 + phrase.length;
      else if (body.indexOf(phrase) !== -1) score += phrase.length;
    }
    if (score > bestScore || (score === bestScore && best && (section.order || 0) < (best.order || 0))) {
      bestScore = score;
      best = section;
    }
  }
  return bestScore >= 12 ? best : null;
}

function isStrong(scored) {
  return scored.hits >= 3 && scored.score >= 6;
}

function isAcceptable(scored) {
  return scored.hits >= 2 && scored.score >= 3.2;
}

function injuryMinute(hay) {
  const minute = hay.indexOf("um minuto") !== -1 || hay.indexOf("1 minuto") !== -1 || hay.indexOf("one minute") !== -1;
  const injury = hay.indexOf("lesao") !== -1 || hay.indexOf("lesionado") !== -1 || hay.indexOf("injury") !== -1;
  return minute && injury;
}

function extraKey(entry) {
  const title = normalize(entry && entry.title);
  if (title.indexOf("var") !== -1) return "var";
  if (title.indexOf("glossario") !== -1) return "glossario";
  if (title.indexOf("orientac") !== -1) return "orientacoes";
  return "extra";
}

function altAnchor(entry) {
  if (entry && entry.law != null) return String(entry.law);
  return extraKey(entry);
}

function matchChange(entry, hay, sectionNum) {
  const changes = entry.changes || [];
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < changes.length; i += 1) {
    const blob = normalize((changes[i].summary || "") + " " + (changes[i].detail || ""));
    let score = 0;
    if (entry.law != null && sectionNum) {
      const re = new RegExp("lei\\s+" + entry.law + "\\s*\\.\\s*" + sectionNum + "\\b");
      if (re.test(blob)) score += 6;
    }
    const cardTokens = tokensOf(hay).slice(0, 12);
    let hits = 0;
    for (const token of cardTokens) {
      if (blob.indexOf(token) !== -1) hits += 1;
    }
    score += hits * 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 6 ? best : -1;
}

function citeCard(card, ctx) {
  const surface = officialSurface(card);
  const full = cardBlob(card, true);
  const citations = [];
  const mentions = findLawMentions(surface);
  const which = whichLawAnswer(card);
  if (which && !mentions.some((row) => row.law === which)) {
    mentions.unshift({ law: which, section: null });
  }

  for (const mention of mentions) {
    if (!mention.section) continue;
    const section = findSection(ctx.sections, mention.law, mention.section);
    if (section) pushCite(citations, lawCite(section, "official"));
    else pushCite(citations, lawPageCite(mention.law, "official", false));
  }
  for (const mention of mentions) {
    if (mention.section) continue;
    pushCite(citations, lawPageCite(mention.law, "official", false));
  }
  for (const id of findNamedCirculars(surface)) {
    const row = CIRCULAR_BY_ID[id];
    pushCite(citations, {
      basis: "official",
      kind: "circular",
      label: row.label,
      href: row.href,
      target: row.id,
      weak: false,
    });
  }

  const coveredLaws = new Set(mentions.map((row) => row.law));
  for (const id of card.lawRefs || []) {
    const section = ctx.byId[id];
    if (!section) continue;
    pushCite(citations, lawCite(section, "inferred"));
    if (section.law >= 1 && section.law <= 17) coveredLaws.add(section.law);
  }

  let guessReason = "";
  const knownLaw = card.law >= 1 && card.law <= 17 ? Number(card.law) : null;
  if (!(card.lawRefs && card.lawRefs.length)) {
    const expanded = expandText(full);
    const anchor = matchAnchor(expanded, ctx.byId);
    const cardTokens = tokensOf(expanded);
    const restrict = knownLaw || (mentions[0] && mentions[0].law) || null;
    const scored = bestSection(ctx.sections, cardTokens, ctx.idf, restrict);
    const open = restrict ? scored : bestSection(ctx.sections, cardTokens, ctx.idf, null);
    const hasOfficial = citations.some((cite) => cite.basis === "official");
    const picked = isStrong(scored) || (!hasOfficial && restrict && isAcceptable(scored)) ? scored : (isStrong(open) ? open : null);
    if (anchor) {
      pushCite(citations, lawCite(anchor, "inferred"));
      if (anchor.law >= 1 && anchor.law <= 17) coveredLaws.add(anchor.law);
    } else if (!hasOfficial && picked && picked.section) {
      pushCite(citations, lawCite(picked.section, "inferred"));
      if (picked.section.law >= 1 && picked.section.law <= 17) coveredLaws.add(picked.section.law);
    } else if (!hasOfficial) {
      const phrased = phraseSection(ctx.sections, expanded, restrict);
      if (phrased) {
        pushCite(citations, lawCite(phrased, "inferred"));
        if (phrased.law >= 1 && phrased.law <= 17) coveredLaws.add(phrased.law);
      } else {
        const law = restrict || (open.section && open.section.law) || null;
        if (law >= 1 && law <= 17 && !coveredLaws.has(law)) {
          const weak = !mentions.some((row) => row.law === law);
          pushCite(citations, lawPageCite(law, weak ? "inferred" : "official", weak));
          coveredLaws.add(law);
          if (weak) {
            guessReason = knownLaw
              ? "A etiqueta da pergunta indica a Lei " + law + ", mas o texto não nomeia um parágrafo."
              : "Sem referência explícita nem sobreposição forte com um parágrafo; ficou a lei mais próxima.";
          }
        }
      }
    }
  }

  for (const row of CIRCULARS) {
    if (citations.some((cite) => cite.target === row.id)) continue;
    const named = row.injuryMinute ? injuryMinute(full) : anyPattern(full, row.patterns);
    if (!named) continue;
    pushCite(citations, {
      basis: "inferred",
      kind: "circular",
      label: row.label,
      href: row.href,
      target: row.id,
      weak: false,
    });
  }

  const aboutChanges = card.deck === "alteracoes-2627" || /alterac|2026\/27|epoca 2026/.test(full);
  if (aboutChanges) {
    const laws = [];
    for (const law of coveredLaws) laws.push(law);
    if (!laws.length && knownLaw) laws.push(knownLaw);
    for (const law of laws) {
      const entry = ctx.altByLaw[law];
      if (!entry || !(entry.changes || []).length) continue;
      let sectionNum = "";
      for (const id of card.lawRefs || []) {
        const section = ctx.byId[id];
        if (section && section.law === law) {
          sectionNum = topSectionNumber(section.heading);
          break;
        }
      }
      const index = matchChange(entry, full, sectionNum);
      const item = index >= 0 ? String(index + 1) : "";
      pushCite(citations, {
        basis: "inferred",
        kind: "alteracao",
        label: "Alterações 2026/27 · Lei " + law,
        href: "#/alteracoes/" + law + (item ? "/" + item : ""),
        target: "alt-" + law + (item ? "-" + item : ""),
        parent: "alt-" + law,
        weak: false,
      });
    }
    if (/\bvar\b|video arbitro/.test(full) && ctx.altByKey.var && (ctx.altByKey.var.changes || []).length) {
      pushCite(citations, {
        basis: "inferred",
        kind: "alteracao",
        label: "Alterações 2026/27 · VAR",
        href: "#/alteracoes/var",
        target: "alt-var",
        weak: false,
      });
    }
  }

  if (!citations.length) {
    pushCite(citations, lawPageCite(knownLaw || 5, "inferred", true));
    guessReason = "Sem termos suficientes para um parágrafo; ligação fraca à lei.";
  }

  return { citations: citations, guessReason: guessReason, surfaceLaws: mentions.map((row) => row.law) };
}

function tagCard(card, ctx, citeInfo) {
  const hay = expandText(cardBlob(card, false));
  const ranked = [];
  for (const tag of TAGS) {
    const hit = longestPattern(hay, tag);
    if (!hit) continue;
    ranked.push({ id: tag.id, len: hit.length });
  }
  ranked.sort((a, b) => b.len - a.len);
  const tags = [];
  for (const row of ranked) {
    if (tags.length >= MAX_TAGS) break;
    if (tags.indexOf(row.id) === -1) tags.push(row.id);
  }
  for (const law of citeInfo.surfaceLaws || []) {
    if (tags.length >= MAX_TAGS) break;
    const named = TAG_BY_LAW[law];
    if (named && tags.indexOf(named.id) === -1) tags.push(named.id);
  }
  if (!tags.length) {
    let law = citeInfo.surfaceLaws[0] || null;
    if (!law) {
      for (const id of card.lawRefs || []) {
        const section = ctx.byId[id];
        if (section && section.law >= 1 && section.law <= 17) {
          law = section.law;
          break;
        }
      }
    }
    if (!law && card.law >= 1 && card.law <= 17) law = Number(card.law);
    if (!law) {
      for (const cite of citeInfo.citations) {
        const section = ctx.byId[cite.target];
        if (section && section.law >= 1 && section.law <= 17) {
          law = section.law;
          break;
        }
        const page = /^lei-(\d+)$/.exec(cite.target);
        if (page) {
          law = Number(page[1]);
          break;
        }
      }
    }
    const fallback = law && TAG_BY_LAW[law];
    if (fallback) tags.push(fallback.id);
    else tags.push("arbitro");
  }
  return tags;
}

function parseMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = null;
  function flush() {
    if (current) sections.push(current);
  }
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      current = {
        id: headingId(heading[2]),
        label: heading[2].replace(/\*\*/g, "").trim(),
        level: heading[1].length,
        text: "",
      };
      continue;
    }
    if (current) current.text += " " + line;
  }
  flush();
  return sections;
}

function tagPassages(ctx, mdSections) {
  const tagIndex = {};
  for (const tag of TAGS) {
    const hits = [];
    for (const section of ctx.sections) {
      if (section.doc !== "leis-2526" && section.doc !== "normas-2018") continue;
      const hay = normalize((section.heading || "") + " " + (section.text || "") + " " + (section.pageTitle || ""));
      const hit = longestPattern(hay, tag);
      if (!hit) continue;
      const inHeading = hasPattern(normalize((section.heading || "") + " " + (section.pageTitle || "")), hit);
      hits.push({
        id: section.id,
        label: labelFor(section),
        href: "#/leis/" + section.id,
        score: (inHeading ? 10 : 0) + hit.length,
        order: section.order || 0,
      });
    }
    hits.sort((a, b) => b.score - a.score || a.order - b.order);
    const passages = [];
    if (tag.law) {
      const slug = lawSlug(tag.law);
      passages.push({ id: slug, label: "Lei " + tag.law, href: "#/leis/page/" + slug });
    }
    const seen = new Set(passages.map((row) => row.id));
    for (const hit of hits) {
      if (passages.length >= MAX_PASSAGES) break;
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      passages.push({ id: hit.id, label: hit.label, href: hit.href });
    }
    const circulars = [];
    const seenCirc = new Set();
    for (const section of mdSections) {
      if (section.level < 2) continue;
      if (!CIRCULAR_BY_ID[section.id]) continue;
      if (seenCirc.has(section.id)) continue;
      const hay = normalize(section.label + " " + section.text);
      if (!longestPattern(hay, tag)) continue;
      seenCirc.add(section.id);
      const known = CIRCULAR_BY_ID[section.id];
      circulars.push({
        id: section.id,
        label: known.label,
        href: "#/circulares/" + section.id,
      });
    }
    tagIndex[tag.id] = { passages: passages, circulars: circulars };
  }
  return tagIndex;
}

function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function main() {
  const index = readJson("data/index.json");
  const laws = readJson("data/laws.json");
  const sections = laws.sections || [];
  const byId = {};
  for (const section of sections) byId[section.id] = section;
  const idf = buildIdf(sections);
  const alterations = readJson("data/alteracoes-leis-2627.json");
  const altByLaw = {};
  const altByKey = {};
  for (const entry of alterations) {
    if (entry.law != null) altByLaw[entry.law] = entry;
    else altByKey[extraKey(entry)] = entry;
  }
  const ctx = { sections: sections, byId: byId, idf: idf, altByLaw: altByLaw, altByKey: altByKey };

  const cards = [];
  for (const meta of index.decks) {
    const deck = readJson("data/" + meta.file);
    for (const card of deck.cards || []) {
      cards.push(Object.assign({}, card, { deck: meta.id }));
    }
  }
  const quiz = buildQuizCards(readJson("data/quiz-escritos.json"));
  for (const card of quiz) cards.push(card);

  const cardMap = {};
  const backlinks = {};
  const weakOnly = [];
  function addBacklink(target, cardId) {
    if (!target) return;
    if (!backlinks[target]) backlinks[target] = [];
    if (backlinks[target].indexOf(cardId) === -1) backlinks[target].push(cardId);
  }

  for (const card of cards) {
    const info = citeCard(card, ctx);
    const tags = tagCard(card, ctx, info);
    cardMap[card.id] = {
      deck: card.deck,
      tags: tags,
      citations: info.citations.map((cite) => ({
        basis: cite.basis,
        kind: cite.kind,
        label: cite.label,
        href: cite.href,
        target: cite.target,
        weak: !!cite.weak,
      })),
    };
    let official = false;
    let anySpecific = false;
    for (const cite of info.citations) {
      if (cite.basis === "official") official = true;
      if (!cite.weak && cite.kind === "law" && ctx.byId[cite.target]) anySpecific = true;
      if (!cite.weak && cite.kind !== "law") anySpecific = true;
      addBacklink(cite.target, card.id);
      if (cite.parent) addBacklink(cite.parent, card.id);
    }
    if (!official && !anySpecific) {
      weakOnly.push({ id: card.id, deck: card.deck, reason: info.guessReason || "Só a lei, sem parágrafo." });
    }
  }

  const md = parseMarkdown(
    fs.readFileSync(path.join(ROOT, "data/circulares.md"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(ROOT, "data/esclarecimentos.md"), "utf8")
  );
  const tagIndex = tagPassages(ctx, md);

  const byDeck = {};
  let officialCards = 0;
  let inferredOnly = 0;
  let tagged = 0;
  for (const card of cards) {
    const row = cardMap[card.id];
    if (!byDeck[card.deck]) byDeck[card.deck] = { cards: 0, official: 0, inferredOnly: 0, tagged: 0 };
    const bucket = byDeck[card.deck];
    bucket.cards += 1;
    const hasOfficial = row.citations.some((cite) => cite.basis === "official");
    if (hasOfficial) {
      officialCards += 1;
      bucket.official += 1;
    } else if (row.citations.length) {
      inferredOnly += 1;
      bucket.inferredOnly += 1;
    }
    if (row.tags.length) {
      tagged += 1;
      bucket.tagged += 1;
    }
  }

  let passageBacklinks = 0;
  let lawPageBacklinks = 0;
  let circularBacklinks = 0;
  let alteracaoBacklinks = 0;
  for (const target of Object.keys(backlinks)) {
    if (!backlinks[target].length) continue;
    if (byId[target]) passageBacklinks += 1;
    else if (/^lei-\d+$/.test(target)) lawPageBacklinks += 1;
    else if (CIRCULAR_BY_ID[target] || target.indexOf("co-") === 0) circularBacklinks += 1;
    else if (target.indexOf("alt-") === 0) alteracaoBacklinks += 1;
  }

  const usedTags = new Set();
  for (const id of Object.keys(cardMap)) {
    for (const tag of cardMap[id].tags) usedTags.add(tag);
  }

  const report = {
    cards: cards.length,
    withCitation: cards.filter((card) => cardMap[card.id].citations.length).length,
    withOfficial: officialCards,
    inferredOnly: inferredOnly,
    withTag: tagged,
    distinctTags: usedTags.size,
    vocabulary: TAGS.length,
    passageBacklinks: passageBacklinks,
    lawPageBacklinks: lawPageBacklinks,
    circularBacklinks: circularBacklinks,
    alteracaoBacklinks: alteracaoBacklinks,
    weakOnly: weakOnly.length,
    byDeck: {},
    unlinkable: [
      {
        id: "co-68",
        why: "A CO 68 só lista nomeações de delegados de uma jornada. Não tem regra de estudo para ligar a uma carta.",
      },
      {
        id: "co-66",
        why: "Nenhuma carta trata de PIRPED, policiamento, PCS ou gestor de segurança.",
      },
      {
        id: "co-70",
        why: "Nenhuma carta trata do minuto de silêncio ou das autorizações da CO 70.",
      },
      {
        id: "bolas-oficiais",
        why: "Nenhuma carta nomeia a marca MKA ou as bolas oficiais da época.",
      },
      {
        id: "substituicoes-f11",
        why: "Nenhuma carta trata do número de substituições de Sub-14 a Sub-19 (CO 85).",
      },
    ],
  };
  for (const deck of Object.keys(byDeck)) {
    const bucket = byDeck[deck];
    report.byDeck[deck] = {
      cards: bucket.cards,
      officialPct: percent(bucket.official, bucket.cards),
      inferredOnlyPct: percent(bucket.inferredOnly, bucket.cards),
      tagPct: percent(bucket.tagged, bucket.cards),
    };
  }
  report.unlinkable = report.unlinkable.filter((row) => !(backlinks[row.id] || []).length);
  report.officialPct = percent(officialCards, cards.length);
  report.inferredOnlyPct = percent(inferredOnly, cards.length);
  report.tagPct = percent(tagged, cards.length);

  const missingCite = cards.filter((card) => !cardMap[card.id].citations.length).map((card) => card.id);
  const missingTag = cards.filter((card) => !cardMap[card.id].tags.length).map((card) => card.id);

  const payload = {
    version: 1,
    legend: {
      official: "O texto da pergunta ou da resposta nomeia esta fonte.",
      inferred: "Ligação por tema ou pela etiqueta da pergunta. Não está escrita como fonte oficial.",
    },
    tags: TAGS.map((tag) => ({ id: tag.id, label: tag.label })),
    cards: cardMap,
    tagIndex: tagIndex,
    backlinks: backlinks,
  };

  fs.writeFileSync(path.join(ROOT, "data/citations.json"), JSON.stringify(payload));
  fs.writeFileSync(path.join(ROOT, "data/citations-report.json"), JSON.stringify({
    report: report,
    weakOnly: weakOnly,
    missingCite: missingCite,
    missingTag: missingTag,
    headingIds: md.map((section) => ({ id: section.id, label: section.label })),
  }, null, 2));

  console.log(JSON.stringify(report, null, 2));
  console.log("weak-only", weakOnly.length);
  console.log("missing citations", missingCite.length, "missing tags", missingTag.length);
  if (missingCite.length || missingTag.length) process.exit(1);
}

main();
