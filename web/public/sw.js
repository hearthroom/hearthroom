/*
  站台的 service worker：只做「能安裝」需要的最低限度。

  刻意不快取任何頁面或資源——部署後舊分頁的處理已經由前端的 chunk-reload 接手，
  再加一層資源快取只會跟它打架，還會讓使用者拿到舊版。這裡只攔導覽請求：
  網路正常就原樣交回，斷線時給一張離線頁，讓人知道是網路而不是站台掛了。

  fetch 處理器不能是空的：Chrome 會把空的處理器當成沒有，安裝性檢查照樣不過。
*/
const VERSION = "hr-sw-1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }),
  );
});
