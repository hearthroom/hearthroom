/**
 * 網站 → 桌寵的事件。這個檔很小、不帶桌寵本體：各頁面 import 它丟事件，不會把桌寵的程式拉進首屏。
 * 桌寵沒載入（被關掉、在玩卡頁）時事件沒人接，就什麼都不發生。
 */
export type SukiEvent =
  | { type: "favorite" } | { type: "searchEmpty" } | { type: "searching" } | { type: "roll" }
  | { type: "notifications"; count: number } | { type: "update" } | { type: "theme"; dark: boolean }
  | { type: "adult"; on: boolean } | { type: "locale"; lang: string } | { type: "listEnd" } | { type: "say"; text: string }
  /** 新通知：照情緒演（過審慶祝、退件安慰、一般消息），泡泡附「看看」 */
  | { type: "notice"; text: string; mood: "party" | "comfort" | "news"; action?: { label: string; run: () => void } }
  /** 每天最多說一次的提醒（審核佇列、方案到期…），key 區分是哪一件 */
  | { type: "daily"; key: string; text: string; action?: { label: string; run: () => void } }
  /** 開箱舞台開關：舞台上已經有蘇綺，桌寵先退場，一個畫面只有一個她（art.md §1） */
  | { type: "stage"; on: boolean }
  /** 舞台關掉後依結果做一次表情：大獎開心、差一點嘟嘴、其餘開心 */
  | { type: "cheer"; mood: "win" | "miss" | "ok" }
  /** 頁面自己的提醒（我的卡片的額度、寫卡缺的欄位…），同一句這次造訪只說一次 */
  | { type: "hint"; text: string; action?: { label: string; run: () => void } };

/** 告訴她發生了什麼：`suki({ type: "favorite" })` */
export function suki(e: SukiEvent): void {
  dispatchEvent(new CustomEvent("suki", { detail: e }));
}
