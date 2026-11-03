/**
 * 首頁輪播的限時公告：站方要大家知道的一件事，一張字畫在圖裡的圖（版型同活動 poster，輪播不疊字），點了去說明頁。
 * 期間寫死在這裡、到了就自動下架；每個語言要有自己的圖才會出現（字畫在圖上，不能拿別的語言的圖頂）。
 *
 * 為什麼不是活動、也不是置頂文章：活動只有分享季、創作季這類真的有報名與獎金的；置頂文章在輪播上一定疊標題與漸層，
 * 字畫在圖裡的版本會被蓋住（任務 2026-11-03-badges-announcement，owner：「直接把文字放到圖裡……一眼就能看得很清楚」）。
 *
 * 圖：public/announcements/<id>-<語言>.webp，1536×576（同活動 poster）。輪播會照框裁切：桌機 1152×320 切掉上下、
 * 手機 358×176 切掉左右，字與人物要放在 x 182–1353、y 75–501 之內。
 */
export interface HomeAnnouncement {
  id: string;
  /** 開始與結束（毫秒，結束不含）；開始是 null 時不出現——上線日定了再填 */
  from: number | null;
  until: number;
  /**
   * 每語一張圖（public 底下的路徑）與點了去的頁（站內路徑，不帶語言前綴，連結由 lp() 補）；
   * 各語言的文章代稱不同（翻譯版帶語言後綴），所以頁也是每語各一個。圖上的字給讀屏的版本在語系檔 announcement.<id>.alt
   */
  posters: Partial<Record<string, { src: string; path: string }>>;
}
export interface ActiveAnnouncement { id: string; path: string; src: string }

export const HOME_ANNOUNCEMENTS: HomeAnnouncement[] = [
  {
    // 卡片獎勵規則（返點＋榜單獎勵＋榜單徽章），掛一個月（owner 2026-11-03）
    id: "card-rewards",
    // 說明頁 2026-11-03 發布；台北 11-03 00:00 起掛一個月，到 12-03 00:00 自動下架
    from: Date.UTC(2026, 10, 2, 16),
    until: Date.UTC(2026, 11, 2, 16),
    // 圖由美工交（字畫在圖裡），五語各一張；頁是各語言自己的那一篇
    posters: {
      "zh-Hant": { src: "/announcements/card-rewards-zh-Hant.webp", path: "/blog/rewards/card-rewards" },
      "zh-Hans": { src: "/announcements/card-rewards-zh-Hans.webp", path: "/blog/rewards/card-rewards-zh-hans" },
      en: { src: "/announcements/card-rewards-en.webp", path: "/blog/rewards/card-rewards-en" },
      ja: { src: "/announcements/card-rewards-ja.webp", path: "/blog/rewards/card-rewards-ja" },
      ko: { src: "/announcements/card-rewards-ko.webp", path: "/blog/rewards/card-rewards-ko" },
    },
  },
];

/** 現在這個語言看得到的公告，照清單順序。 */
export function activeAnnouncements(list: readonly HomeAnnouncement[], now: number, locale: string): ActiveAnnouncement[] {
  return list.flatMap((a) => {
    const poster = a.posters[locale];
    if (a.from === null || now < a.from || now >= a.until || !poster) return [];
    return [{ id: a.id, path: poster.path, src: poster.src }];
  });
}
