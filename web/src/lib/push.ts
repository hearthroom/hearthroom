import { communityRequest } from "./community";

/**
 * 瀏覽器推播的訂閱。
 *
 * 流程：站台給公鑰 → 瀏覽器問使用者要不要收 → 瀏覽器產生一組訂閱 → 交給站台綁在這個帳號上。
 * 訂閱是「這個瀏覽器」的：同一人換瀏覽器要再開一次，同一瀏覽器換人登入會把訂閱帶給新帳號。
 * 關掉就把瀏覽器端與站台端的訂閱都拿掉。狀態判斷全部以瀏覽器為準，站台只回答「這個訂閱綁在你身上嗎」。
 */
export type PushState = "unsupported" | "blocked" | "off" | "on";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try { return await navigator.serviceWorker.ready; } catch { return null; }
}

function keyBytes(base64url: string): Uint8Array {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

/** Where this browser stands, checked against the server for the signed-in member. */
export async function pushState(token: string): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return "off";
  try {
    const r = await communityRequest<{ subscribed: boolean }>("/me/push/subscription?endpoint=" + encodeURIComponent(sub.endpoint), token);
    return r.subscribed ? "on" : "off";
  } catch { return "off"; }
}

/** Ask the browser, subscribe, and hand the subscription to the website. Returns the resulting state. */
export async function enablePush(token: string, locale: string): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const config = await communityRequest<{ enabled: boolean; publicKey: string | null }>("/push/config");
  if (!config.enabled || !config.publicKey) return "unsupported";
  if ((await Notification.requestPermission()) !== "granted") return "blocked";
  const reg = await registration();
  if (!reg) return "unsupported";
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.publicKey) as BufferSource }));
  const json = sub.toJSON();
  await communityRequest("/me/push/subscription", token, "PUT", { endpoint: sub.endpoint, keys: json.keys, locale });
  return "on";
}

/** Drop the subscription on both sides; the browser side first so a server error cannot leave a dangling target. */
export async function disablePush(token: string): Promise<PushState> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return "off";
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  await communityRequest("/me/push/subscription", token, "DELETE", { endpoint }).catch(() => undefined);
  return "off";
}
