/**
 * 充值去 HarperHarbor 為綺夢社做的專屬付款頁（Console 的 /pay/hearthroom），不再去開發者控制台的帳單頁：
 * 那一頁沿用綺夢社的品牌、一頁選好積分包與付款方式，付完有「回到綺夢社」。
 * back 是付完要回來的地方；付款頁只接受綺夢社自己的網域。
 */
export const PAY_PAGE = "https://console.harperharbor.com/pay/hearthroom";

export function topUpUrl(back: string = location.href): string {
  const url = new URL(PAY_PAGE);
  url.searchParams.set("back", back);
  return url.href;
}

/** 月卡也在同一個付款頁買：plan 打開月卡分頁。 */
export function planUrl(plan: string, back: string = location.href): string {
  const url = new URL(PAY_PAGE);
  url.searchParams.set("plan", plan);
  url.searchParams.set("back", back);
  return url.href;
}
