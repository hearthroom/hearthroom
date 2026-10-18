/**
 * 每一頁的用途（設定集 docs/design/hearthroom-mascot「桌寵與嚮導」）：第一次到這頁她說一句那頁是做什麼的，
 * 選單裡的「這頁怎麼用」列這頁的問答。文案在 i18n 的 mascot.pet.guide.<id>.*：hello、q1/a1、q2/a2…
 * 只寫畫面上真的有、真的能做的事；功能改了要一起改。玩卡頁與沙盒她不出現，不在這裡。
 */
export interface GuideDef {
  id: string;
  match: (path: string) => boolean;
  /** 這頁有幾組問答 */
  topics: number;
}

const is = (re: RegExp) => (path: string) => re.test(path);

export const GUIDES: GuideDef[] = [
  { id: "board", match: is(/^\/$/), topics: 4 },
  { id: "search", match: is(/^\/search$/), topics: 2 },
  { id: "editor", match: is(/^\/(create|cards\/[^/]+\/edit)$/), topics: 3 },
  { id: "card", match: is(/^\/cards\/[^/]+$/), topics: 3 },
  { id: "author", match: is(/^\/authors\//), topics: 1 },
  { id: "library", match: is(/^\/library$/), topics: 2 },
  { id: "mine", match: is(/^\/mine$/), topics: 3 },
  { id: "wallet", match: is(/^\/wallet$/), topics: 2 },
  { id: "referral", match: is(/^\/me\/referral$/), topics: 2 },
  { id: "badges", match: is(/^\/me\/badges$/), topics: 2 },
  { id: "community", match: is(/^\/me\/community$/), topics: 2 },
  { id: "notifications", match: is(/^\/me\/notifications$/), topics: 2 },
  { id: "me", match: is(/^\/me$/), topics: 1 },
  { id: "settings", match: is(/^\/settings$/), topics: 2 },
  { id: "resources", match: is(/^\/resources$/), topics: 1 },
  { id: "guide", match: is(/^\/guide$/), topics: 1 },
  { id: "developers", match: is(/^\/developers$/), topics: 1 },
  { id: "updates", match: is(/^\/updates$/), topics: 0 },
  { id: "download", match: is(/^\/download$/), topics: 1 },
  { id: "review", match: is(/^\/review/), topics: 2 },
];

/** 去掉語言前綴（/en/mine → /mine） */
export function bare(path: string): string {
  const m = path.match(/^\/(zh-Hans|en|ja|ko)(\/.*)?$/);
  return m ? (m[2] || "/") : path;
}

export function guideFor(path: string): GuideDef | null {
  const p = bare(path).replace(/\/+$/, "") || "/";
  return GUIDES.find((g) => g.match(p)) ?? null;
}
