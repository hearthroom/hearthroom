import { HARBOR } from "./provider";

/**
 * 供應商的顯示名稱。
 *
 * 本站自己不存卡、不跑模型、不管登入，這些都住在供應商那邊；成員、卡片都帶著供應商代號。
 * 現在只有一家，之後接第二家時在這裡加一列（代號、名稱），登入頁與作者頁就會多出它。
 * 名稱是專有名詞，各語言都一樣，不進翻譯檔。
 */
/* i18n-ignore */
// Harbor 模式沿用 lunatalk 這個代號：它是成員身分表裡的資料鍵，換代號等於換一批帳號；只換顯示名稱。
export const PROVIDERS: { id: string; name: string }[] = [{ id: "lunatalk", name: HARBOR ? "HarperHarbor" : "LunaTalk" }];

export function providerName(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}
