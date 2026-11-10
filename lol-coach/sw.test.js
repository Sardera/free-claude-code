import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./sw.js", import.meta.url), "utf8");
function worker(base = "https://nexus.test/coach/", options = {}) {
  const events = {}, stores = new Map(), fetched = [], deleted = [];
  const prefix = `nexus-shell:${base}:`, name = prefix + "v2";
  const caches = {
    async open(key) {
      if (options.storageFailure) throw new Error("Quota");
      if (!stores.has(key)) stores.set(key, new Map());
      const store = stores.get(key);
      return {
        async put(url, response) { if (options.putFailure) throw new Error("Quota"); store.set(url, response); },
        async match(url) { return store.get(url)?.clone(); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(key) { deleted.push(key); return stores.delete(key); },
  };
  const self = { location: { href: base + "sw.js" }, addEventListener(type, cb) { events[type] = cb; } };
  vm.runInNewContext(source, {
    self, caches, URL, Request, AbortSignal,
    fetch: async request => {
      fetched.push(request);
      if (options.networkFailure || fetched.length === options.failAt) throw new Error("Offline");
      const response = new Response(request.url, { status: options.httpFailure ? 503 : 200 });
      if (options.opaque) Object.defineProperty(response, "type", { value: "opaque" });
      if (options.redirected) Object.defineProperty(response, "redirected", { value: true });
      return response;
    },
  });
  async function lifecycle(type) {
    let task;
    events[type]({ waitUntil(promise) { task = promise; } });
    await task;
  }
  async function fetchPath(path, props = {}) {
    let response;
    events.fetch({ request: { url: new URL(path, base).href, method: "GET", mode: "cors", ...props }, respondWith(promise) { response = promise; } });
    return response ? await response : null;
  }
  async function status() {
    let task, message;
    events.message({ data: { type: "SHELL_STATUS" }, ports: [{ postMessage(value) { message = value; } }], waitUntil(promise) { task = promise; } });
    await task; return message.ready;
  }
  return { events, stores, fetched, deleted, prefix, name, lifecycle, fetchPath, status, options };
}

for (const base of ["https://nexus.test/", "https://nexus.test/project/lol-coach/"]) {
  test(`precache and offline navigation are scope-relative at ${base}`, async () => {
    const sw = worker(base);
    await sw.lifecycle("install");
    assert.equal(sw.fetched.length, 11);
    assert.equal(sw.stores.get(sw.name).size, 11);
    assert.equal(await sw.status(), true);
    for (const request of sw.fetched) {
      assert.ok(request.url.startsWith(base));
      assert.equal(request.cache, "reload");
      assert.equal(request.credentials, "omit");
      assert.equal(request.redirect, "error");
    }
    sw.options.networkFailure = true;
    assert.equal(await (await sw.fetchPath("./", { mode: "navigate" })).text(), base + "index.html");
    assert.equal(await (await sw.fetchPath("./#practice", { mode: "navigate" })).text(), base + "index.html");
    assert.equal(await (await sw.fetchPath("index.html", { mode: "navigate" })).text(), base + "index.html");
    assert.equal(await (await sw.fetchPath("app.js")).text(), base + "app.js");
    assert.equal(sw.fetched.length, 11);
  });
}

test("API, queries, unknown/private/cross-scope/third-party and non-GET requests are never intercepted", async () => {
  const sw = worker();
  await sw.lifecycle("install");
  for (const path of ["api/patch", "api/patch?url=private", ".env", "server.py", "unknown", "sw.js", "app.js?private=1", "./?token=private", "/other/index.html", "https://youtube.com/watch?v=secret"]) {
    assert.equal(await sw.fetchPath(path, { mode: "navigate" }), null, path);
  }
  for (const method of ["POST", "HEAD", "PUT"]) assert.equal(await sw.fetchPath("app.js", { method }), null);
  assert.equal(sw.stores.get(sw.name).size, 11);
  assert.equal(sw.fetched.length, 11);
});

test("activation deletes only this scope's old versions; no forced takeover", async () => {
  const sw = worker();
  for (const key of [sw.prefix + "v0", sw.name, "unrelated", "nexus-shell:https://nexus.test/other/:v0"]) sw.stores.set(key, new Map());
  await sw.lifecycle("activate");
  assert.deepEqual(sw.deleted, [sw.prefix + "v0"]);
  assert.equal(sw.stores.size, 3);
  // The fake self deliberately has no skipWaiting or clients.claim methods.
});

for (const option of ["networkFailure", "httpFailure", "putFailure", "storageFailure", "opaque", "redirected"]) {
  test(`failed install is rejected and partial cache removed: ${option}`, async () => {
    const sw = worker(undefined, { [option]: true });
    sw.stores.set(sw.prefix + "v0", new Map());
    await assert.rejects(sw.lifecycle("install"));
    assert.equal(sw.stores.has(sw.name), false);
    assert.equal(sw.stores.has(sw.prefix + "v0"), true);
    assert.deepEqual(sw.deleted, [sw.name]);
  });
}

test("failure halfway through installation removes already written shell files", async () => {
  const sw = worker(undefined, { failAt: 6 });
  await assert.rejects(sw.lifecycle("install"), /Offline/);
  assert.equal(sw.fetched.length, 6);
  assert.equal(sw.stores.has(sw.name), false);
});

test("evicted cache and storage refusal fall back to network without caching responses", async () => {
  const sw = worker();
  await sw.lifecycle("install");
  sw.stores.get(sw.name).delete("https://nexus.test/coach/app.js");
  assert.equal(await sw.status(), false);
  assert.ok(await sw.fetchPath("app.js"));
  assert.equal(sw.stores.get(sw.name).size, 10);
  sw.options.storageFailure = true;
  assert.equal(await sw.status(), false);
  assert.ok(await sw.fetchPath("./", { mode: "navigate" }));
  sw.options.networkFailure = true;
  await assert.rejects(sw.fetchPath("./", { mode: "navigate" }), /Offline/);
});
