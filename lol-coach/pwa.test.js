import test from "node:test";
import assert from "node:assert/strict";
import { setupPWA } from "./pwa.js";

function target(props = {}) {
  const listeners = {};
  return {
    ...props,
    addEventListener(type, callback) { (listeners[type] ??= []).push(callback); },
    emit(type, event = {}) { for (const callback of listeners[type] ?? []) callback(event); },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function environment({ secure = true, supported = true, standalone = false, reject = false, controller = false, cached = true, waiting = false, active = true } = {}) {
  const elements = Object.fromEntries(["offline-status", "install-status", "install-app", "reload-app"].map(id => [id, target({ textContent: "", hidden: true })]));
  const media = target({ matches: standalone });
  const reg = target({ active: active ? {} : null, waiting: waiting ? {} : null, installing: null });
  const calls = [];
  const sw = target({
    controller: controller ? { scriptURL: "https://nexus.test/project/sw.js", postMessage(data, ports) { ports[0].send({ ready: cached }); } } : null,
    async register(url, options) { calls.push([url, options]); if (reject) throw new Error("Denied"); return reg; },
  });
  class Channel {
    constructor() {
      this.port1 = { close() {}, onmessage: null };
      this.port2 = { send: data => this.port1.onmessage({ data }) };
    }
  }
  let reloads = 0;
  const win = target({
    navigator: { onLine: true, ...(supported ? { serviceWorker: sw } : {}) },
    isSecureContext: secure,
    location: { href: "https://nexus.test/project/index.html#help", reload() { reloads++; } },
    matchMedia: () => media, MessageChannel: Channel,
    setTimeout, clearTimeout, confirm: () => false,
  });
  const doc = { querySelector: selector => elements[selector.slice(1)] };
  setupPWA(win, doc);
  return { win, sw, reg, media, elements, calls, reloads: () => reloads };
}

test("unsupported/insecure service worker degrades to honest manual installation instructions", async () => {
  for (const options of [{ secure: false }, { supported: false }]) {
    const env = environment(options);
    await settle();
    assert.equal(env.calls.length, 0);
    assert.match(env.elements["offline-status"].textContent, /indisponible/);
    assert.equal(env.elements["install-app"].hidden, true);
  }
});

test("installation prompt is called synchronously only on click; dismissal is not installation", async () => {
  const env = environment();
  let prompts = 0, prevented = false;
  env.win.emit("beforeinstallprompt", {
    preventDefault() { prevented = true; },
    prompt() { prompts++; return Promise.resolve(); },
    userChoice: Promise.resolve({ outcome: "dismissed" }),
  });
  assert.equal(prevented, true);
  assert.equal(prompts, 0);
  assert.equal(env.elements["install-app"].hidden, false);
  env.elements["install-app"].emit("click");
  assert.equal(prompts, 1);
  await settle();
  assert.match(env.elements["install-status"].textContent, /annulée/);
  assert.equal(env.elements["install-app"].hidden, true);
  env.elements["install-app"].emit("click");
  assert.equal(prompts, 1);
});

test("accepted prompt does not claim installed; appinstalled and standalone are distinguished", async () => {
  const env = environment();
  env.win.emit("beforeinstallprompt", { preventDefault() {}, prompt() {}, userChoice: Promise.resolve({ outcome: "accepted" }) });
  env.elements["install-app"].emit("click");
  await settle();
  assert.match(env.elements["install-status"].textContent, /Demande acceptée/);
  assert.doesNotMatch(env.elements["install-status"].textContent, /confirmé/);
  env.win.emit("appinstalled");
  assert.match(env.elements["install-status"].textContent, /confirmé/);
  assert.equal(env.elements["install-app"].hidden, true);
  assert.match(environment({ standalone: true }).elements["install-status"].textContent, /mode autonome/);
});

test("prompt errors restore manual menu fallback", async () => {
  for (const prompt of [() => { throw new Error("Denied"); }, () => Promise.reject(new Error("Denied"))]) {
    const env = environment();
    env.win.emit("beforeinstallprompt", { preventDefault() {}, prompt });
    env.elements["install-app"].emit("click");
    await settle();
    assert.match(env.elements["install-status"].textContent, /indisponible.*Chrome/);
  }
});

test("offline readiness requires a controller and verified complete cache", async () => {
  for (const options of [{ controller: false }, { controller: true, cached: false }, { controller: true, cached: true }]) {
    const env = environment(options);
    await settle();
    assert.equal(env.elements["offline-status"].textContent.includes("Hors ligne prêt"), !!options.controller && options.cached);
    assert.equal(env.calls[0][0].href, "https://nexus.test/project/sw.js");
    assert.equal(env.calls[0][1].scope, "./");
    assert.equal(env.calls[0][1].updateViaCache, "none");
    env.win.navigator.onLine = false; env.win.emit("offline");
    await settle();
    assert.match(env.elements["offline-status"].textContent, /^Hors connexion/);
  }
});

test("first activation offers consented reload; waiting update never reloads unsaved forms", async () => {
  const env = environment();
  await settle();
  assert.equal(env.elements["reload-app"].hidden, false);
  env.elements["reload-app"].emit("click");
  assert.equal(env.reloads(), 0);
  env.win.confirm = () => true;
  env.elements["reload-app"].emit("click");
  assert.equal(env.reloads(), 1);
  const update = environment({ waiting: true, controller: true });
  await settle();
  assert.match(update.elements["offline-status"].textContent, /Mise à jour prête.*ferme tous/);
  assert.equal(update.elements["reload-app"].hidden, true);
  assert.equal(update.reloads(), 0);
});

test("a worker from another scope cannot confirm this application's offline readiness", async () => {
  const env = environment({ controller: true });
  env.sw.controller.scriptURL = "https://nexus.test/sw.js";
  await settle();
  assert.doesNotMatch(env.elements["offline-status"].textContent, /Hors ligne prêt/);
  assert.equal(env.elements["reload-app"].hidden, false);
});

test("registration and installation storage failures do not claim readiness", async () => {
  const env = environment({ reject: true });
  await settle();
  assert.match(env.elements["offline-status"].textContent, /refusé/);
  const install = environment({ active: false });
  await settle();
  const worker = target({ state: "installing" });
  install.reg.installing = worker; install.reg.emit("updatefound");
  worker.state = "redundant"; worker.emit("statechange");
  await settle();
  assert.match(install.elements["offline-status"].textContent, /échouée/);
});
