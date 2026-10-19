/**
 * 新手七日每天的引導（ui.md §15.4、copy.md §7.4）：按「帶我去」才開，每天一段 2–3 步，框住真的介面。
 * 目標是否完成看真實行為，不是看引導走完；隨時可以關掉，不扣任何東西。
 *
 * 每一步記它在哪一頁、框哪個元素。不在那一頁就先帶過去；那一頁框不到（例如遊玩畫布裡的設定），
 * 泡泡貼在頁首底下照樣講。
 */
import { reactive } from "vue";
import type { Router } from "vue-router";

export type NewcomerPage = "home" | "card" | "play" | "wallet" | "any";
/** clear：泡泡放在目標下方時要讓開的東西（例如卡片頁按鈕正下方的分級那一行），泡泡改從它底下開始 */
export interface NewcomerStep { id: string; page: NewcomerPage; target: string | null; clear?: string }

export const NEWCOMER_TOUR: Record<number, NewcomerStep[]> = {
  // 第 1 天要聊滿回合：最後一步帶到卡片頁框「開始聊」（PM 2026-10-19）
  1: [{ id: "1.board", page: "home", target: ".sorts" }, { id: "1.tags", page: "home", target: "nav.discovery-tags" }, { id: "1.play", page: "card", target: '[data-tour="card-play"]', clear: '[data-tour="card-grade"]' }],
  2: [{ id: "2.resume", page: "home", target: '[data-tour="home-resume"]' }],
  3: [{ id: "3.roll", page: "home", target: '[data-tour="home-roll"]' }, { id: "3.tags", page: "home", target: "nav.discovery-tags" }],
  4: [{ id: "4.score", page: "card", target: '[data-tour="card-score"]' }, { id: "4.comment", page: "card", target: '[data-tour="card-comments"]' }],
  // 遊玩畫布不認識導覽，第一期不框：一句話講兩個設定的名稱與位置（ui.md §15.8）
  5: [{ id: "5.canvas", page: "play", target: null }],
  6: [{ id: "6.share", page: "card", target: '[data-tour="card-share"]' }],
  7: [{ id: "7.balance", page: "any", target: ".acct__credits" }, { id: "7.temp", page: "wallet", target: '[data-tour="wallet-balance"]' }, { id: "7.records", page: "wallet", target: '[data-tour="wallet-records"]' }],
};

export const newcomerTour = reactive({ day: 0, index: 0 });

export const currentStep = (): NewcomerStep | null => NEWCOMER_TOUR[newcomerTour.day]?.[newcomerTour.index] ?? null;

/** 這一頁是哪一種：首頁、卡片頁、遊玩畫布、錢包。語言前綴與結尾斜線不影響。 */
export function pageOf(path: string): NewcomerPage | null {
  const p = path.replace(/\/+$/, "").replace(/^\/(zh-Hans|en|ja|ko)(?=\/|$)/, "") || "/";
  if (p === "/") return "home";
  if (/^\/cards\/[^/]+$/.test(p)) return "card";
  if (/^\/play\/[^/]+$/.test(p)) return "play";
  if (p === "/wallet") return "wallet";
  return null;
}

/**
 * 框不到真的元素時怎麼講（ui.md §15.8）。card：還沒到卡片頁，泡泡說東西在卡片頁、按鈕帶到榜單第一張卡，
 * 到了才開始框；canvas：遊玩畫布裡的設定，只講名稱與位置，按「知道了」收起。null：照常框。
 */
export function awayMode(step: NewcomerStep, here: NewcomerPage | null): "card" | "canvas" | null {
  if (step.page === "play") return "canvas";
  if (step.page === "card" && here !== "card") return "card";
  return null;
}

/** 這一步該在哪裡；回 null 表示就在這一頁講（框不到就貼頁首）。卡片頁與遊玩畫布不知道是哪一張，就留在原處。 */
export function routeFor(step: NewcomerStep, here: NewcomerPage | null): string | null {
  if (step.page === "any" || step.page === here) return null;
  if (step.page === "home") return "/";
  if (step.page === "wallet") return "/wallet";
  return null;
}

export function startNewcomerTour(day: number, router: Router, localePath: (p: string) => string = (p) => p): void {
  if (!NEWCOMER_TOUR[day]) return;
  newcomerTour.day = day;
  newcomerTour.index = 0;
  const to = routeFor(NEWCOMER_TOUR[day][0], pageOf(router.currentRoute.value.path));
  if (to) void router.push(localePath(to));
}

export function stopNewcomerTour(): void { newcomerTour.day = 0; newcomerTour.index = 0; }
