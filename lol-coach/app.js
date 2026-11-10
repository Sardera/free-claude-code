import { EDITORIAL_DATE, LESSONS, ROLES, SCENARIOS, SOURCES } from "./data.js";
import { setupPWA } from "./pwa.js";
import { STORAGE_KEY, MAX_IMPORT_BYTES, GOALS, defaultState, parseBackup, validateState, youtubeURL, schedule, dueCards, reviewStats } from "./model.js";

const $ = selector => document.querySelector(selector);
const main = $("#main");
const pageNames = { dashboard: "Tableau de bord", lessons: "Parcours Emerald", practice: "Terrain d'entraînement", journal: "Journal de review", library: "Bibliothèque", help: "Aide & sauvegardes" };
let state = defaultState();
let cleanups = [];
let toastTimer;
let patchResult;
let snapshot;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) state = parseBackup(raw);
} catch {
  warn("Sauvegarde inaccessible ou invalide : rien n'a été écrasé. Exporte tes nouvelles données avant de quitter ; l'aide permet de restaurer un fichier valide.");
}
snapshot = JSON.stringify(state);

function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "className") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (value !== false && value !== undefined && value !== null) element.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}
function button(text, action, className = "btn", props = {}) { return h("button", { type: "button", className, onClick: action, ...props }, text); }
function link(text, href, className = "") { return h("a", { href, className }, text); }
function external(text, href) { return h("a", { href, target: "_blank", rel: "noopener noreferrer", className: "inline-link" }, text, " ↗"); }
function badge(text, variant = "") { return h("span", { className: `badge ${variant}` }, text); }
function panel(...children) { return h("section", { className: "panel" }, ...children); }
function date(value) { return new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }); }
function id() { return crypto.randomUUID(); }
function warn(message, kind = "storage") { const node = $("#storage-warning"); node.textContent = message; node.dataset.kind = kind; node.hidden = false; }
function toast(message) {
  const node = $("#toast"); node.textContent = message; node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 5000);
}
function persist() {
  let serialized;
  try {
    state = validateState(state);
    serialized = JSON.stringify(state);
    if (new TextEncoder().encode(serialized).length > MAX_IMPORT_BYTES) throw new Error("Capacité locale atteinte (1 Mo). Exporte puis supprime d'anciennes notes.");
  } catch (error) {
    state = parseBackup(snapshot); toast(error.message); return false;
  }
  snapshot = serialized;
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    if ($("#storage-warning").dataset.kind === "storage") $("#storage-warning").hidden = true;
  }
  catch { warn("Stockage indisponible ou plein : modifications en mémoire uniquement. Exporte une sauvegarde avant de fermer cette page."); }
  return true;
}
function heading(kicker, title, subtitle) {
  return h("div", { className: "page-heading" },
    h("div", {}, h("div", { className: "eyebrow" }, kicker), h("h1", {}, title), h("p", {}, subtitle)),
    h("span", { className: "date-tag" }, new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })));
}
function roles() {
  return h("section", { className: "role-bar", "aria-label": "Rôle entraîné" }, h("small", {}, "TON RÔLE DU JOUR"),
    h("div", { className: "role-tabs", role: "group", "aria-label": "Choisir un rôle" },
      Object.entries(ROLES).map(([key, role]) => button(`${role.icon} ${role.name}`, () => { state.role = key; if (persist()) render(); }, `role-tab ${state.role === key ? "selected" : ""}`, { "aria-pressed": state.role === key }))),
    h("span", { className: "secondary" }, "ADC en priorité · Mid en secondaire"));
}
function stat(title, number, detail, color = "") {
  return h("div", { className: "stat" }, h("div", { className: "stat-title" }, title), h("div", { className: `stat-number ${color}` }, number), h("small", {}, detail));
}
function progress(value, max) { return h("div", { className: "progress-track" }, h("progress", { value, max, "aria-label": `${value} leçons sur ${max}` })); }
function currentLessons() { return LESSONS.filter(lesson => lesson.role === state.role); }
function nextLesson() { return currentLessons().find(lesson => !state.completed.includes(lesson.id)) ?? currentLessons()[3]; }
function sectionTitle(title, text, href) { return h("div", { className: "section-title" }, h("h2", {}, title), text ? link(text, href) : null); }

