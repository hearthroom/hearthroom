import { communityRequest } from "./community";

/**
 * 瀏覽器推播的訂閱。
 *
 * 流程：站台給公鑰 → 瀏覽器問使用者要不要收 → 瀏覽器產生一組訂閱 → 交給站台綁在這個帳號上。
 * 訂閱是「這個瀏覽器」的：同一人換瀏覽器要再開一次，同一瀏覽器換人登入會把訂閱帶給新帳號。
 * 關掉就把瀏覽器端與站台端的訂閱都拿掉。狀態判斷全部以瀏覽器為準，站台只回答「這個訂閱綁在你身上嗎」。
 *
 * 詢問一定要是按下開關後的第一件事：Chrome 只在使用者剛點過的那幾秒內才肯彈出詢問，中間先去
 * 拿 token、拿公鑰就可能被當成不是使用者觸發，直接回「不允許」而且不顯示任何東西。所以公鑰
 * 在進頁面時先抓好，token 在詢問之後才拿。
 */
export type PushState = "unsupported" | "blocked" | "dismissed" | "off" | "on";
export interface PushConfig { enabled: boolean; publicKey: string | null }

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** The site's service worker, or null when none is registered yet. `ready` would hang forever in that case. */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try { return (await navigator.serviceWorker.getRegistration("/")) ?? null; } catch { return null; }
}

function keyBytes(base64url: string): Uint8Array {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

/** Whether the site offers push at all; fetch it before the member clicks so the click can prompt at once. */
export async function pushConfig(): Promise<PushConfig> {
  try { return await communityRequest<PushConfig>("/push/config"); } catch { return { enabled: false, publicKey: null }; }
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

/**
 * Prompt first, then subscribe and hand the subscription to the website. `getToken` runs only after the
 * browser answered, so the prompt stays inside the click. Returns the resulting state: "dismissed" means
 * the browser showed nothing or the member closed the prompt without choosing; "blocked" means it said no.
 */
export async function enablePush(getToken: () => Promise<string>, locale: string, config: PushConfig): Promise<PushState> {
  if (!pushSupported() || !config.enabled || !config.publicKey) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "dismissed";
  const reg = await registration();
  if (!reg) return "unsupported";
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.publicKey) as BufferSource }));
  const json = sub.toJSON();
  await communityRequest("/me/push/subscription", await getToken(), "PUT", { endpoint: sub.endpoint, keys: json.keys, locale });
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
