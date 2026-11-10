import test from "node:test";
import assert from "node:assert/strict";
import { LESSONS, ROLES, SCENARIOS, SOURCES } from "./data.js";
import { defaultState, validateState, parseBackup, MAX_IMPORT_BYTES, youtubeURL, schedule, dueCards, reviewStats } from "./model.js";

const created = "2026-11-10T12:00:00.000Z";
const note = () => ({ id: "test-note", role: "adc", title: "<img src=x onerror=alert(1)>", url: "https://youtu.be/abcdefghijk?t=42", transcript: "Mes notes autorisées", question: "Avant le combat ?", answer: "Lire la carte", created });
const review = (index = 0) => ({ id: `review-${index}`, role: "adc", result: index % 2 ? "Défaite" : "Victoire", cs: 50 + index, deaths: index, goal: "Farm", lesson: "Je suis sorti sans vision.", next: "Regarder la carte avant d'avancer.", created });

test("the scaffold is valid, defaults ADC/Silver and round-trips", () => {
  const state = defaultState();
  assert.equal(state.role, "adc"); assert.equal(state.rank, "Silver");
  assert.deepEqual(parseBackup(JSON.stringify(state)), state);
  assert.notEqual(validateState(state), state);
});

test("20 original lessons form four real rank steps for every role", () => {
  assert.equal(LESSONS.length, 20); assert.equal(new Set(LESSONS.map(item => item.id)).size, 20);
  for (const role of Object.keys(ROLES)) {
    const lessons = LESSONS.filter(item => item.role === role);
    assert.deepEqual(lessons.map(item => item.rank), ["Silver", "Gold", "Platinum", "Emerald"]);
    assert.ok(new Set(lessons.map(item => item.title)).size === 4);
    for (const lesson of lessons) {
      assert.ok(lesson.body.length > 150 && lesson.detail.length > 100 && lesson.drill.length > 80);
      assert.equal(lesson.quiz.options.length, 3);
      assert.ok(lesson.quiz.answer >= 0 && lesson.quiz.answer < 3);
      assert.ok(lesson.quiz.explanation.length > 60);
    }
    assert.ok(SCENARIOS.filter(item => item.roles.includes(role)).length >= 4);
  }
  for (const scenario of SCENARIOS) {
    assert.ok(scenario.answer >= 0 && scenario.answer < scenario.choices.length);
    assert.ok(scenario.why.length > 80);
  }
});

test("discovery sources are dated HTTPS references, not invented video IDs", () => {
  assert.ok(SOURCES.length >= 5);
  for (const source of SOURCES) {
    assert.equal(new URL(source.url).protocol, "https:");
    assert.match(source.date, /^\d{4}-\d\d-\d\d$/);
    assert.ok(source.note.length > 50);
  }
});

test("only canonical allowlisted HTTPS YouTube video links are retained", () => {
  for (const url of ["https://youtu.be/abcdefghijk?t=3", "https://youtube.com/watch?v=abcdefghijk&list=anything", "https://m.youtube.com/shorts/abcdefghijk", "https://www.youtube.com/embed/abcdefghijk"]) {
    assert.equal(youtubeURL(url), "https://www.youtube.com/watch?v=abcdefghijk");
  }
  assert.equal(youtubeURL(""), "");
  for (const url of [
    "javascript:alert(1)", "data:text/html,test", "file:///etc/passwd",
    "http://youtube.com/watch?v=abcdefghijk", "https://youtube.com.evil.test/watch?v=abcdefghijk",
    "https://youtube.com@evil.test/watch?v=abcdefghijk",
    "https://127.0.0.1/watch?v=abcdefghijk", "https://youtube.com:444/watch?v=abcdefghijk",
    "https://youtu.be/../../etc/passwd", "https://youtu.be/abcdefghijk/more", "https://youtu.be/short",
    "https://youtube.com/watch?v=abcdefghij%22", "https://youtube.com/watch?v=abcdefghijk#x",
    "https://www.youtube.com/@channel",
  ]) assert.throws(() => youtubeURL(url), { name: "Error" }, url);
  const authenticated = new URL("https://www.youtube.com/watch?v=abcdefghijk");
  authenticated.username = "viewer";
  assert.throws(() => youtubeURL(authenticated.href));
});

test("untrusted text is kept as text, URL normalized, unknown fields discarded", () => {
  const state = defaultState(); state.notes.push(note()); state.activeNote = "test-note";
  state.extra = "not retained"; state.notes[0].extra = "not retained";
  const result = validateState(state);
  assert.equal(result.notes[0].title, "<img src=x onerror=alert(1)>");
  assert.equal(result.notes[0].url, "https://www.youtube.com/watch?v=abcdefghijk");
  assert.equal(result.extra, undefined); assert.equal(result.notes[0].extra, undefined);
  assert.equal({}.polluted, undefined);
});

