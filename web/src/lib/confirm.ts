import { reactive } from "vue";

/**
 * 站台自己的確認彈窗。
 *
 * 瀏覽器原生的 confirm／prompt 長得跟站台無關——不跟深淺色、不跟主題、不跟字體，
 * 一跳出來就是另一個世界。所以全站不用它們；要問使用者「確定嗎」，一律走這裡。
 * （關分頁前的 beforeunload 是瀏覽器強制的原生框，換不掉，那一個例外。）
 *
 * 用法跟 window.confirm 一樣簡單：`if (!(await confirmDialog({ message }))) return;`
 * 畫面由 components/ConfirmDialog.vue 負責，掛在 App.vue，一次只會有一個。
 */
export interface ConfirmOptions {
  title?: string;
  message: string;
  /** 一段要讓人複製的文字（例如網址），畫成可全選的方塊 */
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  /** 破壞性動作：確認鍵用警示色，焦點先落在取消鍵 */
  danger?: boolean;
  /** 只有一顆「知道了」，沒有取消 */
  single?: boolean;
  /**
   * 要使用者照著打一遍才能按確認的字（例如角色名稱）。給「刪掉就回不來」的動作用：
   * 多一道手工，按錯的機率就小得多。比對前後空白忽略，其餘要一字不差。
   */
  requireText?: string;
  /** 打字框的提示；沒給就用 requireText 本身 */
  placeholder?: string;
}

interface Pending extends ConfirmOptions { resolve: (ok: boolean) => void }

export const confirmState = reactive<{ current: Pending | null }>({ current: null });

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  // 前一個還沒回答就來了新的：舊的當取消，不讓兩個疊在一起
  confirmState.current?.resolve(false);
  return new Promise((resolve) => { confirmState.current = { ...opts, resolve }; });
}

/** 要求照打的字有沒有打對。 */
export function confirmTextMatches(opts: Pick<ConfirmOptions, "requireText">, typed: string): boolean {
  if (!opts.requireText) return true;
  return typed.trim() === opts.requireText.trim();
}

/**
 * 由彈窗元件呼叫：把答案交回去並關掉。
 * 有 requireText 的彈窗，確認時要帶使用者打的字；沒打對就當沒按——彈窗留著。
 */
export function settleConfirm(ok: boolean, typed = ""): void {
  const c = confirmState.current;
  if (!c) return;
  if (ok && !confirmTextMatches(c, typed)) return;
  confirmState.current = null;
  c.resolve(ok);
}
