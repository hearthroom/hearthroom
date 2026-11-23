import { authHeaders, json } from "./api";
import { COMMUNITY_API } from "./config";
import { currentProvider } from "./provider";
import { currentSurface } from "./track";

/**
 * 審核統計（管理員）。口徑與抑制都在服務端 src/review-stats.ts：這裡拿到的格子已經處理過，
 * suppressed 只有狀態、沒有數字；unmeasured 是沒有記錄（不是 0）。
 */
export type StatValues = Record<string, number | null>;
export type StatCell =
  | { status: "ok"; n: number; denominator?: number; values: StatValues }
  | { status: "suppressed" }
  | { status: "unmeasured" };

export interface ReviewStats {
  specVersion: number;
  generatedAt: number;
  weeks: number;
  window: { start: number; end: number; weekStarts: string[] };
  baseline: { start: number; end: number; weekStarts: string[] };
  v2StartedAt: number;
  v2Recorded: boolean;
  empty: boolean;
  thresholds: { rows: number; authors: number };
  /** 區塊 → 維度 → 格子（窗口總計；存量是資料截至時） */
  cells: Record<string, Record<string, StatCell>>;
}

export const STATS_WEEK_OPTIONS = [1, 2, 4, 8, 12] as const;

const headers = (token: string) => ({ "X-From": currentSurface(), "X-Provider": currentProvider(), ...authHeaders(token) });

export async function fetchReviewStats(token: string, weeks: number): Promise<ReviewStats> {
  return json<ReviewStats>(await fetch(`${COMMUNITY_API}/review/stats?${new URLSearchParams({ weeks: String(weeks) })}`, { headers: headers(token) }));
}

/** CSV 要帶登入憑證，不能用一般連結下載：讀成 Blob，再交給瀏覽器存檔 */
export async function downloadReviewStatsCsv(token: string, weeks: number): Promise<void> {
  const res = await fetch(`${COMMUNITY_API}/review/stats/export?${new URLSearchParams({ weeks: String(weeks) })}`, { headers: headers(token) });
  if (!res.ok) await json(res);
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "review-stats.csv";
  const url = URL.createObjectURL(await res.blob());
  try {
    const a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
