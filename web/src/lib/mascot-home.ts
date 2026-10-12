/**
 * 已登入首頁的蘇綺面板（設定集 docs/design/hearthroom-mascot）：今天的場景、她的姿勢、問候。
 *
 * 面板只放看的人自己的東西（沒聊完的對話、自己的卡），不替人挑卡：發現新卡的入口是下面的榜單（owner 2026-10-13）。
 * 場景與姿勢每天換一組，同一天之內不變，免得每次重新整理都跳；素材多準備幾套，看久了才不膩。
 */

import { computed, ref } from "vue";
import { isNewMember, tourDone } from "./onboarding";
import { useSession } from "./session";

const WELCOME_KEY = "hr.mascotWelcome.dismissed";
function readDismissed(): boolean {
  try { return localStorage.getItem(WELCOME_KEY) === "1"; } catch { return false; }
}
const welcomeDismissed = ref(readDismissed());

/**
 * 新訪客的歡迎橫幅（MascotWelcome）：沒登入的訪客，或成為成員不滿七天的人；按過關閉或走完引導就不再出現。
 * 首頁頂端一次只放一塊蘇綺：歡迎橫幅還在，已登入的面板（MascotHome）就先不出。
 */
export function useMascotWelcome() {
  const session = useSession();
  const newcomer = computed(() => !session.me || (!!session.profile && isNewMember(session.profile.memberSince)));
  const visible = computed(() => session.ready && newcomer.value && !welcomeDismissed.value && !tourDone());
  function dismiss() {
    welcomeDismissed.value = true;
    try { localStorage.setItem(WELCOME_KEY, "1"); } catch { /* 存不了就只關這一次 */ }
  }
  return { visible, dismiss };
}

export type HomeIntent = "resume" | "discover" | "roll" | "write";

/**
 * 一天分五段，照看的人裝置上的時間：場景、問候、選項名稱與她的話都跟著時段走。
 * 每段都備好幾張場景，每天在那一段裡輪一張；季節限定的只在那幾個月加入。
 */
export type Slot = "morning" | "afternoon" | "dusk" | "night" | "late";
export function slotOf(now: Date): Slot {
  const h = now.getHours();
  if (h < 5) return "late";
  if (h < 11) return "morning";
  if (h < 17) return "afternoon";
  if (h < 19) return "dusk";
  return "night";
}
/** 晚上與深夜：深色場景、淺色字，選項與台詞用睡前那一套 */
export function isNight(now: Date): boolean {
  const slot = slotOf(now);
  return slot === "night" || slot === "late";
}

interface Scene {
  id: string;
  slots: Slot[];
  /** 只在這些月份出現（1–12）；不帶＝整年 */
  months?: number[];
}

/**
 * 圖在 /mascot/home/scene-<id>.webp：原圖 1536×1024 中間那一條（y 300–724），左邊留給字、右邊站人。
 * 晚上與深夜的場景要是深色的（字是淺色），其他時段是淺色的。
 */
export const SCENES: Scene[] = [
  { id: "lobby-day", slots: ["morning", "afternoon"] },
  { id: "desk", slots: ["morning"] },
  { id: "cafe-day", slots: ["morning"] },
  { id: "rainy-day", slots: ["morning", "afternoon"] },
  { id: "library", slots: ["afternoon", "dusk"] },
  { id: "classroom-sunset", slots: ["dusk"] },
  { id: "bedroom-morning", slots: ["morning"] },
  { id: "bakery-street", slots: ["morning"] },
  { id: "garden-tea", slots: ["afternoon"] },
  { id: "library-sunny", slots: ["afternoon"] },
  { id: "riverbank-dusk", slots: ["dusk"] },
  { id: "rooftop-dusk", slots: ["dusk"] },
  { id: "shrine-dusk", slots: ["dusk"] },
  { id: "bus-stop-dusk", slots: ["dusk"], months: [6, 7, 8, 9] },
  { id: "sakura", slots: ["morning", "afternoon"], months: [3, 4] },
  { id: "summer-beach", slots: ["morning", "afternoon"], months: [6, 7, 8] },
  { id: "festival-day", slots: ["afternoon", "dusk"], months: [7, 8] },
  { id: "autumn-park", slots: ["afternoon", "dusk"], months: [9, 10, 11] },
  { id: "snow-day", slots: ["morning", "afternoon"], months: [12, 1, 2] },
  { id: "window-night", slots: ["night", "late"] },
  { id: "rooftop-stars", slots: ["night", "late"] },
  { id: "train-night", slots: ["night", "late"] },
  { id: "konbini-night", slots: ["night", "late"] },
  { id: "balcony-moon", slots: ["night", "late"] },
  { id: "desk-lamp-late", slots: ["late"] },
  { id: "bookstore-night", slots: ["night"] },
  { id: "aquarium", slots: ["night"] },
  { id: "festival-night", slots: ["night"], months: [7, 8] },
  { id: "christmas-night", slots: ["night", "late"], months: [12] },
];

/** 姿勢在 /mascot/home/pose-<id>.webp：去背、底部對齊，同一個縮放 */
export const POSES: Record<HomeIntent, { day: string[]; night: string[] }> = {
  resume: { day: ["resume-day-1", "resume-day-2", "wave"], night: ["resume-night-1", "resume-night-2", "bedtime"] },
  discover: { day: ["discover-1", "discover-2", "hoard"], night: ["discover-2", "hoard"] },
  roll: { day: ["roll-1", "roll-2", "wave"], night: ["roll-night", "roll-1"] },
  write: { day: ["write-1", "write-2"], night: ["write-night", "write-2"] },
};

export type Greeting = "morning" | "afternoon" | "dusk" | "evening" | "night" | "late";
export function greetingOf(now: Date): Greeting {
  const slot = slotOf(now);
  if (slot !== "night") return slot;
  return now.getHours() < 22 ? "evening" : "night";
}

/** 本地日期的天數：跨午夜才換，不是跨 UTC */
function dayNumber(now: Date): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
}

/** 今天這個時段的場景 */
export function sceneOf(now: Date): Scene & { night: boolean } {
  const slot = slotOf(now);
  const month = now.getMonth() + 1;
  const pool = SCENES.filter((s) => s.slots.includes(slot) && (!s.months || s.months.includes(month)));
  return { ...pool[dayNumber(now) % pool.length], night: isNight(now) };
}

/** 今天這個選項配哪個姿勢：每個選項錯開，不會四個同一天都換到同一號 */
export function poseOf(intent: HomeIntent, now: Date): string {
  const list = POSES[intent][isNight(now) ? "night" : "day"];
  const offset = (["resume", "discover", "roll", "write"] as const).indexOf(intent);
  return list[(dayNumber(now) + offset) % list.length];
}