function dashboard() {
  const role = ROLES[state.role], lessons = currentLessons();
  const done = lessons.filter(lesson => state.completed.includes(lesson.id)).length;
  const stats = reviewStats(state), due = dueCards(state).length, next = nextLesson();
  const note = state.notes.find(note => note.id === state.activeNote && note.role === state.role);
  const trend = stats.cs !== null && stats.previousCS !== null ? `${stats.cs - stats.previousCS >= 0 ? "+" : ""}${(stats.cs - stats.previousCS).toFixed(1)} vs les 5 précédentes` : "Après 10 reviews : tendance comparée";
  main.append(heading("UNE INTENTION. UNE PARTIE À LA FOIS.", "Le prochain palier se construit ici.", "Du Silver à l'Emerald, entraîne tes décisions — pas seulement ton rang."), roles(),
    h("section", { className: "hero" },
      h("div", {}, badge("TON CAP · EMERALD", "green"), h("h2", {}, "Moins d'autopilote.", h("br"), "Plus de bonnes décisions."),
        h("p", {}, `Aujourd'hui, on travaille ${ROLES[state.role].name === "ADC" ? "la régularité en ADC" : `ton rôle ${role.name}`}. ${role.subtitle} Un exercice court, une idée claire et un point à tester en partie.`),
        h("div", { className: "actions" }, link("Lancer ma session  →", "#practice", "btn"), link("Voir mon parcours", "#lessons", "btn outline"))),
      h("div", { className: "rank-art", "aria-hidden": "true" }, h("div", { className: "rank-gem" }, "E"), h("span", { className: "rank-caption" }, "OBJECTIF EMERALD"))),
    h("div", { className: "stats" },
      stat("TON POINT DE DÉPART", state.rank, "Déclaré par toi · jamais connecté à Riot", "gold-text"),
      stat("PARCOURS DU RÔLE", `${done} / 4`, "Leçons terminées à ton rythme", "mint"),
      stat("CS À 10 MIN · 5 DERNIÈRES", stats.cs === null ? "—" : stats.cs.toFixed(1), trend),
      stat("CARTES À RÉVISER", due, "Erreurs à +1 min · réussites espacées", "violet-text")),
    h("div", { className: "grid-two" },
      h("div", {},
        sectionTitle("Ton entraînement du jour", "Ouvrir le terrain ↗", "#practice"),
        panel(h("div", { className: "actions" }, badge("12 MIN · AVANT OU APRÈS TA PARTIE", "green")),
          step("01", "Une idée à comprendre", `${next.title} · ${next.rank}`, "3 min", "#lessons"),
          step("02", "Une décision à retrouver", `${due} cartes dues pour ton rôle · comprendre avant de cliquer`, "3 min", "#practice"),
          step("03", "Un geste à calibrer", "Simulation de last-hit ou lecture de situation", "2 min", "#practice"),
          step("04", "Une hypothèse à tester", "Écris une action observable dans ton journal", "4 min", "#journal")),
        sectionTitle("Une seule priorité en partie"),
        panel(h("div", { className: "eyebrow" }, `${role.name} · ${state.goal}`), h("h3", {}, role.subtitle),
          h("div", { className: "focus-card" }, h("p", {}, role.focus)), h("p", {}, role.target),
          note ? h("div", { className: "notice" }, "Ton rappel personnel : ", h("strong", {}, note.question), h("br"), note.answer) : null,
          stats.recent.length ? h("div", { className: "notice" }, "Ta dernière intention : ", stats.recent.at(-1).next) : null)),
      h("div", {},
        sectionTitle("La route vers Emerald", "Le parcours ↗", "#lessons"),
        panel(h("h3", {}, "La constance avant le classement"),
          h("div", { className: "track" }, ["Silver", "Gold", "Platinum", "Emerald"].flatMap((rank, index) => [
            index ? h("span", { className: "track-line" }) : null,
            h("div", { className: `track-rank ${rank === state.rank ? "current" : ""} ${rank === "Emerald" ? "target" : ""}` }, h("span", { className: "diamond", "aria-hidden": "true" }, "◈"), rank),
          ])), progress(done, 4), h("p", { className: "tiny" }, `${done} leçons terminées sur 4 · ${role.name}. Ce parcours n'est pas une prédiction de rang.`)),
        sectionTitle("Le recul fait progresser", "Mon journal ↗", "#journal"),
        panel(h("h3", {}, stats.count ? `${stats.count} partie${stats.count > 1 ? "s" : ""} relue${stats.count > 1 ? "s" : ""} · ${role.name}` : "Ta prochaine review commence ici"),
          h("p", {}, stats.count ? `${stats.wins} victoire${stats.wins > 1 ? "s" : ""} déclarée${stats.wins > 1 ? "s" : ""}. ${stats.deaths.toFixed(1)} morts en moyenne sur ${stats.recent.length === 1 ? "la dernière review" : `les ${stats.recent.length} dernières reviews`}. Cherche les causes, pas un score parfait.` : "Pas encore de données, pas de fausse statistique. Ajoute une partie pour commencer à repérer tes habitudes."),
          h("div", { className: "actions form-actions" }, link("Relire une partie  →", "#journal", "btn outline small"))),
        h("p", { className: "tiny muted" }, `Fondamentaux originaux · édition ${date(EDITORIAL_DATE)}. Aucun build ou conseil de méta présenté comme actuel.`))));
}
function step(number, title, description, duration, href) {
  return h("a", { href, className: "step" }, h("span", { className: "step-number" }, number), h("div", { className: "step-copy" }, h("h3", {}, title), h("p", {}, description)), h("span", { className: "duration" }, duration, " ↗"));
}

function lessonsPage() {
  main.append(heading("LES FONDAMENTAUX, PAS UNE TIER LIST.", "Quatre paliers. Une méthode.", "Commence là où tes habitudes se fragilisent. Les leçons restent accessibles dans n'importe quel ordre."), roles());
  const select = h("select", { id: "rank", onChange: event => { state.rank = event.target.value; persist(); } }, ["Silver", "Gold", "Platinum", "Emerald"].map(rank => h("option", { value: rank, selected: rank === state.rank }, rank)));
  main.append(h("div", { className: "rank-setting" }, h("label", { for: "rank" }, "Mon rang déclaré (aucune vérification Riot)"), select));
  const list = h("div", { className: "lesson-list" });
  for (const lesson of currentLessons()) {
    const complete = state.completed.includes(lesson.id);
    const mark = button(complete ? "✓ Leçon terminée · annuler" : "Marquer comme comprise", () => {
      state.completed = complete ? state.completed.filter(value => value !== lesson.id) : [...state.completed, lesson.id];
      if (persist()) { toast(complete ? "Leçon remise à travailler." : "Leçon enregistrée. Teste maintenant l'idée en partie."); render(); }
    }, "btn outline small");
    list.append(panel(h("div", { className: "lesson-head" },
      h("div", {}, badge(lesson.rank, lesson.rank === "Emerald" ? "green" : "gold"), h("h2", {}, lesson.title), h("p", {}, lesson.label)),
      badge(complete ? "✓ Compris" : "À travailler", complete ? "green" : "")),
      h("details", { open: lesson.id === nextLesson().id },
        h("summary", {}, "Lire la leçon & passer à l'action"),
        h("div", { className: "lesson-body" }, h("p", {}, lesson.body), h("p", {}, lesson.detail), h("h3", {}, "À tester lors de ta prochaine partie"), h("p", {}, lesson.drill), mark,
          h("div", { className: "notice" }, `Texte original · ${date(EDITORIAL_DATE)} · Références de découverte : `, link("Riot & wiki", "#library", "inline-link"), ". Le conseil doit être adapté à la partie, pas appliqué mécaniquement.")))));
  }
  main.append(list);
}

