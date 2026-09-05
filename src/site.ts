/**
 * 站台的主機身分。
 *
 * 搬家的時候只改這裡：`HOST` 是現在的家，`LEGACY_HOSTS` 是搬走前用過的。
 * 舊網域不能直接拔掉——這個站的成長迴圈就是分享，已經散在 Discord、X 上的卡片連結
 * 全部指著舊主機，拔了就是一片 404，搜尋引擎累積的排名也一起歸零。
 * 所以舊主機留在路由上，只做一件事：把整條路徑原樣 301 到新家。
 */
export const HOST = "hearthroom.club";

export const LEGACY_HOSTS: readonly string[] = ["community.johnny.moe"];

/** 這個主機是不是我們自己（含搬家前的）。用來判斷 referer 算不算站外來源。 */
export const isSelfHost = (host: string): boolean => host === HOST || LEGACY_HOSTS.includes(host);
