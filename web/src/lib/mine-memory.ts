import type { MyCard, MyCardPage } from "./api";
import type { ProviderId } from "./provider";

/**
 * 「我的卡片」上次畫出來的那份，以帳號、供應商、搜尋、篩選與頁碼為鍵。
 * 回到這一頁、或重新整理時先畫它，背景照常帶 fresh 重讀（作者剛改過卡時要看到新的）。
 *
 * 記在這個分頁的記憶體，同時寫進 sessionStorage：重新整理還在，關掉分頁就沒了；登出時清掉（session.ts）。
 * 只留最近幾頁，免得作者翻了幾十頁把儲存撐滿。存不了就只放記憶體。
 */
export interface MineShown {
  rows: Partial<Record<ProviderId, MyCard[]>>;
  totals: Partial<Record<ProviderId, number>>;
  quota: MyCardPage["quota"] | null;
}

const STORAGE_KEY = "hearthroom.mine.shown";
const KEEP = 10;

class ShownMemory {
  private pages: Map<string, MineShown> | null = null;

  private load(): Map<string, MineShown> {
    if (this.pages) return this.pages;
    this.pages = new Map();
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) for (const [key, value] of JSON.parse(raw) as [string, MineShown][]) this.pages.set(key, value);
    } catch {
      /* 讀不到就從空的開始 */
    }
    return this.pages;
  }

  private persist(): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...this.load()]));
    } catch {
      /* 存不了就只放記憶體 */
    }
  }

  get(key: string): MineShown | undefined {
    return this.load().get(key);
  }

  set(key: string, value: MineShown): void {
    const pages = this.load();
    pages.delete(key);
    pages.set(key, value);
    while (pages.size > KEEP) pages.delete(pages.keys().next().value!);
    this.persist();
  }

  clear(): void {
    this.pages = new Map();
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 本來就沒存 */
    }
  }
}

export const lastShown = new ShownMemory();
