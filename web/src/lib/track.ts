/**
 * 前端的事件回报。
 *
 * 只补服务端看不到的那几件事：外链 CTA 点击、分享走了哪条路、登入流程、前端错误。
 * **页面浏览不走这里**——看榜单就会打 /v1/cards、看卡片就会打 /v1/cards/:id，那才是行为信号；
 * 「有多少人来」交给 Cloudflare Web Analytics，两边不重复建设。
 *
 * 三条不能破的约束：
 * - 不阻塞。track() 只往数组里 push，序列化与送出推到空闲时段；送出用 sendBeacon，浏览器原生非阻塞。
 * - 不追踪个人。没有 cookie、没有持久 ID、不送 URL 原文（搜寻词在 query 里）。
 * - 尊重拒绝。DNT 或 GPC 打开就整个关掉。
 */

const ENDPOINT = "/v1/e";
/** 一次请求最多送几条。服务端也有同样的上限，两边对齐。 */
const BATCH = 20;

const nav = typeof navigator === "undefined" ? undefined : navigator;
/** 使用者明说不要被追踪就不发。这是一次性判断——偏好不会在一次浏览里改变。 */
const optedOut =
  !nav ||
  typeof nav.sendBeacon !== "function" ||
  nav.doNotTrack === "1" ||
  (nav as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

/**
 * 目前在哪一页。SPA 的同源 fetch 带的 Referer 是当前页自己，服务端问不出「从哪来」，
 * 所以每个 API 请求显式带一个 X-From；这个值由 router 在换页时设。
 */
let surface = "direct";
export const setSurface = (s: string) => { surface = s; };
export const currentSurface = () => surface;

interface Event { event: string; detail?: string; subject?: string; ok?: boolean }

const queue: (Event & { from: string; locale: string })[] = [];
let scheduled = false;

function flush(): void {
  if (!queue.length) return;
  const batch = queue.splice(0, BATCH);
  try {
    nav!.sendBeacon(ENDPOINT, new Blob([JSON.stringify(batch)], { type: "application/json" }));
  } catch {
    // 送不出去就算了：埋点丢一条，不影响任何使用者能看到的东西
  }
}

/** 空闲时才做事。iOS Safari 没有 requestIdleCallback，退回 setTimeout。 */
const idle: (cb: () => void) => void =
  typeof requestIdleCallback === "function" ? (cb) => requestIdleCallback(cb, { timeout: 2000 }) : (cb) => { setTimeout(cb, 300); };

export function track(event: string, data: Omit<Event, "event"> = {}): void {
  if (optedOut) return;
  queue.push({ event, ...data, from: surface, locale: document.documentElement.lang || "" });
  if (scheduled) return;
  scheduled = true;
  idle(() => { scheduled = false; flush(); });
}

/**
 * 页面要走了就把手上的送出去。
 * 用 visibilitychange 而不是 unload：切到背景、锁萤幕、关分页都会触发，而 unload 在 iOS 上经常不发。
 */
export function startTracking(): void {
  if (optedOut) return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  // 没被 catch 的错误：只记类型，不记讯息（讯息里可能有使用者输入或网址）
  window.addEventListener("error", (e) => {
    track("error", { detail: "js_error", subject: (e.error as Error | undefined)?.name?.slice(0, 40) ?? "", ok: false });
  });
  window.addEventListener("unhandledrejection", () => {
    track("error", { detail: "unhandled_rejection", ok: false });
  });
}
