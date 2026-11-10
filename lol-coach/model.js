import { LESSONS, ROLES } from "./data.js";

export const STORAGE_KEY = "lol-coach:v1";
export const MAX_IMPORT_BYTES = 1_000_000;
export const GOALS = ["Farm", "Vagues", "Vision", "Positionnement", "Tempo", "Review"];
const lessonIds = new Set(LESSONS.map(lesson => lesson.id));
const ranks = new Set(["Silver", "Gold", "Platinum", "Emerald"]);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const text = (value, max, min = 0) => typeof value === "string" && value.trim().length >= min && value.length <= max;
const timestamp = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const id = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const requireValue = condition => { if (!condition) throw new Error("Sauvegarde invalide : format, limites ou valeurs non reconnus."); };

export function youtubeURL(input) {
  if (!input.trim()) return "";
  let url;
  try { url = new URL(input); } catch { throw new Error("Lien vidéo invalide."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash)
    throw new Error("Utilise un lien HTTPS YouTube sans identifiants ni fragment.");
  let videoId;
  if (url.hostname === "youtu.be" && /^\/[a-zA-Z0-9_-]{11}$/.test(url.pathname)) {
    videoId = url.pathname.slice(1);
  } else if (["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname)) {
    if (url.pathname === "/watch") videoId = url.searchParams.get("v");
    else if (/^\/(?:shorts|embed)\/[a-zA-Z0-9_-]{11}$/.test(url.pathname)) videoId = url.pathname.split("/")[2];
  }
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId))
    throw new Error("Lien attendu : youtube.com/watch?v=… ou youtu.be/… (ID de 11 caractères).");
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function defaultState() {
  return { version: 1, role: "adc", rank: "Silver", goal: "Farm", completed: [], quiz: {}, reviews: [], notes: [], games: [], activeNote: "" };
}

export function validateState(input) {
  requireValue(plain(input) && input.version === 1 && Object.hasOwn(ROLES, input.role) && ranks.has(input.rank) && GOALS.includes(input.goal));
  requireValue(Array.isArray(input.completed) && input.completed.length <= 20 && input.completed.every(value => lessonIds.has(value)) && new Set(input.completed).size === input.completed.length);
  requireValue(plain(input.quiz) && Object.keys(input.quiz).length <= 120);
  requireValue(Array.isArray(input.reviews) && input.reviews.length <= 300 && Array.isArray(input.notes) && input.notes.length <= 100 && Array.isArray(input.games) && input.games.length <= 100);
  const notes = input.notes.map(note => {
    requireValue(plain(note) && id(note.id) && Object.hasOwn(ROLES, note.role) && text(note.title, 120, 1) && text(note.transcript, 20000, 1) && text(note.question, 240, 1) && text(note.answer, 1000, 1) && text(note.url, 300) && timestamp(note.created));
    const url = youtubeURL(note.url);
    return { id: note.id, role: note.role, title: note.title, transcript: note.transcript, question: note.question, answer: note.answer, url, created: note.created };
  });
  requireValue(new Set(notes.map(note => note.id)).size === notes.length);
  const validQuizIds = new Set([...lessonIds, ...notes.map(note => `note:${note.id}`)]);
  const quiz = {};
  for (const [key, progress] of Object.entries(input.quiz)) {
    requireValue(validQuizIds.has(key) && plain(progress) && integer(progress.streak, 0, 8) && integer(progress.attempts, 1, 100000) && integer(progress.correct, 0, progress.attempts) && timestamp(progress.due));
    quiz[key] = { streak: progress.streak, attempts: progress.attempts, correct: progress.correct, due: progress.due };
  }
  const reviews = input.reviews.map(review => {
    requireValue(plain(review) && id(review.id) && Object.hasOwn(ROLES, review.role) && ["Victoire", "Défaite"].includes(review.result) && integer(review.cs, 0, 200) && integer(review.deaths, 0, 60) && GOALS.includes(review.goal) && text(review.lesson, 1500, 1) && text(review.next, 300, 1) && timestamp(review.created));
    return { id: review.id, role: review.role, result: review.result, cs: review.cs, deaths: review.deaths, goal: review.goal, lesson: review.lesson, next: review.next, created: review.created };
  });
  requireValue(new Set(reviews.map(review => review.id)).size === reviews.length);
  const games = input.games.map(game => {
    requireValue(plain(game) && ["farm", "decision"].includes(game.type) && Object.hasOwn(ROLES, game.role) && integer(game.score, 0, 100) && integer(game.total, 1, 100) && game.score <= game.total && timestamp(game.created));
    return { type: game.type, role: game.role, score: game.score, total: game.total, created: game.created };
  });
  requireValue(input.activeNote === "" || notes.some(note => note.id === input.activeNote));
  return { version: 1, role: input.role, rank: input.rank, goal: input.goal, completed: [...input.completed], quiz, reviews, notes, games, activeNote: input.activeNote };
}

export function parseBackup(raw) {
  if (new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES) throw new Error("Fichier trop volumineux (1 Mo maximum).");
  return validateState(JSON.parse(raw));
}

export function schedule(previous, correct, now = Date.now()) {
  const streak = correct ? Math.min((previous?.streak ?? 0) + 1, 8) : 0;
  const delay = correct ? Math.min(2 ** (streak - 1), 30) * 86400000 : 60000;
  return { streak, attempts: Math.min((previous?.attempts ?? 0) + 1, 100000), correct: Math.min((previous?.correct ?? 0) + Number(correct), 100000), due: new Date(now + delay).toISOString() };
}

export function dueCards(state, now = Date.now()) {
  const cards = LESSONS.filter(lesson => lesson.role === state.role).map(lesson => ({ ...lesson.quiz, kind: "lesson", source: lesson.rank }));
  cards.push(...state.notes.filter(note => note.role === state.role).map(note => ({ id: `note:${note.id}`, question: note.question, answer: note.answer, kind: "personal", source: note.title })));
  return cards.filter(card => !state.quiz[card.id] || Date.parse(state.quiz[card.id].due) <= now)
    .sort((a, b) => (Date.parse(state.quiz[a.id]?.due ?? "1970-01-01") - Date.parse(state.quiz[b.id]?.due ?? "1970-01-01")));
}

export function reviewStats(state) {
  const reviews = state.reviews.filter(review => review.role === state.role);
  const recent = reviews.slice(-5);
  const previous = reviews.slice(-10, -5);
  const mean = (items, key) => items.length ? items.reduce((sum, item) => sum + item[key], 0) / items.length : null;
  return { count: reviews.length, wins: reviews.filter(review => review.result === "Victoire").length, cs: mean(recent, "cs"), deaths: mean(recent, "deaths"), previousCS: mean(previous, "cs"), recent };
}
