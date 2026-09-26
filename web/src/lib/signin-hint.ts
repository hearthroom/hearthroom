/**
 * 這個瀏覽器上次確認登入的是哪個帳號（只記公開的數字 ID）。
 *
 * 只拿來決定「要不要先開頁、身分在背景確認」：真正的權限永遠以伺服器為準，
 * 確認不是登入狀態就送去登入頁（router.ts 的 optimisticAuth）。存不了就當沒有，照舊先等身分。
 */
const KEY = "hearthroom.signedIn";

export function signedInHint(): number | null {
  try {
    const value = Number(localStorage.getItem(KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function rememberSignedIn(accountNumId: number | null): void {
  try {
    if (accountNumId) localStorage.setItem(KEY, String(accountNumId));
    else localStorage.removeItem(KEY);
  } catch {
    /* 存不了就每次等身分 */
  }
}
