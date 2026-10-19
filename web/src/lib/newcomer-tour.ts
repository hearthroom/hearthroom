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
export interface NewcomerStep { id: string; page: NewcomerPage; target: string | null }

export const NEWCOMER_TOUR: Record<number, NewcomerStep[]> = {
  1: [{ id: "1.board", page: "home", target: ".sorts" }, { id: "1.tags", page: "home", target: "nav.discovery-tags" }],
  2: [{ id: "2.resume", page: "home", target: '[data-tour="home-resume"]' }],
  3: [{ id: "3.roll", page: "home", target: '[data-tour="home-roll"]' }, { id: "3.tags", page: "home", target: "nav.discovery-tags" }],
  4: [{ id: "4.score", page: "card", target: '[data-tour="card-score"]' }, { id: "4.comment", page: "card", target: '[data-tour="card-comments"]' }],
  5: [{ id: "5.background", page: "play", target: null }, { id: "5.length", page: "play", target: null }],
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
