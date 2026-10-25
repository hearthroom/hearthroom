/**
 * 卡內分享情境的宿主那一半（舞台的 StageHost.share）。
 *
 * 卡片腳本（sdk.share／stage.share）產生一條帶情境碼的分享連結，朋友從那條連結開卡時讀得到同一個碼。
 * 舞台不讀網址列、也不知道這張卡在本站的網址與玩家的推薦碼，全由這裡給：
 *   - 分享連結跟卡片頁的分享鈕同一個形狀：社群站的 /cards/<卡號>，登入者帶自己的推薦碼（CardPage.vue）。
 *   - 情境碼只在一般遊玩開機時給（PlayPage 決定；看紀錄、審核預覽不給），先驗格式。
 *   - 平台開關（Worker 的 SHARE_CONTEXT_ENABLED，經 /v1/cards/:id 的 shareContext）關著時情境碼一律不給，連結照給。
 * 設計：docs/studio/tasks/2026-10-25-card-share-context/design.md（monorepo docs）。
 */
import { withShareRef } from "./share-ref";

/** 跟舞台 common/share-context.ts 的 SHARE_CONTEXT_RE 同一條（web 測試會比對）。~ 開頭留給平台短碼。 */
export const SHARE_CONTEXT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const SHARE_QR_MAX_CHARS = 1024;

export type ShareAudience = "author" | "link" | "public";

export interface PlayShareInput {
  roleId: string;
  /** 社群站的卡號；拿不到就沒有分享連結。 */
  cardNumber: string;
  /** 這次開卡帶進來的情境碼（未驗過也可以，這裡驗）；不是一般遊玩開機給 null。 */
  context: string | null;
  audience: ShareAudience | null;
  /** 平台開關。 */
  enabled: boolean;
}

export interface PlayShareDeps {
  /** 社群站的主機名（卡片 App 網域上也要回主站）。 */
  communityHost(): string;
  lp(path: string): string;
}

export function shareContextOf(raw: unknown): string | null {
  return typeof raw === "string" && SHARE_CONTEXT_RE.test(raw) ? raw : null;
}

/**
 * 卡片頁到遊玩頁（開始玩、安裝成卡片 App）要把朋友的情境碼帶過去：不帶的話，連結落在卡片頁、
 * 按「開始玩」之後卡片就讀不到了。不合格式的不帶。相對路徑進、相對路徑出。
 */
export function withShareContext(target: string, raw: unknown): string {
  const context = shareContextOf(raw);
  if (!context) return target;
  const absolute = /^https?:\/\//.test(target);
  const u = new URL(target, "https://x.invalid");
  u.searchParams.set("share", context);
  return absolute ? u.href : `${u.pathname}${u.search}${u.hash}`;
}

let current: PlayShareInput | null = null;
let refCode: string | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* 單一訂閱者壞了不影響其他 */ } } };

/** PlayPage 解析完卡片後設；離開或換卡設 null。換卡時推薦碼清掉，等這一頁重新讀。 */
export function setPlayShare(input: PlayShareInput | null): void {
  if (!input || input.roleId !== current?.roleId) refCode = null;
  current = input;
  notify();
}

/** 推薦碼晚到（currentReferralCode 是非同步的）：補上後通知舞台，殼會發 share:change。 */
export function setPlayShareRef(roleId: string, code: string | null): void {
  if (!current || current.roleId !== roleId || refCode === code) return;
  refCode = code;
  notify();
}

/** 把一段字畫成 QR：跟分享面板（ShareMenu.vue）同一套 qrcode-generator 與 path 畫法。 */
export async function shareQr(text: string): Promise<{ size: number; path: string }> {
  const t = String(text ?? "");
  if (!t || t.length > SHARE_QR_MAX_CHARS) throw Object.assign(new Error("qr text out of range"), { code: "INVALID_ARGS" });
  const { default: make } = await import("qrcode-generator");
  const code = make(0, "M");
  code.addData(t);
  code.make();
  const n = code.getModuleCount();
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (code.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
  return { size: n, path };
}

/** 舞台的 StageHost.share。 */
export function playShareHost(deps: PlayShareDeps) {
  return {
    read(roleId: string) {
      const s = current;
      if (!s || s.roleId !== roleId) return null;
      const url = s.cardNumber ? withShareRef(`https://${deps.communityHost()}${deps.lp(`/cards/${s.cardNumber}`)}`, refCode) : "";
      return { enabled: s.enabled, context: s.enabled ? shareContextOf(s.context) : null, url, audience: s.audience };
    },
    onChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    qr: shareQr,
  };
}
