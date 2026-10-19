/**
 * 簽到與開箱舞台的蘇綺插圖。美術方向見任務 2026-10-19-checkin-hearthroom-experience 的 art.md §7。
 *
 * 白天的捧箱、懊惱、歡呼是美工的正式圖（美術總監簽核）；開心抱金幣沿用活動頁的 pose-got-points。
 * 寢物語（22:00–06:00）那一組還在量產，到位前先用白天的圖：換圖只要改這張表。
 */
import { isNight } from "./mascot-home";

export type CheckinPose = "carry" | "miss" | "cheer" | "coins" | "wave";

const DAY: Record<CheckinPose, string> = {
  carry: "/mascot/checkin/pose-carry-day.webp",
  miss: "/mascot/checkin/pose-miss-day.webp",
  cheer: "/mascot/checkin/pose-cheer-day.webp",
  coins: "/mascot/campaign/pose-got-points.webp",
  wave: "/mascot/home/pose-wave.webp",
};
const NIGHT: Record<CheckinPose, string> = { ...DAY, wave: "/mascot/home/pose-bedtime.webp" };

export const poseUrl = (pose: CheckinPose, now = new Date()): string => (isNight(now) ? NIGHT : DAY)[pose];

/** 舞台打開前先把會用到的姿勢載好，不能在滾輪中途才冒出蘇綺。 */
export function preloadPoses(now = new Date()): Promise<void> {
  const urls = (["carry", "miss", "cheer", "coins"] as const).map((p) => poseUrl(p, now));
  return Promise.all(urls.map((src) => new Promise<void>((done) => {
    const img = new Image();
    img.onload = img.onerror = () => done();
    img.src = src;
    img.decode?.().then(() => done(), () => done());
  }))).then(() => undefined);
}
