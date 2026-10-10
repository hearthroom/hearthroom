/**
 * 新手引導的狀態（owner 2026-10-10）：哪一組入門卡、這台裝置看過了沒、引導正指著頁首哪顆鍵。
 * 入門卡的設定見 shared/starter-cards.ts。
 */
import { ref } from "vue";
import { STARTER_CARDS, type StarterGroup } from "../../../shared/starter-cards";

export function starterGroup(locale: string): StarterGroup {
  if (locale.startsWith("zh")) return "zh";
  return (["en", "ja", "ko"] as const).find((g) => locale.startsWith(g)) ?? "zh";
}

/** 這個語言要帶去哪張入門卡：開了成人內容而且有成人版就是成人版，否則一般版；沒設就是 null。 */
export function starterFor(locale: string, adult: boolean): number | null {
  const entry = STARTER_CARDS[starterGroup(locale)];
  return (adult && entry.adult) || entry.general || null;
}

/** 這一組有沒有成人版（有才需要指出 R18 在哪）。 */
export function hasAdultStarter(locale: string): boolean {
  const entry = STARTER_CARDS[starterGroup(locale)];
  return !!entry.general && !!entry.adult;
}

/**
 * 每個新用戶都看一遍（owner 2026-10-10）：沒登入的訪客，或成為本站成員還不到這麼多天的人
 * （例如從邀請連結註冊完直接進來）。老成員不突然冒出引導。
 */
export const NEW_MEMBER_DAYS = 7;
export function isNewMember(memberSince: number | undefined, now = Date.now()): boolean {
  return typeof memberSince === "number" && now - memberSince < NEW_MEMBER_DAYS * 86_400_000;
}

const DONE_KEY = "hr-tour-done";
export function tourDone(): boolean {
  try { return localStorage.getItem(DONE_KEY) === "1"; } catch { return true; }
}
export function finishTour(): void {
  try { localStorage.setItem(DONE_KEY, "1"); } catch { /* 存不了的瀏覽器讀也讀不到，tourDone 已經當看過 */ }
}

/** 引導正指著的頁首鍵（頁首的元件看到就加上提示框）。 */
export const tourFocus = ref<"" | "r18">("");
