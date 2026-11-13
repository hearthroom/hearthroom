/**
 * 一張卡的「已加入的擴充」：清單（順序與啟用）＋字數與建議檔位。
 *
 * 卡片頁的身分列、工坊分頁、管理視窗、擴充詳情頁都看同一份，所以照 roleId 存在模組裡共用：
 * 在詳情頁按了加入，回到卡片頁不必重讀就看得到「已啟用 N 個」。
 *
 * 寫入都是「伺服器回什麼就畫什麼」：加入、移除、排序、開關送出後，用回應整份換掉手上的清單，
 * 再重讀一次字數摘要（建議檔位只有伺服器算得出來）。清單版本對不上（別的分頁剛改過）就重讀後再做一次。
 */
import { reactive } from "vue";
import { ApiError } from "./api";
import {
  fetchSelection, fetchUsageSummary, installWorkshop, moveItem, saveContextTier, saveSelection, uninstallWorkshop,
  type Selection, type SelectionItem, type UsageSummary,
} from "./workshop";

export interface CardWorkshopState {
  roleId: string;
  selection: Selection | null;
  usage: UsageSummary | null;
  status: "idle" | "loading" | "ready" | "failed";
  /** 寫入中：開關與排序鍵停用，避免連點把兩次修改疊在舊版本上 */
  busy: boolean;
}

const states = new Map<string, CardWorkshopState>();
export function cardWorkshop(roleId: string): CardWorkshopState {
  let s = states.get(roleId);
  if (!s) { s = reactive<CardWorkshopState>({ roleId, selection: null, usage: null, status: "idle", busy: false }); states.set(roleId, s); }
  return s;
}
/** 登出或換帳號時清掉（清單是個人的） */
export function forgetCardWorkshops(): void { states.clear(); }

/** 已加入且啟用、還能用的件數（「開始對話會套用 N 個擴充」） */
export function activeCount(s: CardWorkshopState): number {
  return s.selection?.items.filter((i) => i.enabled && i.availability !== "removed").length ?? 0;
}
export function isJoined(s: CardWorkshopState, workshopId: string): boolean {
  return !!s.selection?.items.some((i) => i.workshopId === workshopId);
}

async function refreshUsage(s: CardWorkshopState, token: string): Promise<void> {
  try { s.usage = await fetchUsageSummary(s.roleId, token); } catch { /* 字數摘要讀不到只是少一行，不擋清單 */ }
}

export async function loadCardWorkshop(s: CardWorkshopState, token: string): Promise<void> {
  s.status = "loading";
  try {
    const [selection] = await Promise.all([fetchSelection(s.roleId, token), refreshUsage(s, token)]);
    s.selection = selection;
    s.status = "ready";
  } catch {
    s.status = "failed";
  }
}

async function write(s: CardWorkshopState, token: string, run: () => Promise<Selection>): Promise<void> {
  s.busy = true;
  try {
    s.selection = await run();
    await refreshUsage(s, token);
  } finally {
    s.busy = false;
  }
}

export function joinExtension(s: CardWorkshopState, workshopId: string, token: string): Promise<void> {
  return write(s, token, () => installWorkshop(s.roleId, workshopId, token));
}
export function leaveExtension(s: CardWorkshopState, workshopId: string, token: string): Promise<void> {
  return write(s, token, () => uninstallWorkshop(s.roleId, workshopId, token));
}

/** 換掉清單（排序、開關）：版本對不上就重讀一次，照同樣的意圖再送一次 */
async function saveItems(s: CardWorkshopState, token: string, change: (items: SelectionItem[]) => SelectionItem[]): Promise<void> {
  if (!s.selection) return;
  await write(s, token, async () => {
    try {
      return await saveSelection(s.roleId, { ...s.selection!, items: change(s.selection!.items) }, token);
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== "selection_stale") throw err;
      const fresh = await fetchSelection(s.roleId, token);
      return saveSelection(s.roleId, { ...fresh, items: change(fresh.items) }, token);
    }
  });
}
export function setEnabled(s: CardWorkshopState, workshopId: string, enabled: boolean, token: string): Promise<void> {
  return saveItems(s, token, (items) => items.map((i) => (i.workshopId === workshopId ? { ...i, enabled } : i)));
}
export function moveExtension(s: CardWorkshopState, workshopId: string, delta: -1 | 1, token: string): Promise<void> {
  return saveItems(s, token, (items) => moveItem(items, items.findIndex((i) => i.workshopId === workshopId), delta));
}

/** 切到建議檔位：先存這張卡的遊玩設定，存好才重讀字數摘要；存不了就照舊，由呼叫端說明 */
export async function switchToRecommended(s: CardWorkshopState, token: string): Promise<boolean> {
  const tier = s.usage?.recommendedContextTier;
  if (!tier) return false;
  s.busy = true;
  try {
    await saveContextTier(s.roleId, tier, token);
    await refreshUsage(s, token);
    return true;
  } finally {
    s.busy = false;
  }
}
