export function setupPWA(win = window, doc = document) {
  const nav = win.navigator;
  const status = doc.querySelector("#offline-status");
  const installStatus = doc.querySelector("#install-status");
  const install = doc.querySelector("#install-app");
  const reload = doc.querySelector("#reload-app");
  const workerURL = new URL("./sw.js", win.location.href);
  const standalone = () => win.matchMedia("(display-mode: standalone)").matches;
  let deferred, registration, ready = false, failure = "", checking = 0;
  const manual = "Android : Chrome ⋮ → Installer l'application / Ajouter à l'écran d'accueil (HTTPS requis).";
  function installation() {
    install.hidden = standalone() || !deferred;
    if (standalone()) installStatus.textContent = "Application ouverte en mode autonome.";
  }
  function display() {
    const network = nav.onLine ? "En ligne. " : "Hors connexion. ";
    status.textContent = network + (failure || (registration?.waiting
      ? "Mise à jour prête : enregistre ou exporte tes données, puis ferme tous les onglets et fenêtres Nexus avant de rouvrir. Aucun rechargement automatique."
      : ready ? "Hors ligne prêt : leçons, exercices et journal disponibles. Vidéos et patch nécessitent le réseau."
      : registration?.active && !nav.serviceWorker.controller ? "Cache téléchargé. Enregistre tes saisies, puis utilise « Recharger après sauvegarde » pour confirmer le hors ligne."
      : "Hors ligne non confirmé. Une première connexion et un cache complet sont nécessaires."));
  }
  async function check() {
    const sequence = ++checking;
    let cached = false;
    const controller = nav.serviceWorker.controller;
    if (controller?.scriptURL === workerURL.href) {
      try {
        cached = await new Promise((resolve, reject) => {
          const channel = new win.MessageChannel();
          const timeout = win.setTimeout(() => { channel.port1.close(); reject(new Error("Timeout")); }, 3000);
          channel.port1.onmessage = event => {
            win.clearTimeout(timeout); channel.port1.close();
            resolve(event.data?.ready === true);
          };
          controller.postMessage({ type: "SHELL_STATUS" }, [channel.port2]);
        });
      } catch { cached = false; }
    }
    if (sequence !== checking) return;
    ready = cached;
    reload.hidden = controller?.scriptURL === workerURL.href || !registration?.active || !!registration?.waiting;
    display();
  }
  win.addEventListener("beforeinstallprompt", event => {
    event.preventDefault(); deferred = event;
    installStatus.textContent = "Installation proposée par Chrome : utilise le bouton ou le menu ⋮.";
    installation();
  });
  install.addEventListener("click", () => {
    const prompt = deferred;
    if (!prompt) return;
    deferred = null; install.hidden = true;
    try {
      // Must remain synchronous with this user gesture.
      const result = prompt.prompt();
      Promise.resolve(result).then(() => prompt.userChoice).then(choice => {
        installStatus.textContent = choice.outcome === "accepted"
          ? "Demande acceptée. Termine l'installation dans Chrome ; ouvre ensuite l'icône Nexus."
          : `Installation annulée. ${manual}`;
        installation();
      }).catch(() => { installStatus.textContent = `Installation indisponible. ${manual}`; });
    } catch { installStatus.textContent = `Installation indisponible. ${manual}`; }
  });
  win.addEventListener("appinstalled", () => {
    deferred = null; install.hidden = true;
    installStatus.textContent = "Chrome a confirmé l'installation de Nexus.";
  });
  win.matchMedia("(display-mode: standalone)").addEventListener("change", installation);
  installation();
  reload.addEventListener("click", () => {
    if (win.confirm("Enregistre les formulaires et exporte si nécessaire. Recharger abandonne les saisies non enregistrées. Continuer ?")) win.location.reload();
  });
  for (const name of ["online", "offline", "pageshow"]) win.addEventListener(name, () => {
    if ("serviceWorker" in nav && win.isSecureContext) void check();
    else display();
  });
  if (!win.isSecureContext || !("serviceWorker" in nav)) {
    failure = "Hors ligne indisponible : navigateur compatible et HTTPS requis (localhost sur cet appareil uniquement).";
    display(); return;
  }
  nav.serviceWorker.addEventListener("controllerchange", () => { void check(); });
  nav.serviceWorker.register(workerURL, { scope: "./", updateViaCache: "none" }).then(reg => {
    registration = reg;
    function watch(worker) {
      worker.addEventListener("statechange", () => {
        if (worker.state === "redundant") failure = "Préparation ou mise à jour hors ligne échouée. Vérifie le réseau et l'espace de stockage, puis réessaie en rouvrant l'application.";
        void check();
      });
    }
    if (reg.installing) watch(reg.installing);
    reg.addEventListener("updatefound", () => { if (reg.installing) watch(reg.installing); });
    void check();
  }).catch(() => {
    failure = "Hors ligne indisponible : cache ou service worker refusé. Vérifie HTTPS, le réseau et le stockage du navigateur. L'application reste utilisable en ligne.";
    display();
  });
  display();
}