test("reject malformed import schemas, hostile URLs, impossible dates and oversized fields", () => {
  const mutations = [
    state => { state.version = 2; },
    state => { state.role = "__proto__"; },
    state => { state.rank = "Challenger"; },
    state => { state.goal = "unbounded"; },
    state => { state.completed = ["not-a-lesson"]; },
    state => { state.completed = ["adc-0", "adc-0"]; },
    state => { state.reviews = "not an array"; },
    state => { state.reviews = [review()]; state.reviews[0].deaths = -1; },
    state => { state.reviews = [review()]; state.reviews[0].cs = 201; },
    state => { state.reviews = [review()]; state.reviews[0].cs = 2.5; },
    state => { state.reviews = [review()]; state.reviews[0].created = "2026-02-31T12:00:00.000Z"; },
    state => { state.notes = [note()]; state.notes[0].url = "https://127.0.0.1"; },
    state => { state.notes = [note()]; state.notes[0].transcript = "x".repeat(20001); },
    state => { state.notes = [note()]; state.notes[0].question = " "; },
    state => { state.notes = [note(), note()]; },
    state => { state.activeNote = "missing"; },
    state => { state.quiz = { nonexistent: schedule(null, true) }; },
    state => { state.quiz = { "adc-0": { streak: 9, attempts: 1, correct: 1, due: created } }; },
    state => { state.quiz = { "adc-0": { streak: 1, attempts: 1, correct: 2, due: created } }; },
    state => { state.games = [{ type: "farm", role: "adc", score: 11, total: 10, created }]; },
  ];
  for (const mutate of mutations) { const state = defaultState(); mutate(state); assert.throws(() => validateState(state)); }
  for (const value of [null, [], 42, true, {}, "text"]) assert.throws(() => validateState(value));
  assert.throws(() => parseBackup("{broken"));
  assert.throws(() => parseBackup(" ".repeat(MAX_IMPORT_BYTES + 1)), /volumineux/);
  assert.throws(() => parseBackup("é".repeat(MAX_IMPORT_BYTES / 2 + 1)), /volumineux/);
});

test("enforces collection limits and does not mutate an existing state on failed import", () => {
  const state = defaultState(), original = JSON.stringify(state);
  const limits = [
    ["reviews", Array.from({ length: 301 }, (_, index) => review(index))],
    ["notes", Array.from({ length: 101 }, (_, index) => ({ ...note(), id: `note-${index}` }))],
    ["games", Array.from({ length: 101 }, () => ({ type: "farm", role: "adc", score: 5, total: 10, created }))],
  ];
  for (const [key, values] of limits) assert.throws(() => parseBackup(JSON.stringify({ ...state, [key]: values })));
  assert.equal(JSON.stringify(state), original);
});

test("spaced recall retries after a minute, doubles successes, caps at 30 days", () => {
  const now = Date.parse(created);
  const wrong = schedule(null, false, now);
  assert.equal(Date.parse(wrong.due) - now, 60000); assert.equal(wrong.streak, 0);
  let success = schedule(wrong, true, now);
  assert.equal(Date.parse(success.due) - now, 86400000); assert.equal(success.attempts, 2);
  success = schedule(success, true, now);
  assert.equal(Date.parse(success.due) - now, 2 * 86400000);
  for (let i = 0; i < 20; i++) success = schedule(success, true, now);
  assert.equal(success.streak, 8); assert.equal(Date.parse(success.due) - now, 30 * 86400000);
  const failure = schedule(success, false, now); assert.equal(failure.streak, 0); assert.equal(failure.correct, success.correct);
  const maximum = schedule({ streak: 8, attempts: 100000, correct: 100000, due: created }, true, now);
  assert.equal(maximum.attempts, 100000); assert.equal(maximum.correct, 100000);
});

test("due cards are role-specific and include the user's actual notes", () => {
  const state = defaultState(), now = Date.parse(created);
  assert.equal(dueCards(state, now).length, 4);
  state.quiz["adc-0"] = schedule(null, false, now);
  assert.equal(dueCards(state, now + 59999).length, 3);
  assert.equal(dueCards(state, now + 60000).length, 4);
  state.notes.push(note());
  const card = dueCards(state, now).find(item => item.kind === "personal");
  assert.equal(card.question, note().question); assert.equal(card.answer, note().answer);
  state.role = "mid";
  assert.ok(dueCards(state, now).every(item => item.id.startsWith("mid-")));
});

test("review statistics use only the selected role and last five observations", () => {
  const state = defaultState();
  assert.equal(reviewStats(state).cs, null); assert.equal(reviewStats(state).count, 0);
  state.reviews = Array.from({ length: 10 }, (_, index) => review(index));
  state.reviews.push({ ...review(90), role: "mid" });
  const stats = reviewStats(state);
  assert.equal(stats.count, 10); assert.equal(stats.wins, 5);
  assert.equal(stats.cs, 57); assert.equal(stats.previousCS, 52); assert.equal(stats.deaths, 7);
});
