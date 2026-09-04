import type { MyCardPage } from "./api";

/**
 * 瀏覽器這一層的快取。
 *
 * 目的只有一個：從卡片詳情頁按上一頁回來時，畫面立刻就在，而不是又閃一次骨架屏。
 * 拿到舊資料先畫、同時在背景重抓（stale-while-revalidate）。
 *
 * 用 sessionStorage 而不是 localStorage：這是別人的作品清單，關掉分頁就該消失，
 * 沒有理由留在硬碟上。也因此不需要處理「換帳號登入」的殘留——但仍然用帳號 ID
 * 當鍵的一部分，萬一同一個分頁裡換了人也不會讀到上一個人的資料。
 */

const TTL_MS = 60_000;

interface Entry {
  at: number;
  page: MyCardPage;
}

const key = (accountNumId: number, page: number) => `mine:${accountNumId}:${page}`;

export function read(accountNumId: number, page: number): { page: MyCardPage; stale: boolean } | null {
  try {
    const raw = sessionStorage.getItem(key(accountNumId, page));
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry;
    return { page: entry.page, stale: Date.now() - entry.at > TTL_MS };
  } catch {
    // 隱私模式、配額爆掉、格式壞掉——快取讀不到只是慢一點，不該讓頁面掛掉。
    return null;
  }
}

export function write(accountNumId: number, page: number, value: MyCardPage): void {
  try {
    sessionStorage.setItem(key(accountNumId, page), JSON.stringify({ at: Date.now(), page: value } satisfies Entry));
  } catch {
    /* 寫不進去就算了 */
  }
}

/** 自己改過資料之後把整個帳號的快取丟掉：寧可多抓一次，也不要顯示已知是錯的東西。 */
export function invalidate(accountNumId: number): void {
  try {
    const prefix = `mine:${accountNumId}:`;
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(prefix)) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}
