// 畫布可能跑在卡片 App 網域（play.<主站>）：那裡只有對話頁與登入，沒有簽到頁、月卡轉址頁。
// 「積分不夠」那張卡的連結一律回主站，語言用主站的前綴（不是卡片 App 的 ?lang=）。
import { expect, it } from "vitest";
import { mainSiteLinks } from "../src/lib/site";

const lp = (p: string) => `/en${p}`;

it("在主站：照主站自己的網址與語言前綴", () => {
  const { origin, lp: path } = mainSiteLinks({ hostname: "sukisuki.ai", origin: "https://sukisuki.ai", locale: "en", lp });
  expect(`${origin}${path("/checkin")}`).toBe("https://sukisuki.ai/en/checkin");
});

it("在卡片 App 網域：回主站，語言用前綴；繁中不加前綴", () => {
  const en = mainSiteLinks({ hostname: "play.sukisuki.ai", origin: "https://play.sukisuki.ai", locale: "en", lp: (p) => `${p}?lang=en` });
  expect(`${en.origin}${en.lp("/checkin")}?from=x`).toBe("https://sukisuki.ai/en/checkin?from=x");
  const zh = mainSiteLinks({ hostname: "play.sukisuki.ai", origin: "https://play.sukisuki.ai", locale: "zh-Hant", lp: (p) => `${p}?lang=zh-Hant` });
  expect(`${zh.origin}${zh.lp("/go/plan")}`).toBe("https://sukisuki.ai/go/plan");
});
