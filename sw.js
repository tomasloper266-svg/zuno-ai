"use strict";
(() => {
  // src/sw/strategy.ts
  var CHAT_PATH_SEGMENT = "chat";
  function isChatApiPath(pathname) {
    return pathname.split("/").includes(CHAT_PATH_SEGMENT);
  }
  function isEventStream(accept) {
    return /\btext\/event-stream\b/i.test(accept);
  }
  function isHashedBuildAsset(pathname) {
    return pathname.includes("/assets/");
  }
  function cacheStrategyFor(facts) {
    if (facts.method !== "GET") return "passthrough";
    if (isEventStream(facts.accept)) return "passthrough";
    let pathname;
    try {
      pathname = new URL(facts.url).pathname;
    } catch {
      return "passthrough";
    }
    if (isChatApiPath(pathname)) return "passthrough";
    if (facts.origin !== new URL(facts.url).origin) return "passthrough";
    if (!facts.scope.endsWith("/") || !facts.url.startsWith(facts.scope)) return "passthrough";
    if (facts.mode === "navigate") return "network-first";
    if (isHashedBuildAsset(pathname)) return "cache-first";
    return "network-first";
  }

  // src/sw/sw.ts
  var sw = self;
  var ASSET_CACHE = `zuno-assets-${"vmvgq9fak"}`;
  var PAGE_CACHE = `zuno-pages-${"vmvgq9fak"}`;
  var OWNED_CACHES = [ASSET_CACHE, PAGE_CACHE];
  sw.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys().then(
        (keys) => Promise.all(keys.filter((key) => !OWNED_CACHES.includes(key)).map((key) => caches.delete(key)))
      ).then(() => sw.clients.claim())
    );
  });
  async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached !== void 0) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(ASSET_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  }
  async function networkFirst(request) {
    try {
      const response = await fetch(request);
      if (response.ok || response.type === "opaque") {
        const cache = await caches.open(PAGE_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (err) {
      const cached = await caches.match(request);
      if (cached !== void 0) return cached;
      if (request.mode === "navigate") {
        const shell = await caches.match("./");
        if (shell !== void 0) return shell;
      }
      throw err;
    }
  }
  sw.addEventListener("fetch", (event) => {
    const request = event.request;
    const strategy = cacheStrategyFor({
      method: request.method,
      url: request.url,
      mode: request.mode,
      accept: request.headers.get("accept") ?? "",
      origin: sw.location.origin,
      scope: sw.registration.scope
    });
    if (strategy === "passthrough") return;
    event.respondWith(strategy === "cache-first" ? cacheFirst(request) : networkFirst(request));
  });
  sw.addEventListener("message", (event) => {
    if (event.data === "SKIP_WAITING") void sw.skipWaiting();
  });
})();