function quizPanel() {
  const box = panel(h("div", { className: "eyebrow" }, "MÉMOIRE ACTIVE"), h("h2", {}, "Comprendre. Retrouver. Réutiliser."));
  let card, answered = false;
  const content = h("div");
  function load() {
    content.replaceChildren(); answered = false;
    const cards = dueCards(state); card = cards[0];
    if (!card) {
      const entries = Object.entries(state.quiz).filter(([key]) => key.startsWith(`${state.role}-`) || state.notes.some(note => note.role === state.role && key === `note:${note.id}`));
      const next = entries.map(([, entry]) => Date.parse(entry.due)).sort((a, b) => a - b)[0];
      content.append(h("div", { className: "empty" }, "Toutes les cartes de ce rôle sont à jour.", next ? ` Prochaine révision : ${new Date(next).toLocaleString("fr-FR")}.` : ""), button("Vérifier les révisions dues", load, "btn outline small"));
      return;
    }
    content.append(h("p", { className: "tiny" }, `${cards.length} carte(s) due(s) · ${card.source}`));
    const quiz = h("div", { className: "quiz" }, h("h3", {}, card.question));
    const feedback = h("div", { "aria-live": "polite" });
    const next = button("Carte suivante →", load, "btn small", { hidden: true });
    function record(correct) {
      if (answered) return; answered = true;
      state.quiz[card.id] = schedule(state.quiz[card.id], correct);
      if (!persist()) return;
      feedback.append(h("div", { className: `feedback ${correct ? "success" : "error"}` }, correct ? "Bien retrouvé. Révision espacée à partir de demain." : "À retravailler : cette carte revient dans une minute.", card.kind === "lesson" ? ` ${card.explanation}` : " Auto-évaluation enregistrée, pas de correction automatique."));
      next.hidden = false; next.focus();
    }
    if (card.kind === "personal") {
      quiz.append(h("p", {}, "Carte personnelle : essaie de répondre avant de révéler le texte."), button("Révéler ma réponse", event => {
        event.currentTarget.disabled = true;
        quiz.append(h("div", { className: "feedback" }, card.answer),
          h("div", { className: "actions form-actions" }, button("À revoir", () => { record(false); disableRatings(); }, "btn outline"), button("Je l'avais retrouvé", () => { record(true); disableRatings(); })));
        function disableRatings() { quiz.querySelectorAll("button").forEach(node => { if (node !== next) node.disabled = true; }); }
      }, "btn outline"));
    } else {
      const choices = h("div", { className: "choice-list" });
      card.options.forEach((option, index) => choices.append(button(option, event => {
        choices.querySelectorAll("button").forEach((node, answerIndex) => {
          node.disabled = true;
          if (answerIndex === card.answer) node.classList.add("correct");
        });
        if (index !== card.answer) event.currentTarget.classList.add("wrong");
        record(index === card.answer);
      }, "choice")));
      quiz.append(choices);
    }
    quiz.append(feedback, h("div", { className: "actions form-actions" }, next)); content.append(quiz);
  }
  box.append(h("p", {}, "Un échec revient à +1 minute. Une réussite revient après 1, 2, 4… jours (30 max). Les cartes personnelles utilisent ton auto-évaluation."), content);
  load(); return box;
}

function practicePage() {
  main.append(heading("PETITES SESSIONS. VRAIES INTENTIONS.", "L'entraînement hors de la Faille.", "12 minutes suggérées : 3 de lecture, 3 de rappel, 2 de simulation, 4 de review. Pas besoin de tout réussir."), roles(), quizPanel(),
    h("div", { className: "section-title" }, h("h2", {}, "Le terrain de pratique"), badge("CLAVIER & TACTILE")),
    h("div", { className: "game-grid" }, farmGame(), decisionGame()),
    h("div", { className: "notice" }, "Ces exercices simplifiés entraînent une intention, pas les timings exacts du jeu. Vitesse d'attaque, projectiles, champions et dégâts réels ne sont pas simulés. Le jeu de décision suppose seulement le contexte affiché. Transfère ensuite l'idée dans l'outil d'entraînement de LoL."));
}

