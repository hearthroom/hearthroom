/**
 * 蘇綺的照顧與羈絆（設定集 docs/design/hearthroom-mascot「拓麻歌子與 QQ 寵物的枯れた技術水平思考」）。
 *
 * 她需要你（故事是她的飯，約一天見底）、她會叫你（一天沒來就寄一則「餓了」或「明信片」）、
 * 她因為你而長大（等級解鎖東西）。網站與排程共用這一份，算法只有一套。
 *
 * 每天第一次來就是簽到（owner 2026-10-13：本質是簽到，換成「回來陪她」的樣子）：好感 +1、連續天數 +1；
 * 那天聊了故事再 +1。養她是手段，目的是讓人回來玩卡，所以聊故事的加成比單純簽到多。
 * 底線：她不會死、不會走，最多餓了、寂寞；不情緒勒索；不跟點數或付費掛鉤。
 */

export interface SukiState {
  /** 0–1：故事飽足度 */
  fullness: number;
  /** 好感度點數：每天第一次來 +1（簽到），那天聊了故事再 +1 */
  affection: number;
  /** 連續來了幾天 */
  streak: number;
  /** 上次來的本地日期 YYYY-MM-DD */
  lastDay: string;
  /** 上次算到的時間、上次聊故事的時間、今天給過好感的日期 */
  at: number;
  fedAt: number;
  creditedDay: string;
  /** 每個鐘點來過幾次（本地時間，舊的會慢慢淡掉）：用來挑「你平常上站的時段」寄召回 */
  hours: number[];
}

export type SukiNews =
  | { kind: "fed" } | { kind: "hungry" } | { kind: "levelUp"; level: number }
  | { kind: "streak"; days: number } | { kind: "missed"; days: number } | { kind: "checkIn"; days: number };

/** 好感度等級的門檻（點數） */
export const LEVELS = [0, 5, 12, 25, 50, 100] as const;
export function levelOf(affection: number): number {
  let l = 0;
  for (let i = 0; i < LEVELS.length; i++) if (affection >= LEVELS[i]) l = i;
  return l;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** tzOffset：分鐘，跟 Date#getTimezoneOffset 同號（台北是 -480） */
export function localDay(at: number, tzOffset: number): string {
  return new Date(at - tzOffset * 60_000).toISOString().slice(0, 10);
}
export function localHour(at: number, tzOffset: number): number {
  return new Date(at - tzOffset * 60_000).getUTCHours();
}

export function freshState(now: number): SukiState {
  return { fullness: 0.6, affection: 0, streak: 0, lastDay: "", at: now, fedAt: 0, creditedDay: "", hours: Array(24).fill(0) };
}

/**
 * 打開網站：時間流逝、算連續天數、看有沒有在別處聊過故事（餵過）。
 * lastStoryAt：最近一次開故事的時間（站上的對話紀錄）；沒有就是 null。
 */
export function visit(prev: SukiState | null, now: number, lastStoryAt: number | null, tzOffset: number): { state: SukiState; news: SukiNews[] } {
  const s: SukiState = prev ? { ...prev, hours: [...(prev.hours ?? Array(24).fill(0))] } : freshState(now);
  const news: SukiNews[] = [];
  const hours = Math.max(0, (now - s.at) / HOUR);
  s.fullness = Math.max(0, s.fullness - hours / 24);
  s.at = now;
  const day = localDay(now, tzOffset);
  if (s.lastDay !== day) {
    if (s.lastDay === localDay(now - DAY, tzOffset)) s.streak += 1;
    else {
      if (s.lastDay) news.push({ kind: "missed", days: Math.round((Date.parse(day) - Date.parse(s.lastDay)) / DAY) });
      s.streak = 1;
    }
    s.lastDay = day;
    // 簽到：今天第一次來
    const before = levelOf(s.affection);
    s.affection += 1;
    news.push({ kind: "checkIn", days: s.streak });
    if (levelOf(s.affection) > before) news.push({ kind: "levelUp", level: levelOf(s.affection) });
    if (s.streak === 7 || s.streak === 30 || (s.streak > 30 && s.streak % 30 === 0)) news.push({ kind: "streak", days: s.streak });
    // 一天記一次上站的鐘點，舊的打九折：搬家換時區、作息改了，幾週後就跟上
    s.hours = s.hours.map((n) => n * 0.9);
    s.hours[localHour(now, tzOffset)] += 1;
  }
  if (lastStoryAt && lastStoryAt > s.fedAt) news.push(...feed(s, lastStoryAt, now, tzOffset));
  else if (s.fullness < 0.25) news.push({ kind: "hungry" });
  return { state: s, news };
}

/** 聊了一個故事：吃飽，今天第一次的話好感 +1（直接改 s） */
export function feed(s: SukiState, at: number, now: number, tzOffset: number): SukiNews[] {
  const news: SukiNews[] = [{ kind: "fed" }];
  s.fullness = 1;
  s.fedAt = at;
  const day = localDay(now, tzOffset);
  if (s.creditedDay !== day) {
    const before = levelOf(s.affection);
    s.affection += 1;
    s.creditedDay = day;
    const after = levelOf(s.affection);
    if (after > before) news.push({ kind: "levelUp", level: after });
  }
  return news;
}

/** 平常上站的時段（本地鐘點）；還沒資料，或平常都在深夜，就挑晚上九點——寢物語的時間 */
export function usualHour(s: SukiState): number {
  let best = -1, at = 21;
  s.hours?.forEach((n, h) => { if (n > best) { best = n; at = h; } });
  if (best <= 0 || at < 8) return 21;
  return at;
}

/**
 * 該不該寄召回：打開了召回、一天以上沒來（兩週以上就不吵了）、離上一則超過 20 小時、
 * 現在是他平常上站的那個鐘點。一天最多一則（呼叫端用日期當事件鍵）。
 */
export function recallDue(s: SukiState, lastSeen: number, lastRecall: number, now: number, tzOffset: number): boolean {
  const away = now - lastSeen;
  if (away < 20 * HOUR || away > 14 * DAY) return false;
  if (now - lastRecall < 20 * HOUR) return false;
  return localHour(now, tzOffset) === usualHour(s);
}
