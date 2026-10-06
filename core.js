/**
 * Pure study helpers for AF Braga (no DOM).
 * Browser: classic script, functions are global.
 * Node: module.exports for scripts/test_afbraga_core.js.
 */

function normalize(value) {
  const text = value == null ? "" : String(value);
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function searchTerms(query) {
  return normalize(query)
    .split(/\s+/)
    .filter(Boolean);
}

function countTerm(hay, term) {
  if (!term || !hay) return 0;
  let count = 0;
  let from = 0;
  while (from <= hay.length) {
    const at = hay.indexOf(term, from);
    if (at < 0) break;
    count += 1;
    from = at + term.length;
  }
  return count;
}

function searchSections(sections, query, filters) {
  const terms = searchTerms(query);
  const opts = filters || {};
  let pool = sections || [];
  if (opts.doc && opts.doc !== "all") {
    pool = pool.filter((section) => section.doc === opts.doc);
  }
  if (opts.law != null && opts.law !== "" && String(opts.law) !== "all") {
    const law = String(opts.law);
    pool = pool.filter((section) => String(section.law) === law);
  }
  if (opts.changedOnly) {
    pool = pool.filter((section) => section.changed || section.isNew);
  }
  if (!terms.length) return [];

  const scored = [];
  for (const section of pool) {
    const heading = normalize(
      (section.pageTitle || "") + " " + (section.heading || "")
    );
    const body = normalize(section.text || "");
    const change = normalize(section.changeText || "");
    const hay = heading + " " + body + " " + change;
    if (!terms.every((term) => hay.indexOf(term) !== -1)) continue;
    let titleHits = 0;
    let freq = 0;
    for (const term of terms) {
      if (heading.indexOf(term) !== -1) titleHits += 1;
      freq += countTerm(hay, term);
    }
    scored.push({ section: section, titleHits: titleHits, freq: freq });
  }
  scored.sort((a, b) => {
    if (b.titleHits !== a.titleHits) return b.titleHits - a.titleHits;
    if (b.freq !== a.freq) return b.freq - a.freq;
    return (a.section.order || 0) - (b.section.order || 0);
  });
  return scored.slice(0, 50).map((row) => row.section);
}

function snippetSource(section, query) {
  const terms = searchTerms(query);
  const body = normalize((section && section.text) || "");
  const change = normalize((section && section.changeText) || "");
  if (!terms.length) return "text";
  const inBody = terms.every((term) => body.indexOf(term) !== -1);
  if (inBody) return "text";
  if (terms.some((term) => change.indexOf(term) !== -1)) return "change";
  return "text";
}

function sectionAt(index, id) {
  if (!index || id == null) return null;
  if (Object.prototype.hasOwnProperty.call(index, id)) return index[id];
  if (typeof index.get === "function") return index.get(id) || null;
  return null;
}

function lawKeysOfCard(card, sectionIndex) {
  const keys = [];
  const refs = (card && card.lawRefs) || [];
  for (let i = 0; i < refs.length; i += 1) {
    const section = sectionAt(sectionIndex, refs[i]);
    if (!section) continue;
    let key = null;
    if (section.law != null && section.law !== "") key = String(section.law);
    else if (section.doc === "normas-2018") key = "normas";
    if (key && keys.indexOf(key) === -1) keys.push(key);
  }
  if (!keys.length && card && card.lawKey) keys.push(String(card.lawKey));
  return keys;
}

function lawOfCard(card, sectionIndex) {
  const keys = lawKeysOfCard(card, sectionIndex);
  return keys.length ? keys[0] : null;
}

function lawWeight(lawKey, stats) {
  if (!lawKey) return 0.5;
  const row = stats && stats.byLaw ? stats.byLaw[lawKey] : null;
  if (!row) return 0.5;
  const right = row.right || 0;
  const wrong = row.wrong || 0;
  const total = right + wrong;
  if (total <= 0) return 0.5;
  return 1 - right / total;
}

function cardWeight(card, stats, sectionIndex) {
  const keys = lawKeysOfCard(card, sectionIndex);
  if (!keys.length) return 0.5;
  let best = 0;
  for (let i = 0; i < keys.length; i += 1) {
    const weight = lawWeight(keys[i], stats);
    if (weight > best) best = weight;
  }
  return best;
}

function weightedIndex(weights, rng) {
  let total = 0;
  for (let i = 0; i < weights.length; i += 1) total += weights[i];
  if (!(total > 0)) {
    return Math.min(weights.length - 1, Math.floor(rng() * weights.length));
  }
  let cursor = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    cursor -= weights[i];
    if (cursor < 0) return i;
  }
  return weights.length - 1;
}

