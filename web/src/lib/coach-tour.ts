/**
 * 新手引導的步驟（owner 2026-10-10，照魅魔島：一頁一頁框出要點的地方，「下一步」自動跳頁）。
 *
 *   首頁    r18（這組有成人版、頁首有 R18 鈕、還沒開）→ card（置頂的入門卡）
 *   卡片頁  intro（簡介與開場白）→ play（「開始對話」鈕）
 *   對話頁  一般卡：opening（開場）→ prologue（開場選項；卡沒有就略過）
 *           同層卡（整頁在沙箱裡，框不到裡面）：stage 一步，提示貼底
 *
 * 換頁時步驟存在這個分頁的 sessionStorage，跳頁之後接著走。看過與否記在 onboarding.ts。
 */
import { reactive } from "vue";

export type TourStep = "r18" | "card" | "intro" | "play" | "opening" | "prologue" | "stage";
export type TourPage = "home" | "card" | "play";

export const PAGE_OF: Record<TourStep, TourPage> = {
  r18: "home", card: "home", intro: "card", play: "card", opening: "play", prologue: "play", stage: "play",
};

/** 每一步框的元件；null 是框不到（同層卡），提示貼底。對話頁的兩個是舞台公開給作者的 data-lt 標記。 */
export const TARGET_OF: Record<TourStep, string | null> = {
  r18: "button.r18",
  card: '[data-tour="starter"]',
  intro: '[data-tour="card-intro"]',
  play: '[data-tour="card-play"]',
  opening: '[data-lt="message"]',
  prologue: '[data-lt="prologue"]',
  stage: null,
};

export interface TourShape {
  /** 首頁要不要先指 R18 */
  adult: boolean;
  /** 對話頁是同層卡嗎；還不知道（舞台還沒掛好）是 null */
  sandbox: boolean | null;
  /** 一般卡有沒有開場選項 */
  prologue: boolean;
}

export function stepsOf(shape: TourShape): TourStep[] {
  const head: TourStep[] = [...(shape.adult ? (["r18"] as const) : []), "card", "intro", "play"];
  if (shape.sandbox === null) return [...head, "opening"];
  if (shape.sandbox) return [...head, "stage"];
  return [...head, "opening", ...(shape.prologue ? (["prologue"] as const) : [])];
}

/** 下一步；已經是最後一步回 null（完成）。 */
export function nextStep(step: TourStep, shape: TourShape): TourStep | null {
  const steps = stepsOf(shape);
  const i = steps.indexOf(step);
  return i >= 0 && i < steps.length - 1 ? steps[i + 1] : null;
}

/** 上一步；第一步回 null。 */
export function prevStep(step: TourStep, shape: TourShape): TourStep | null {
  const steps = stepsOf(shape);
  const i = steps.indexOf(step);
  return i > 0 ? steps[i - 1] : null;
}

export function isFirst(step: TourStep, shape: TourShape): boolean { return stepsOf(shape)[0] === step; }
export function isLast(step: TourStep, shape: TourShape): boolean { return nextStep(step, shape) === null && shape.sandbox !== null; }

/** 換頁時接著走用的狀態。 */
export interface TourProgress { step: TourStep; card: number; adult: boolean }
const KEY = "hr-tour-progress";
export function saveProgress(p: TourProgress | null): void {
  try { p ? sessionStorage.setItem(KEY, JSON.stringify(p)) : sessionStorage.removeItem(KEY); } catch { /* 存不了：換頁後引導就停在這裡 */ }
}
export function loadProgress(): TourProgress | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(KEY) || "null") as TourProgress | null;
    return p && p.step in PAGE_OF && Number.isInteger(p.card) ? p : null;
  } catch { return null; }
}

/** 引導現在走到哪、帶的是哪張入門卡。首頁看到 r18／card 這兩步就把入門卡置頂畫出來。 */
export const tourState = reactive({ step: null as TourStep | null, card: 0 });
