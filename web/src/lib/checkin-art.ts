/**
 * 簽到與開箱舞台的蘇綺插圖與寶箱（art.md §6、§7；美術總監簽核，技術美術的素材管線輸出）。
 *
 * 捧箱是「乾淨底圖」（箱子那塊改畫成衣服）＋三層寶箱（箱身、箱內、蓋，與白天姿勢同一張畫布）＋手指層。
 * 寶箱分層只畫了白天那一組；夜版捧箱的箱子較矮、較窄、偏右，整疊用不等比縮放加平移貼上
 * （外框數字是技術美術在姿勢畫布上量的，proto/assets/pose-meta.json）。
 * 白天的「開心抱金幣」沿用活動頁的 pose-got-points。寢物語是 22:00–06:00。
 */
import { isNight } from "./mascot-home";

export type CheckinPose = "carry" | "miss" | "cheer" | "coins" | "wave";
export type BoxKind = "day" | "day3" | "day7" | "milestone";

const DIR = "/mascot/checkin";
const DAY: Record<CheckinPose, string> = {
  carry: `${DIR}/pose-carry-day.webp`,
  miss: `${DIR}/pose-miss-day.webp`,
  cheer: `${DIR}/pose-cheer-day.webp`,
  coins: "/mascot/campaign/pose-got-points.webp",
  wave: "/mascot/home/pose-wave.webp",
};
const NIGHT: Record<CheckinPose, string> = {
  carry: `${DIR}/pose-carry-night.webp`,
  miss: `${DIR}/pose-miss-night.webp`,
  cheer: `${DIR}/pose-cheer-night.webp`,
  coins: `${DIR}/pose-coins-night.webp`,
  wave: "/mascot/home/pose-bedtime.webp",
};

export const poseUrl = (pose: CheckinPose, now = new Date()): string => (isNight(now) ? NIGHT : DAY)[pose];
export const fingersUrl = (now = new Date()): string => `${DIR}/fingers-${isNight(now) ? "night" : "day"}.webp`;

/** 哪一種箱子：簽到的週期與里程碑照箱型；任務與新手的寶箱借用最接近的那一種。 */
export function boxKindOf(chest: string): BoxKind {
  if (chest === "day3" || chest === "daily_all") return "day3";
  if (chest === "day7" || chest.startsWith("weekly")) return "day7";
  if (/^m\d+$/.test(chest) || chest === "newcomer") return "milestone";
  return "day";
}
export const boxLayer = (kind: BoxKind, layer: "body" | "interior" | "lid"): string => `${DIR}/box-${kind}-${layer}.webp`;
export const boxThumb = (kind: BoxKind): string => `${DIR}/box-${kind}-64.webp`;
export const NEWCOMER_BADGE = `${DIR}/badge-newcomer-96.webp`;

/** 白天捧箱畫布的寬高比；舞台與 Hero 的蘇綺方框都用它，寶箱分層與手指層才對得上。 */
export const CARRY_RATIO = 0.6804;
const NIGHT_RATIO = 0.7;
/** 箱子外框（各自姿勢畫布的比例）：左、上、右、下 */
const DAY_BOX = { l: 0.159, t: 0.421, r: 0.76, b: 0.741 };
const NIGHT_BOX = { l: 0.199, t: 0.401, r: 0.811, b: 0.705 };

/**
 * 夜版：白天畫布上的寶箱整疊要怎麼變形才貼到夜捧箱的箱子上。
 * 兩張圖都以高為準、水平置中放在白天比例的方框裡，所以先換算成方框座標再對齊左上角。
 */
export function nightBoxTransform(): string {
  const dayW = CARRY_RATIO, nightW = NIGHT_RATIO;
  const off = (dayW - nightW) / 2;
  const d = { l: DAY_BOX.l * dayW, r: DAY_BOX.r * dayW, t: DAY_BOX.t, b: DAY_BOX.b };
  const n = { l: off + NIGHT_BOX.l * nightW, r: off + NIGHT_BOX.r * nightW, t: NIGHT_BOX.t, b: NIGHT_BOX.b };
  const sx = (n.r - n.l) / (d.r - d.l);
  const sy = (n.b - n.t) / (d.b - d.t);
  // 以方框左上為原點：x' = sx·x + tx，換成百分比（寬以方框寬 dayW 計）
  const tx = (n.l - sx * d.l) / dayW * 100;
  const ty = (n.t - sy * d.t) * 100;
  return `translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
}

/** 舞台打開前先把會用到的圖載好，不能在滾輪中途才冒出蘇綺或箱子。 */
export function preloadPoses(kinds: BoxKind[] = ["day"], now = new Date()): Promise<void> {
  const urls = [
    ...(["carry", "miss", "cheer", "coins"] as const).map((p) => poseUrl(p, now)),
    fingersUrl(now),
    ...kinds.flatMap((k) => (["body", "interior", "lid"] as const).map((l) => boxLayer(k, l))),
  ];
  return Promise.all(urls.map((src) => new Promise<void>((done) => {
    const img = new Image();
    img.onload = img.onerror = () => done();
    img.src = src;
    img.decode?.().then(() => done(), () => done());
  }))).then(() => undefined);
}
