/*
  站台的 service worker：只做「能安裝」需要的最低限度。

  刻意不快取任何頁面或資源——部署後舊分頁的處理已經由前端的 chunk-reload 接手，
  再加一層資源快取只會跟它打架，還會讓使用者拿到舊版。這裡只攔導覽請求：
  網路正常就原樣交回，斷線時給一張離線頁，讓人知道是網路而不是站台掛了。

  fetch 處理器不能是空的：Chrome 會把空的處理器當成沒有，安裝性檢查照樣不過。
*/
const VERSION = "hr-sw-3";
// 資源層會把 /offline.html 轉成 /offline（307）；導覽請求不能用轉址過的回應回，所以直接用乾淨網址
const OFFLINE_URL = "/offline";

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

/*
  推播：伺服器送來的是一句話加一個站內路徑（src/community/push.ts 組的），這裡只負責顯示、
  點了就開到那個路徑。同一則通知的 tag 相同，重送不會疊兩個。
*/
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* 不是我們送的格式就顯示通用標題 */ }
  const path = typeof data.path === "string" && data.path.startsWith("/") ? data.path : "/me/community";
  event.waitUntil(
    self.registration.showNotification(data.title || "HearthRoom", {
      body: data.body || "",
      tag: data.tag || path,
      data: { path },
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.path) || "/me/community";
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => "focus" in c);
      if (open) return open.navigate(url).then((c) => c && c.focus()).catch(() => open.focus());
      return self.clients.openWindow(url);
    }),
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