function pickDaily(cards, srsStates, stats, todayKey, n, rng, sectionIndex) {
  const limit = n == null ? 10 : n;
  const random = typeof rng === "function" ? rng : Math.random;
  const srs = srsStates || {};
  const seen = new Set();
  const unique = [];
  const list = cards || [];
  for (let i = 0; i < list.length; i += 1) {
    const card = list[i];
    if (!card || !card.id || seen.has(card.id)) continue;
    seen.add(card.id);
    unique.push(card);
  }
  if (limit <= 0 || !unique.length) return [];

  const due = [];
  const rest = [];
  for (let i = 0; i < unique.length; i += 1) {
    const card = unique[i];
    const state = srs[card.id];
    if (state && state.seen && state.dueDate && state.dueDate <= todayKey) due.push(card);
    else rest.push(card);
  }
  due.sort((a, b) => {
    const da = srs[a.id].dueDate;
    const db = srs[b.id].dueDate;
    if (da < db) return -1;
    if (da > db) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  const chosen = due.slice(0, limit);
  const pool = rest.slice();
  while (chosen.length < limit && pool.length) {
    const weights = pool.map((card) => cardWeight(card, stats, sectionIndex));
    const index = weightedIndex(weights, random);
    chosen.push(pool.splice(index, 1)[0]);
  }
  return chosen.map((card) => card.id);
}

function charEnd(src, index) {
  let end = index + 1;
  while (end < src.length && /[\u0300-\u036f]/.test(src.charAt(end))) end += 1;
  return end;
}

function foldWithMap(text) {
  const src = String(text || "");
  let norm = "";
  const map = [];
  for (let i = 0; i < src.length; i += 1) {
    const piece = normalize(src.charAt(i));
    for (let k = 0; k < piece.length; k += 1) {
      map.push(i);
      norm += piece.charAt(k);
    }
  }
  return { src: src, norm: norm, map: map };
}

function mergeRanges(ranges) {
  if (!ranges.length) return [];
  const sorted = ranges.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [{ start: sorted[0].start, end: sorted[0].end }];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= prev.end) prev.end = Math.max(prev.end, cur.end);
    else out.push({ start: cur.start, end: cur.end });
  }
  return out;
}

function snippet(text, query, radius) {
  const src = String(text || "");
  const windowRadius = radius == null ? 80 : radius;
  const folded = foldWithMap(src);
  const terms = searchTerms(query);
  if (!src) return { text: "", ranges: [] };

  function clip(raw) {
    if (raw.length <= windowRadius * 2) return raw;
    return raw.slice(0, windowRadius * 2) + "…";
  }

  if (!terms.length) return { text: clip(src), ranges: [] };

  const hits = [];
  for (let t = 0; t < terms.length; t += 1) {
    const term = terms[t];
    let from = 0;
    while (from < folded.norm.length) {
      const at = folded.norm.indexOf(term, from);
      if (at < 0) break;
      hits.push({ start: at, end: at + term.length });
      from = at + Math.max(term.length, 1);
    }
  }
  if (!hits.length) return { text: clip(src), ranges: [] };

  hits.sort((a, b) => a.start - b.start);
  const anchor = hits[0].start;
  const nStart = Math.max(0, anchor - windowRadius);
  const nEnd = Math.min(folded.norm.length, anchor + windowRadius);
  const origStart = folded.map[nStart];
  let origEnd = src.length;
  if (nEnd < folded.map.length) origEnd = charEnd(src, folded.map[nEnd - 1]);
  const slice = src.slice(origStart, origEnd);
  const prefix = origStart > 0 ? "…" : "";
  const suffix = origEnd < src.length ? "…" : "";
  const ranges = [];
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    if (hit.end <= nStart || hit.start >= nEnd) continue;
    const hs = Math.max(hit.start, nStart);
    const he = Math.min(hit.end, nEnd);
    const start = folded.map[hs] - origStart + prefix.length;
    const end = charEnd(src, folded.map[he - 1]) - origStart + prefix.length;
    if (end > start) ranges.push({ start: start, end: end });
  }
  return { text: prefix + slice + suffix, ranges: mergeRanges(ranges) };
}

function shiftISODate(iso, days) {
  const parts = String(iso || "").split("-");
  const dt = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  dt.setUTCDate(dt.getUTCDate() + days);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function nextStreak(streak, todayKey) {
  const prev = streak || { count: 0, lastDate: null };
  const count = prev.count || 0;
  if (prev.lastDate === todayKey) {
    return { count: count, lastDate: todayKey };
  }
  const yesterday = shiftISODate(todayKey, -1);
  if (prev.lastDate === yesterday) {
    return { count: count + 1, lastDate: todayKey };
  }
  return { count: 1, lastDate: todayKey };
}

if (typeof module !== "undefined") {
  module.exports = {
    normalize: normalize,
    searchSections: searchSections,
    snippetSource: snippetSource,
    snippet: snippet,
    pickDaily: pickDaily,
    lawOfCard: lawOfCard,
    lawKeysOfCard: lawKeysOfCard,
    nextStreak: nextStreak,
  };
}
