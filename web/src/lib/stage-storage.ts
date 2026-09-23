import { deleteAuthorRuleStore } from 'stage-author-rules/store';
import type { ProviderId } from './provider';

/**
 * 舞台存在瀏覽器裡、跟帳號有關的資料：作者規則的定稿快取（IndexedDB，內容是聊天原文與套完的 HTML）。
 *
 * - 範圍：舞台只在拿到帳號範圍時才存，鍵與資料都綁在這個範圍上；換帳號就不命中、而且會先清掉。
 *   範圍是 SHA-256(供應商, 帳號) 的十六進位，不是帳號 ID 本身。
 * - 登出：刪掉本站 origin 上的資料庫；舞台已經載入時，也讓它關掉連線、叫開著的沙箱卡清掉各自子網域上的那份
 *   （沙箱卡在別的 origin，本站刪不到；下次載入時殼也會比對範圍再清）。
 */

/** 帳號範圍；沒登入或環境沒有 WebCrypto（非安全來源）就回 null，舞台只用記憶體。 */
export async function stageStorageScope(provider: ProviderId, player: { accountNumId: number } | null | undefined): Promise<string | null> {
  if (!player || player.accountNumId === undefined || player.accountNumId === null) return null;
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const bytes = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(`hearthroom-stage-storage\u0000${provider}\u0000${player.accountNumId}`)));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

const hooks = new Set<() => unknown>();

/** 舞台裝好後登記自己的清除（關連線、通知沙箱卡）；回傳取消登記。 */
export function onStageSignOut(fn: () => unknown): () => void {
  hooks.add(fn);
  return () => { hooks.delete(fn); };
}

/** 登出時呼叫：刪掉舞台的快取。最多等 timeoutMs 就放行（登出與重新載入不因儲存卡住），從不丟錯。 */
export async function clearStageStorage(timeoutMs = 2000): Promise<void> {
  const work = Promise.allSettled([
    ...Array.from(hooks, (fn) => Promise.resolve().then(fn)),
    deleteAuthorRuleStore({ timeoutMs }),
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
  clearTimeout(timer);
}