function farmGame() {
  const box = panel(badge("01 · TIMING", "green"), h("h2", {}, "Le bon dernier coup"),
    h("p", {}, "10 sbires, 2,2 secondes chacun. Attaque quand les PV sont entre 1 et 24. Un clic trop tôt ou trop tard perd le sbire. Espace ou bouton Attaquer."));
  const counter = h("span", {}, "0 / 10 sbires"), scoreLabel = h("span", {}, "0 réussi");
  const bar = h("progress", { value: 100, max: 100, "aria-label": "PV du sbire simulé" });
  const healthText = h("span", { className: "tiny" }, "En attente");
  const status = h("div", { className: "game-status", role: "status" }, "Prêt ? Un seul coup par sbire.");
  const attack = button("Attaquer [Espace]", () => hit(), "btn", { disabled: true });
  let running = false, active = false, number = 0, score = 0, started = 0, interval, timeout;
  const start = button("Commencer la simulation", begin, "btn outline");
  function clear() { clearInterval(interval); clearTimeout(timeout); }
  function stop(message) { clear(); running = false; active = false; attack.disabled = true; start.disabled = false; status.textContent = message; }
  function begin() {
    clear(); score = 0; number = 0; running = true; start.disabled = true; start.textContent = "Rejouer"; scoreLabel.textContent = "0 réussi"; spawn(); attack.focus();
  }
  function spawn() {
    if (!running) return;
    number++; counter.textContent = `${number} / 10 sbires`; active = true;
    started = performance.now(); bar.value = 100; healthText.textContent = "100 PV"; status.textContent = "Observe les PV, puis attaque."; attack.disabled = false;
    interval = setInterval(() => {
      const hp = Math.max(0, 100 - (performance.now() - started) / 22);
      bar.value = hp; healthText.textContent = `${Math.ceil(hp)} PV · cible : 1–24`;
      if (hp <= 0) finish(false, "Trop tard : le sbire est tombé.");
    }, 40);
  }
  function hit() {
    if (!running || !active) return;
    const hp = 100 - (performance.now() - started) / 22;
    finish(hp > 0 && hp <= 24, hp <= 0 ? "Trop tard." : hp <= 24 ? "Dernier coup réussi !" : "Trop tôt : garde ton attaque.");
  }
  function finish(success, message) {
    active = false; attack.disabled = true; clearInterval(interval);
    score += Number(success); scoreLabel.textContent = `${score} réussi${score > 1 ? "s" : ""}`; status.textContent = message;
    if (number === 10) {
      stop(`${message} Série terminée : ${score}/10. ${score >= 7 ? "Garde ce calme en partie." : "Regarde les PV avant d'attaquer ; rejoue sans te presser."}`);
      state.games = [...state.games, { type: "farm", role: state.role, score, total: 10, created: new Date().toISOString() }].slice(-100); persist();
    } else timeout = setTimeout(spawn, 800);
  }
  const keydown = event => {
    if (event.code === "Space" && running && !event.repeat && (event.target === document.body || event.target === attack || event.target === main)) { event.preventDefault(); hit(); }
  };
  const visibility = () => { if (document.hidden && running) stop("Simulation arrêtée car l'onglet est masqué. Aucun résultat partiel enregistré."); };
  document.addEventListener("keydown", keydown); document.addEventListener("visibilitychange", visibility);
  cleanups.push(() => { clear(); running = false; document.removeEventListener("keydown", keydown); document.removeEventListener("visibilitychange", visibility); });
  box.append(h("div", { className: "game-meta" }, counter, scoreLabel),
    h("div", { className: "game-arena" }, h("div", { className: "minion", "aria-hidden": "true" }, "♟"), h("div", { className: "health" }, bar), healthText, attack), status,
    h("div", { className: "actions form-actions" }, start, button("Arrêter", () => stop("Série arrêtée. Aucun résultat partiel enregistré."), "btn outline small")));
  return box;
}

function decisionGame() {
  const box = panel(badge("02 · LECTURE DE JEU", "violet"), h("h2", {}, "Et maintenant, tu fais quoi ?"),
    h("p", {}, "Lis la vague, l'information et le coût de ton choix. Une série complète enregistre ton score local ; les explications comptent plus que la note."));
  const content = h("div"); let scenarios, index = 0, score = 0;
  function begin() {
    scenarios = SCENARIOS.filter(item => item.roles.includes(state.role)).map(item => ({ item, order: Math.random() })).sort((a, b) => a.order - b.order).map(({ item }) => item);
    index = 0; score = 0; show();
  }
  function show() {
    content.replaceChildren();
    const scenario = scenarios[index];
    content.append(h("div", { className: "game-meta" }, `Situation ${index + 1} / ${scenarios.length}`, `${score} bonne(s) décision(s)`), h("h3", {}, scenario.title), h("p", {}, scenario.context));
    const choices = h("div", { className: "choice-list" }), feedback = h("div", { role: "status" });
    scenario.choices.forEach((choice, choiceIndex) => choices.append(button(choice, () => {
      choices.querySelectorAll("button").forEach((node, answerIndex) => { node.disabled = true; if (answerIndex === scenario.answer) node.classList.add("correct"); else if (answerIndex === choiceIndex) node.classList.add("wrong"); });
      const correct = choiceIndex === scenario.answer; score += Number(correct);
      feedback.append(h("div", { className: `feedback ${correct ? "success" : "error"}` }, scenario.why));
      const next = button(index === scenarios.length - 1 ? "Voir mon bilan →" : "Situation suivante →", () => {
        index++;
        if (index < scenarios.length) show();
        else {
          state.games = [...state.games, { type: "decision", role: state.role, score, total: scenarios.length, created: new Date().toISOString() }].slice(-100); persist();
          content.replaceChildren(h("div", { className: "feedback success", role: "status" }, `${score}/${scenarios.length} décisions adaptées au contexte. À tester : nommer une information manquante avant de te déplacer.`), button("Nouvelle série", begin, "btn outline"));
        }
      }, "btn small");
      feedback.append(h("div", { className: "actions form-actions" }, next)); next.focus();
    }, "choice")));
    content.append(choices, feedback);
  }
  const previous = state.games.filter(game => game.type === "decision" && game.role === state.role).at(-1);
  content.append(h("div", { className: "game-arena" }, h("div", { className: "minion", "aria-hidden": "true" }, "◇"), h("p", {}, previous ? `Dernière série : ${previous.score}/${previous.total} · ${date(previous.created)}` : "Pas de score inventé : ta première série t'attend."), button("Commencer les situations", begin, "btn outline")));
  box.append(content); return box;
}

