/**
 * 照顧與羈絆（拓麻歌子／QQ 寵物那一套）：故事是她的飯。
 *
 * 第一段先存在瀏覽器裡；之後搬進帳號，換裝置也跟著走，並接上推播。
 * 「餵食」不靠玩卡頁通知（玩卡在另一個網域，看不到這裡的儲存）：回到站上時比對最近一次聊天的時間。
 * 底線：她不會死、不會走，最多想睡、寂寞；台詞不情緒勒索；不跟點數或付費掛鉤。
 */

export interface CareState {
  /** 0–1：故事飽足度，約一天見底 */
  fullness: number;
  /** 0–1：心情，摸頭陪玩升、亂戳降，慢慢回到 0.6 */
  mood: number;
  /** 好感度點數：每天來並餵過一次 +1 */
  affection: number;
  /** 連續來了幾天 */
  streak: number;
  /** 上次來的日期（本地，YYYY-MM-DD） */
  lastDay: string;
  /** 上次算到的時間與上次餵食的時間（ms） */
  at: number;
  fedAt: number;
  /** 今天給過好感度了沒 */
  creditedDay: string;
}

const KEY = "suki.care";
const DAY_MS = 86_400_000;
const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 好感度等級：門檻（點數）與解鎖的東西，台詞由畫面那邊照等級挑 */
export const LEVELS = [0, 3, 7, 14, 30, 60] as const;
export function levelOf(affection: number): number {
  let l = 0;
  for (let i = 0; i < LEVELS.length; i++) if (affection >= LEVELS[i]) l = i;
  return l;
}

export type CareNews =
  | { kind: "fed" } | { kind: "hungry" } | { kind: "levelUp"; level: number }
  | { kind: "streak"; days: number } | { kind: "missed"; days: number };

export class Care {
  state: CareState;
  constructor(private now: () => number = Date.now) {
    const fresh: CareState = { fullness: 0.6, mood: 0.6, affection: 0, streak: 0, lastDay: "", at: now(), fedAt: 0, creditedDay: "" };
    try { this.state = { ...fresh, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { this.state = fresh; }
  }
  private save() { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* 存不了：這次照算，下次重來 */ } }

  /** 打開網站時：時間流逝、算連續天數、看有沒有在別處聊過天（餵過） */
  visit(lastStoryAt: number | null): CareNews[] {
    const s = this.state, t = this.now(), news: CareNews[] = [];
    const hours = Math.max(0, (t - s.at) / 3_600_000);
    s.fullness = Math.max(0, s.fullness - hours / 24);
    s.mood += (0.6 - s.mood) * Math.min(1, hours / 12);
    s.at = t;
    const d = today(new Date(t));
    if (s.lastDay !== d) {
      const yesterday = today(new Date(t - DAY_MS));
      if (s.lastDay === yesterday) s.streak += 1;
      else {
        if (s.lastDay) news.push({ kind: "missed", days: Math.round((Date.parse(d) - Date.parse(s.lastDay)) / DAY_MS) });
        s.streak = 1;
      }
      s.lastDay = d;
      if (s.streak === 7 || s.streak === 30 || (s.streak > 30 && s.streak % 30 === 0)) news.push({ kind: "streak", days: s.streak });
    }
    if (lastStoryAt && lastStoryAt > s.fedAt) news.push(...this.feed(lastStoryAt));
    else if (s.fullness < 0.25) news.push({ kind: "hungry" });
    this.save();
    return news;
  }

  /** 聊了一個故事：吃飽，今天第一次的話好感度 +1 */
  feed(at = this.now()): CareNews[] {
    const s = this.state, news: CareNews[] = [{ kind: "fed" }];
    s.fullness = 1; s.fedAt = at; s.mood = Math.min(1, s.mood + 0.2);
    const d = today(new Date(this.now()));
    if (s.creditedDay !== d) {
      const before = levelOf(s.affection);
      s.affection += 1; s.creditedDay = d;
      const after = levelOf(s.affection);
      if (after > before) news.push({ kind: "levelUp", level: after });
    }
    this.save();
    return news;
  }

  /** 摸頭、陪玩：心情升；亂戳：心情降 */
  touch(delta: number) {
    this.state.mood = Math.max(0, Math.min(1, this.state.mood + delta));
    this.save();
  }

  get level() { return levelOf(this.state.affection); }
}
