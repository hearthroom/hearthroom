/** 大數字縮寫。榜單上一行要塞很多資訊，完整數字沒有意義。 */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const day = 86_400_000;
  if (diff < 3_600_000) return "剛剛";
  if (diff < day) return `${Math.floor(diff / 3_600_000)} 小時前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(ms).toLocaleDateString();
}

/** 沒有封面時，用角色名產生一個穩定的色相，讓佔位卡彼此有區別。 */
export function hueFrom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}