function field(label, name, options = {}) {
  const { tag = "input", choices, ...props } = options;
  const control = h(tag, { name, id: name, ...props }, choices ? choices.map(value => h("option", { value }, value)) : null);
  return h("label", { for: name, className: props["data-full"] ? "full" : "" }, label, control);
}
function journalPage() {
  const stats = reviewStats(state);
  main.append(heading("LE REPLAY COMMENCE PAR UNE QUESTION.", "Transforme ta partie en piste de travail.", "Pas de données Riot automatiques : tes observations, honnêtes et comparables, sont la matière première."), roles(),
    h("div", { className: "stats" }, stat("REVIEWS · CE RÔLE", stats.count, "Saisies manuellement"), stat("VICTOIRES DÉCLARÉES", stats.count ? `${Math.round(stats.wins / stats.count * 100)} %` : "—", "Échantillon personnel, non vérifié"), stat("CS À 10 · 5 DERNIÈRES", stats.cs?.toFixed(1) ?? "—", "Indicateur de lane, pas un objectif support"), stat("MORTS · 5 DERNIÈRES", stats.deaths?.toFixed(1) ?? "—", "Cherche surtout les morts évitables")));
  const form = h("form", { onSubmit: event => {
    event.preventDefault();
    if (state.reviews.length >= 300) { toast("Limite de 300 reviews. Exporte puis supprime une ancienne entrée."); return; }
    const values = new FormData(form);
    const review = { id: id(), role: state.role, result: values.get("result"), cs: Number(values.get("cs")), deaths: Number(values.get("deaths")), goal: values.get("goal"), lesson: values.get("lesson").trim(), next: values.get("next").trim(), created: new Date().toISOString() };
    state.reviews.push(review); state.goal = review.goal;
    if (persist()) { toast("Review sauvegardée. Une intention claire pour la prochaine."); render(); }
  } }, h("div", { className: "form-grid" },
    field("Résultat déclaré", "result", { tag: "select", choices: ["Victoire", "Défaite"] }),
    field("Axe observé", "goal", { tag: "select", choices: GOALS }),
    field("CS à 10 minutes (0 si non relevé)", "cs", { type: "number", min: 0, max: 200, required: true, value: 0 }),
    field("Morts sur la partie", "deaths", { type: "number", min: 0, max: 60, required: true, value: 0 }),
    field("Un moment clé : que savais-tu avant d'agir ?", "lesson", { tag: "textarea", required: true, maxlength: 1500, minlength: 1, "data-full": true, placeholder: "À 8:30, j'avance pour un CS sans voir le jungler. Mon support vient de rappeler…" }),
    field("Prochaine partie : une action observable", "next", { tag: "textarea", required: true, maxlength: 300, minlength: 1, "data-full": true, placeholder: "Avant de dépasser ma vague, je vérifie le côté couvert par la vision." })),
    h("div", { className: "actions form-actions" }, h("button", { type: "submit", className: "btn" }, "Enregistrer ma review →"), h("span", { className: "field-note" }, "Local uniquement · 300 entrées maximum")));
  form.querySelector("#goal").value = state.goal;
  main.append(panel(h("h2", {}, `Relire une partie · ${ROLES[state.role].name}`), h("p", {}, "Un zéro non relevé est inclus dans la moyenne : relève les CS de façon cohérente. Pour jungle/support, privilégie ton axe qualitatif."), form),
    sectionTitle("Tes dernières observations"));
  const reviews = state.reviews.filter(review => review.role === state.role).slice().reverse();
  if (!reviews.length) main.append(h("div", { className: "empty" }, "Aucune review pour ce rôle. Commence par une seule décision, pas une analyse parfaite."));
  for (const review of reviews) main.append(h("article", { className: "review-card" },
    h("h3", {}, `${review.result} · ${date(review.created)}`),
    h("div", { className: "review-meta" }, badge(review.goal), `${review.cs} CS à 10 min · ${review.deaths} morts · ${ROLES[review.role].name}`),
    h("p", {}, review.lesson), h("div", { className: "focus-card" }, h("p", {}, h("strong", {}, "Prochain test : "), review.next)),
    h("div", { className: "actions" }, button("Reprendre cet axe", () => { state.goal = review.goal; if (persist()) toast(`Axe actif : ${review.goal}. Retrouve ta dernière intention au tableau de bord.`); }, "btn outline small"),
      button("Supprimer", () => { if (confirm("Supprimer définitivement cette review locale ?")) { state.reviews = state.reviews.filter(item => item.id !== review.id); if (persist()) render(); } }, "btn outline small"))));
}

