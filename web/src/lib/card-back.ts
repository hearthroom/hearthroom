/**
 * 卡片頁的返回鈕要退幾步。
 *
 * 從站內列表（榜單、搜尋、收藏、我的卡片…）點進卡片頁，返回要回到那一頁，用瀏覽器的上一頁，
 * 列表才會在原位、不重讀（scroll-restore.ts、board-memory.ts）。卡片頁自己切分頁、開管理會推歷史，
 * 那幾步一起退掉：返回鈕的意思是離開這張卡，不是回上一個分頁。
 *
 * 直接開連結、從別的網域或整頁跳轉進來的（vue-router 的 history.state.back 是空的），
 * 沒有站內的上一頁可退，回傳 null，由連結本身帶去首頁。
 *
 * 進卡那一筆要跟著卡片頁自己推的歷史走（push 時放進 state.cardEntry）：停在工坊分頁時
 * 重新整理、或從別頁按瀏覽器返回回到工坊分頁，頁面會重新掛載，這時現在這一筆的 back 是卡片頁自己，
 * 不能當成進卡的那一筆（code-review 2026-11-21）。vue-router 的 replace 會保留 state 裡的這個欄位。
 */
export type HistoryEntry = { position: number; back: string | null };

export function readEntry(state: unknown): HistoryEntry {
  const s = (state ?? {}) as { position?: unknown; back?: unknown };
  return { position: typeof s.position === "number" ? s.position : -1, back: typeof s.back === "string" ? s.back : null };
}

/** 進卡片頁那一筆（entry）與現在這一筆（now）：要退幾步，或 null（沒有站內上一頁）。 */
export function stepsBack(entry: HistoryEntry, now: HistoryEntry): number | null {
  if (!entry.back || entry.position < 0 || now.position < entry.position) return null;
  return now.position - entry.position + 1;
}

/** 這一筆歷史所屬的進卡那一筆：卡片頁自己推的歷史帶著它，否則就是這一筆本身。 */
export function entryOf(state: unknown): HistoryEntry {
  const carried = (state as { cardEntry?: unknown } | null)?.cardEntry;
  return carried && typeof carried === "object" ? readEntry(carried) : readEntry(state);
}
