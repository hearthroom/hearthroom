/**
 * 卡片頁 → 對話頁是整頁跳轉（舞台每份文件只裝一次），新頁要等程式載完才知道這是哪張卡。
 * 跳轉前把卡名與封面先放進 sessionStorage，對話頁的載入畫面第一幀就畫得出這張卡，
 * 而不是一片黑。只認同一張卡（卡號或卡片 id 任一相符），別張卡的不拿。
 */
const KEY = "hearthroom.play.intro";

export interface PlayIntro { name: string; art: string; backdrop: string }

export function savePlayIntro(ids: Array<string | number | null | undefined>, intro: PlayIntro): void {
  try { sessionStorage.setItem(KEY, JSON.stringify({ ids: ids.filter(id => id != null && id !== "").map(String), intro })); }
  catch { /* 無痕模式或存滿：載入畫面退回不帶封面的樣子 */ }
}

export function readPlayIntro(id: string): PlayIntro | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (!saved || !Array.isArray(saved.ids) || !saved.ids.includes(id)) return null;
    const { name, art, backdrop } = saved.intro ?? {};
    return { name: String(name ?? ""), art: String(art ?? ""), backdrop: String(backdrop ?? "") };
  } catch { return null; }
}