function libraryPage() {
  main.append(heading("DES SOURCES, PAS DES PROMESSES.", "Ta bibliothèque de fondamentaux.", "Découvre les références, puis transforme un extrait autorisé en rappel personnel. Aucun scraping ni téléchargement de vidéo."), roles(), patchPanel());
  const sourceList = h("div", { className: "source-grid" });
  const notesList = h("div");
  function search(query) {
    const term = query.toLocaleLowerCase("fr");
    sourceList.replaceChildren();
    SOURCES.filter(source => `${source.title} ${source.kind} ${source.note}`.toLocaleLowerCase("fr").includes(term)).forEach(source => sourceList.append(h("article", { className: "source-card" },
      h("small", {}, source.kind), h("h3", {}, source.title), h("p", {}, source.note), external("Ouvrir la référence", source.url), h("small", {}, `Ajout éditorial : ${date(source.date)} · contenu non audité en direct`))));
    if (!sourceList.children.length) sourceList.append(h("div", { className: "empty" }, "Aucune référence correspondante."));
    notesList.replaceChildren();
    const notes = state.notes.filter(note => note.role === state.role && `${note.title} ${note.transcript} ${note.question} ${note.answer}`.toLocaleLowerCase("fr").includes(term));
    if (!notes.length) notesList.append(h("div", { className: "empty" }, "Aucun extrait pour ce rôle et cette recherche. Ajoute ton premier rappel ci-dessous."));
    notes.slice().reverse().forEach(note => notesList.append(h("article", { className: "note-card" },
      h("h3", {}, note.title), h("small", {}, `${ROLES[note.role].name} · ${date(note.created)} · texte fourni par toi`),
      note.url ? h("div", {}, external("Ouvrir la vidéo liée", note.url)) : null,
      h("details", {}, h("summary", {}, "Voir mon extrait / mes notes"), h("div", { className: "note-text" }, note.transcript)),
      h("div", { className: "focus-card" }, h("p", {}, h("strong", {}, note.question)), h("p", {}, note.answer)),
      h("div", { className: "actions" },
        button(state.activeNote === note.id ? "✓ Rappel actif · désactiver" : "Utiliser comme rappel du jour", () => { state.activeNote = state.activeNote === note.id ? "" : note.id; if (persist()) { toast("Rappel personnel mis à jour sur ton tableau de bord."); search(query); } }, "btn outline small"),
        button("Supprimer", () => {
          if (!confirm("Supprimer cet extrait et sa carte personnelle ?")) return;
          state.notes = state.notes.filter(item => item.id !== note.id); delete state.quiz[`note:${note.id}`]; if (state.activeNote === note.id) state.activeNote = "";
          if (persist()) search(query);
        }, "btn outline small")))));
  }
  const searchInput = h("input", { type: "search", id: "library-search", placeholder: "Vague, ADC, vision… recherche aussi dans tes extraits", maxlength: 200, onInput: event => search(event.target.value) });
  main.append(h("label", { for: "library-search", className: "search" }, "Rechercher dans les sources et mes notes du rôle", searchInput), sectionTitle("Les points de départ"), sourceList,
    h("div", { className: "notice" }, "Les dates ci-dessus indiquent l'ajout dans cette bibliothèque, pas une consultation ni une vérification du contenu. Les chaînes sont des pistes de découverte, pas des vidéos prétendument visionnées ou validées. Adapte les conseils à ta partie et vérifie les changements dans les notes officielles."),
    sectionTitle("Mes extraits → mes cartes"), notesList);
  const form = h("form", { onSubmit: event => {
    event.preventDefault();
    if (state.notes.length >= 100) { toast("Limite de 100 extraits atteinte. Exporte puis supprime d'anciennes notes."); return; }
    const values = new FormData(form);
    try {
      const note = { id: id(), role: state.role, title: values.get("title").trim(), url: youtubeURL(values.get("url").trim()), transcript: values.get("transcript").trim(), question: values.get("question").trim(), answer: values.get("answer").trim(), created: new Date().toISOString() };
      state.notes.push(note);
      if (persist()) { toast("Extrait enregistré. Ta carte est disponible dans l'entraînement de ce rôle."); render(); }
    } catch (error) { toast(error.message); }
  } }, h("div", { className: "form-grid" },
    field("Titre de mon extrait", "title", { required: true, maxlength: 120 }),
    field("Vidéo YouTube (facultatif, lien HTTPS)", "url", { type: "url", maxlength: 300, placeholder: "https://www.youtube.com/watch?v=…" }),
    field("Texte / transcript autorisé ou notes originales", "transcript", { tag: "textarea", required: true, maxlength: 20000, "data-full": true, placeholder: "Colle uniquement un texte que tu as le droit de conserver. Aucun contenu n'est téléchargé depuis le lien." }),
    field("Ma question de rappel", "question", { required: true, maxlength: 240, placeholder: "Que vérifier avant de suivre en rivière ?" }),
    field("Ma réponse, écrite par moi", "answer", { tag: "textarea", required: true, maxlength: 1000, placeholder: "L'état de ma vague, les ennemis visibles et une sortie." })),
    h("label", { className: "check-row form-actions" }, h("input", { type: "checkbox", required: true, name: "authorized" }), "Je dispose des droits nécessaires pour conserver ce texte localement."),
    h("div", { className: "actions form-actions" }, h("button", { type: "submit", className: "btn" }, "Créer mon extrait & ma carte →")),
    h("p", { className: "field-note" }, "20 000 caractères par extrait · 100 extraits · sauvegarde totale limitée à 1 Mo. Le lien devient un lien externe YouTube canonique ; pas de lecteur tiers ni de cookie vidéo ici."));
  main.append(panel(h("h2", {}, "Apporter une idée que tu veux retenir"), h("p", {}, "Tu écris la question et la réponse : aucun résumé IA n'est inventé. Ta carte rejoint les révisions espacées ; ton rappel choisi rejoint le tableau de bord."), form)); search("");
}

