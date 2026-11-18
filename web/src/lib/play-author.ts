/**
 * 這一頁是不是作者本人在試玩自己的卡：`?mode=source` 且 resolvePlayCard 走過擁有權檢查（/v1/me/card-copies）。
 * 舞台的 `?sdkDebug=1` 除錯面板只在這時開（stage 的 StageHost.authorPlaytest）。
 * 網址上的 mode=source 不算數：review／resume 的路徑不經擁有權檢查。PlayPage 每次換卡先清掉，讀完卡再設。
 */
let verifiedRoleId: string | null = null;

export function setAuthorPlaytest(roleId: string | null): void {
  verifiedRoleId = roleId || null;
}

export function isAuthorPlaytest(roleId: string): boolean {
  return !!verifiedRoleId && verifiedRoleId === String(roleId || "");
}
