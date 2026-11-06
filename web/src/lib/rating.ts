import { reactive } from "vue";
import {
  LOCALES, RATING_NAMES, RATING_TOPICS, evaluateRating,
  type Rating, type RatingAnswers, type RatingLocale, type RatingResult, type Topic,
} from "../../../shared/content-rating";

/**
 * 分級問卷彈窗的狀態與幾個顯示用的小工具。題目、選項與計分都在 shared/content-rating.ts，
 * 伺服器用同一份重算，這裡算出的結果只是給作者先看。
 */

interface Pending { initial: RatingAnswers | null; resolve: (answers: RatingAnswers | null) => void }
export const ratingState = reactive<{ current: Pending | null }>({ current: null });

/** 打開問卷：有上一份答案就先給作者看結果，確認回答案，取消回 null。 */
export function askRating(initial: RatingAnswers | null): Promise<RatingAnswers | null> {
  ratingState.current?.resolve(null);
  return new Promise((resolve) => {
    ratingState.current = { initial: usable(initial), resolve: (a) => { ratingState.current = null; resolve(a); } };
  });
}

/** 還能用的答案（現行版本、形狀正確）才拿來預填；不能用就當沒有。 */
export function usable(answers: RatingAnswers | null | undefined): RatingAnswers | null {
  if (!answers) return null;
  try { return evaluateRating(answers).answers; } catch { return null; }
}

export function rate(answers: RatingAnswers): RatingResult | null {
  try { return evaluateRating(answers); } catch { return null; }
}

export function ratingLocale(locale: string): RatingLocale {
  if ((LOCALES as readonly string[]).includes(locale)) return locale as RatingLocale;
  return locale.startsWith("zh") ? "zh-Hant" : "en";
}

export const ratingName = (r: Rating, locale: string) => RATING_NAMES[r][ratingLocale(locale)];

/** 情節名稱，照介面語言接成一串（中文用頓號）。 */
export function descriptorList(topics: readonly Topic[], locale: string): string {
  const l = ratingLocale(locale);
  const names = topics.map((id) => RATING_TOPICS.find((t) => t.id === id)?.title[l] ?? id);
  return names.join(l.startsWith("zh") || l === "ja" ? "、" : ", ");
}

/** 官方分級標識（gamerating.org.tw 下載專區的原檔裁切）。 */
export const markSrc = (r: Rating) => `/rating/gsrr-${r}.png`;

/**
 * 分級小標（RatingMark 的 chip）的顏色：底色取官方標識的底色（CMYK 換算），不改；
 * 字色選讀得清的那一個，每一級都要過 4.5:1（test/rating-chip-contrast.test.ts）。
 * 白字只有限制級的紅底過得了，其他用深字（2026-11-06 普遍級白字綠底只有 2.73:1，被 QA 退件）。
 */
export const RATING_CHIP_COLORS: Record<Rating, { bg: string; fg: string }> = {
  G: { bg: "#59b031", fg: "#17171c" },
  P: { bg: "#009fe3", fg: "#17171c" },
  PG12: { bg: "#f7c600", fg: "#3a2e00" },
  PG15: { bg: "#ec7a08", fg: "#17171c" },
  R: { bg: "#e5141e", fg: "#ffffff" },
};
