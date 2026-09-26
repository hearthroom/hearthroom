import type { MyCard, MyCardPage } from "./api";
import type { ProviderId } from "./provider";

/**
 * 「我的卡片」上次畫出來的那份，只放在這個分頁的記憶體裡、以帳號與供應商為鍵。
 * 回到這一頁時先畫它，背景照常帶 fresh 重讀（作者剛改過卡時要看到新的）。
 * 頁面上的提交、下架是就地改同一批物件，所以這份也跟著是最新的。
 */
export interface MineShown {
  rows: Partial<Record<ProviderId, MyCard[]>>;
  pages: Partial<Record<ProviderId, number>>;
  more: Partial<Record<ProviderId, boolean>>;
  quota: MyCardPage["quota"] | null;
}

export const lastShown = new Map<string, MineShown>();
