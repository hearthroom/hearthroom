/**
 * 新手七日在首頁的兩個入口怎麼分工（ui.md §15.1–§15.3）：
 *   - 每天第一次進首頁，桌寵彈出提示卡；提示卡出現時，頂端的常駐卡先不顯示（同屏只有一顆「帶我去」）
 *   - 「晚點再說」之後當天不再彈，常駐卡才出現
 *   - 今天彈過了沒、按了晚點再說沒有，記在帳號上（換裝置不重複彈），本機只記「這次造訪彈過了」
 */
import { reactive } from "vue";
import { communityRequest } from "./community";

export const newcomerPrompt = reactive({ showing: false, loaded: false, shown: false, later: false, thisVisit: false });

type PromptState = { day: string; shown: boolean; later: boolean };

export async function loadPrompt(token: string): Promise<void> {
  try {
    const s = await communityRequest<PromptState>("/me/checkin/prompt", token);
    Object.assign(newcomerPrompt, { shown: s.shown, later: s.later, loaded: true });
  } catch {
    // 讀不到就當今天彈過了：寧可少彈一次，不要每次進首頁都彈
    Object.assign(newcomerPrompt, { shown: true, loaded: true });
  }
}

export async function markPrompt(token: string, kind: "shown" | "later"): Promise<void> {
  if (kind === "shown") { newcomerPrompt.shown = true; newcomerPrompt.thisVisit = true; }
  else newcomerPrompt.later = true;
  try { await communityRequest<PromptState>("/me/checkin/prompt", token, "POST", { kind }); } catch { /* 下次進首頁再算 */ }
}