function patchPanel() {
  let patchPending = false;
  const box = panel(h("div", { className: "eyebrow" }, "ACTUALITÉ DES DONNÉES ≠ VALIDITÉ DES CONSEILS"), h("h2", {}, "Version publiée par Data Dragon"));
  const info = h("p", { role: "status" }), refresh = button("Actualiser l'état", () => fetchPatch(true), "btn outline small");
  function update() {
    refresh.disabled = patchPending;
    if (patchPending) info.textContent = "Consultation de l'endpoint Riot fixe…";
    else if (patchResult?.status === "available") info.textContent = `${patchResult.version} · consultation serveur : ${new Date(patchResult.checked_at).toLocaleString("fr-FR")}. Version d'assets publiée ; le patch en jeu peut dépendre de la région.`;
    else info.textContent = `Version indisponible. ${patchResult?.checked_at ? `Tentative serveur : ${new Date(patchResult.checked_at).toLocaleString("fr-FR")}.` : "Serveur ou réseau inaccessible."} Aucun numéro de patch n'est inventé.`;
  }
  async function fetchPatch(force = false) {
    if (patchPending || (patchResult && !force)) { update(); return; }
    patchPending = true; update();
    try {
      const response = await fetch(new URL("./api/patch", import.meta.url), { signal: AbortSignal.timeout(6000), cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      const result = await response.json();
      if (!["available", "unavailable"].includes(result.status) || typeof result.checked_at !== "string" || (result.status === "available" && !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(result.version))) throw new Error("Invalid response");
      patchResult = result;
    } catch { patchResult = { status: "unavailable" }; }
    finally { patchPending = false; update(); }
  }
  box.append(info, h("p", { className: "tiny" }, "API optionnelle du serveur local uniquement : indisponible sur un hébergement statique ou hors ligne, jamais mise en cache sur l'appareil. Cache serveur : 1 h si disponible, 1 min après échec. La date de consultation ne signifie pas que les leçons, vidéos ou pages externes ont été vérifiées."), h("div", { className: "actions form-actions" }, refresh, external("Notes officielles", SOURCES[0].url)));
  fetchPatch(); return box;
}

function helpPage() {
  main.append(heading("TON ESPACE. TES DONNÉES.", "Simple, local et transparent.", "Une application indépendante pour entraîner des habitudes. Ni coach IA, ni outil de collecte Riot."),
    panel(h("div", { className: "help-copy" }, h("h2", {}, "Démarrer & construire ta routine"),
      h("p", {}, "Dans un terminal, depuis le dossier lol-coach : ", h("code", {}, "uv run server.py"), ". Ouvre ", h("code", {}, "http://127.0.0.1:8765"), ". Pour un autre port : ", h("code", {}, "uv run server.py --port 8766"), ". Arrêt : Ctrl+C. Python 3.14+, aucune dépendance Python additionnelle."),
      h("p", {}, "Lancement depuis n'importe où : ", h("code", {}, "uv run --project /chemin/absolu/lol-coach /chemin/absolu/lol-coach/server.py"), ". Utilise l'adresse du serveur, pas un fichier HTML ouvert directement. Aucun .env ni aucune clé API n'est nécessaire."),
      h("h3", {}, "Installer sur Android"),
      h("p", {}, "Aucune URL publique n'est actuellement fournie ou publiée. Le serveur 127.0.0.1 est réservé à l'ordinateur qui l'exécute : ce n'est pas un lien accessible depuis ton téléphone. Il ne faut pas élargir son écoute pour installer l'application."),
      h("p", {}, "Une fois les fichiers publics hébergés en HTTPS : ouvre cette adresse dans Chrome sur Android, en ligne. Utilise « Installer sur cet appareil » si proposé, ou Chrome ⋮ → Installer l'application / Ajouter à l'écran d'accueil. Selon Chrome, ce menu peut proposer un simple raccourci. Une demande annulée n'installe rien. Ouvre l'icône pour vérifier le mode autonome."),
      h("h3", {}, "Préparer le hors ligne & les mises à jour"),
      h("p", {}, "Attends la fin du téléchargement initial, puis utilise « Recharger après sauvegarde » si proposé. Ne coupe le réseau qu'après le message « Hors ligne prêt ». Leçons, cartes, exercices, journal et exports fonctionnent alors sans réseau ; vidéos, liens externes et version Data Dragon nécessitent une connexion. Aucun contenu tiers ni réponse API n'est conservé par le service worker."),
      h("p", {}, "Une mise à jour attend la fermeture de tous les onglets et fenêtres Nexus : enregistre les formulaires et exporte avant de fermer, puis rouvre l'application. Aucun rechargement automatique ne détruit tes saisies. Le navigateur peut refuser ou évincer le cache et les données locales : le hors ligne n'est pas une sauvegarde. Exporte régulièrement et avant tout changement d'adresse ou d'appareil."),
      h("h3", {}, "Hébergement HTTPS pour développeurs"),
      h("p", {}, "Publie uniquement les fichiers publics autonomes de lol-coach : index.html, styles.css, app.js, data.js, model.js, pwa.js, sw.js, favicon.svg, manifest.webmanifest, icon-192.png, icon-512.png et icon-maskable-512.png. Jamais le dépôt entier, .env, .git, fichiers Python ou tests. Aucun déploiement n'est configuré ici. Les chemins relatifs permettent un sous-dossier (avec URL terminée par /). Sers les bons types MIME, les fichiers de façon atomique et sw.js sans cache HTTP durable ; incrémente sa VERSION à chaque changement du shell. L'API Python n'existe pas sur un hébergement statique : le patch y reste indisponible."),
      h("p", {}, "1. Choisis ton rôle (ADC par défaut ; Mid en secondaire). 2. Déclare ton rang dans le parcours, Silver ou Gold selon ton point de départ. 3. Lis une leçon et teste son idée. 4. Révise tes cartes, essaie les deux simulations. 5. Après la partie, saisis une review et une action observable."),
      h("h3", {}, "Ce que les chiffres signifient"),
      h("p", {}, "Les statistiques viennent uniquement des reviews manuelles du rôle sélectionné : CS à 10 min et morts, moyenne des 5 dernières. La tendance CS compare les 5 dernières aux 5 précédentes après 10 entrées. Un zéro « non relevé » compte : relève de manière cohérente. Les résultats des mini-jeux ne prédisent ni ton MMR ni ton rang. Les leçons validées ne certifient pas un niveau."),
      h("h3", {}, "Révisions & accessibilité"),
      h("p", {}, "Les mauvaises réponses reviennent après une minute ; les réussites après 1, 2, 4, 8, 16 puis 30 jours maximum, selon l'horloge de cet appareil. Clique « Carte suivante » ou « Vérifier les révisions dues » pour rafraîchir. Les cartes personnelles sont auto-évaluées. Tous les exercices fonctionnent au clavier et au tactile ; le last-hit s'arrête si tu quittes l'onglet. Change de page ou de rôle pour interrompre une série sans enregistrer de score partiel."),
      h("h3", {}, "Sources & limites assumées"),
      h("p", {}, "Les textes sont des fondamentaux originaux, pas des conseils de méta actuelle. Nous ne récupérons pas « tout Internet », ne visionnons aucune chaîne et ne transcrivons pas automatiquement YouTube. Tu peux conserver un extrait autorisé, écrire ta propre carte et utiliser son idée comme rappel du jour. Les liens ne sont pas téléchargés, intégrés ni analysés. Aucun conseil personnalisé par IA n'est prétendu."),
      h("p", {}, "Seul le serveur contacte l'URL HTTPS fixe de Data Dragon pour une version publiée (délai réseau 3 s, réponse plafonnée à 64 Ko, sans redirection). Cette version d'assets n'atteste pas du patch actif de ta région. Le mode hors réseau laisse les exercices utilisables et affiche « indisponible ». Les références ont une date d'ajout éditorial, pas une garantie de consultation ou de vérification."),
      h("h3", {}, "Confidentialité & durabilité"),
      h("p", {}, "localStorage reste dans ce navigateur pour cette origine (adresse + port). Ni compte ni synchronisation. Changer de navigateur/port, effacer les données ou utiliser le mode privé peut perdre la progression. Le stockage peut être refusé : une bannière l'indique, exporte alors avant de fermer. Les liens externes s'ouvrent seulement à ta demande. La sauvegarde contient tes textes : traite-la comme privée. Le serveur écoute uniquement 127.0.0.1 et ne sert que les fichiers de l'application."))),
    backupPanel(),
    h("section", { className: "panel danger-zone" }, h("h2", {}, "Repartir de zéro"), h("p", {}, "Efface le parcours, les reviews, les scores et les extraits de cette origine uniquement. Fais d'abord un export."),
      h("div", { className: "actions form-actions" }, button("Effacer mes données locales", () => {
        if (!confirm("Tout effacer sur cet appareil ? Cette action est irréversible sans export.")) return;
        try { localStorage.removeItem(STORAGE_KEY); } catch { toast("Effacement impossible : stockage inaccessible. Utilise les paramètres du navigateur."); return; }
        state = defaultState(); snapshot = JSON.stringify(state); $("#storage-warning").hidden = true; toast("Données locales effacées."); render();
      }, "btn danger"))));
}
function backupPanel() {
  const message = h("p", { role: "status", className: "form-actions" });
  const file = h("input", { type: "file", accept: ".json,application/json", id: "backup-file" });
  const importButton = button("Vérifier puis restaurer le fichier", async () => {
    const selected = file.files?.[0];
    if (!selected) { message.textContent = "Choisis d'abord un fichier JSON."; return; }
    if (selected.size > MAX_IMPORT_BYTES) { message.textContent = "Fichier trop volumineux : maximum 1 Mo."; return; }
    importButton.disabled = true;
    try {
      const restored = parseBackup(await selected.text());
      if (!confirm(`Remplacer les données actuelles par ${restored.reviews.length} reviews et ${restored.notes.length} extraits ? Pas de fusion. Exporte d'abord si nécessaire.`)) return;
      state = restored;
      if (persist()) { toast("Sauvegarde restaurée et validée."); render(); }
    } catch (error) { message.textContent = `Import refusé. Tes données actuelles sont conservées. ${error instanceof SyntaxError ? "JSON invalide." : error.message}`; }
    finally { importButton.disabled = false; }
  }, "btn outline");
  return panel(h("h2", {}, "Sauvegarder & restaurer"), h("p", {}, "Export JSON versionné. Import validé avant remplacement : 1 Mo max, 300 reviews, 100 extraits, 100 résultats et champs bornés. Aucun lien du fichier n'est ouvert à l'import."),
    h("div", { className: "actions form-actions" }, button("↓ Exporter mes données", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      // Compact exports use the same byte budget as the importer.
      const compact = new Blob([JSON.stringify(state)], { type: "application/json" });
      const url = URL.createObjectURL(blob.size <= MAX_IMPORT_BYTES ? blob : compact);
      const download = h("a", { href: url, download: `nexus-sauvegarde-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(download); download.click(); download.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast("Sauvegarde exportée. Conserve-la dans un endroit privé.");
    })),
    h("label", { for: "backup-file", className: "form-actions" }, "Restaurer un export Nexus", file), h("div", { className: "actions form-actions" }, importButton), message);
}

function render() {
  cleanups.forEach(cleanup => cleanup()); cleanups = [];
  const hash = location.hash.slice(1), page = Object.hasOwn(pageNames, hash) ? hash : "dashboard";
  main.replaceChildren();
  $("#page-label").textContent = pageNames[page];
  document.querySelectorAll("[data-page]").forEach(node => {
    node.classList.toggle("active", node.dataset.page === page);
    if (node.dataset.page === page) node.setAttribute("aria-current", "page"); else node.removeAttribute("aria-current");
  });
  ({ dashboard, lessons: lessonsPage, practice: practicePage, journal: journalPage, library: libraryPage, help: helpPage })[page]();
}
window.addEventListener("hashchange", () => { render(); main.focus(); window.scrollTo({ top: 0 }); });
$(".skip").addEventListener("click", event => { event.preventDefault(); main.focus(); });
window.addEventListener("pagehide", () => cleanups.forEach(cleanup => cleanup()));
window.addEventListener("pageshow", event => { if (event.persisted) render(); });
window.addEventListener("storage", event => {
  if (event.key === STORAGE_KEY) warn("La sauvegarde a changé dans un autre onglet. Exporte tes changements puis recharge avant de continuer pour éviter un écrasement.", "conflict");
});
render();
setupPWA();
