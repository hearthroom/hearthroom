/**
 * 網站 → 桌寵的事件。這個檔很小、不帶桌寵本體：各頁面 import 它丟事件，不會把桌寵的程式拉進首屏。
 * 桌寵沒載入（被關掉、在玩卡頁）時事件沒人接，就什麼都不發生。
 */
import { ref } from "vue";

/** 她正在說話（泡泡在畫面上）：其他浮層（安裝提示）先等她說完 */
export const petSpeaking = ref(false);

export type SukiEvent =
  | { type: "favorite" } | { type: "searchEmpty" } | { type: "searching" } | { type: "roll" }
  | { type: "notifications"; count: number } | { type: "update" } | { type: "theme"; dark: boolean }
  | { type: "adult"; on: boolean } | { type: "locale"; lang: string } | { type: "listEnd" } | { type: "say"; text: string }
  /** 新通知：照情緒演（過審慶祝、退件安慰、一般消息），泡泡附「看看」 */
  | { type: "notice"; text: string; mood: "party" | "comfort" | "news"; action?: { label: string; run: () => void } }
  /** 每天最多說一次的提醒（審核佇列、方案到期…），key 區分是哪一件 */
  | { type: "daily"; key: string; text: string; action?: { label: string; run: () => void } }
  /** 這一頁自己畫了蘇綺（簽到頁的插圖與開箱舞台）：桌寵退場，一個畫面只有一個她（art.md §1） */
  | { type: "away"; on: boolean }
  /** 做一次表情（新手提示按「晚點再說」時點頭）：win 開心跳一下、miss 嘟嘴、ok 開心 */
  | { type: "cheer"; mood: "win" | "miss" | "ok" }
  /** 頁面自己的提醒（我的卡片的額度、寫卡缺的欄位…），同一句這次造訪只說一次 */
  | { type: "hint"; text: string; action?: { label: string; run: () => void } }
  /** 設定頁「叫她出來」：回到預設位置、拉出來打招呼 */
  | { type: "summon" };

/** 告訴她發生了什麼：`suki({ type: "favorite" })` */
export function suki(e: SukiEvent): void {
  dispatchEvent(new CustomEvent("suki", { detail: e }));
}
