/**
 * 現在接的是哪一家供應商，以及它有哪些能力。
 *
 * 本站不存卡、不跑模型、不管登入，這些都住在供應商那邊。以前只有一家，所以這是個常數；
 * 現在兩家，而且**兩家的資料完全不混**（owner 2026-09-16）：登入哪一家就用哪一家的 API，
 * 看到的榜單、卡片、作者也是那一家的。所以它屬於這個會話，不是建置期選項。
 *
 * 這個檔不 import 任何自家模組：api.ts 的頂層常數要讀它，而它若反過來引用 api.ts，
 * 瀏覽器依載入順序會在初始化前讀到 undefined。
 */

export type ProviderId = "lunatalk" | "harbor";

/** 名稱是專有名詞，各語言都一樣，不進翻譯檔。 */
/* i18n-ignore */
export const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: "lunatalk", name: "LunaTalk" },
  { id: "harbor", name: "HarperHarbor" },
];

/** 預設那家。沒選過就是它，地區閘道也只作用在它身上。 */
export const DEFAULT_PROVIDER: ProviderId = "lunatalk";

const STORE_KEY = "hearthroom.provider";

/** 換家等於換帳號，所以上一家的憑證要一起清掉——留著的話下一個請求會拿 A 家的 token 去問 B 家。 */
const CREDENTIAL_KEYS = [
  "hearthroom.oauth.access",
  "hearthroom.oauth.refresh",
  "hearthroom.oauth.client",
  "hearthroom.oauth.verifier",
  "hearthroom.oauth.state",
];

const API_BASE: Record<ProviderId, string> = {
  lunatalk: import.meta.env.VITE_PROVIDER_API_BASE ?? "https://api.lunatalk.ai",
  harbor: import.meta.env.VITE_HARBOR_API_BASE ?? "https://api.harperharbor.com",
};

/**
 * 每家要不要、以及要哪些授權範圍。LunaTalk 的客戶端不帶 scope（它的預設就是全部）；
 * Harbor 不給 scope 只會拿到唯讀，寫不了卡。
 */
const SCOPES: Record<ProviderId, string> = {
  lunatalk: "",
  harbor: "profile.read role.read role.write",
};

/**
 * 這家供應商有哪些能力。LunaTalk 全部都有；Harbor 目前只有卡片本身、封面與錢包，
 * 其餘入口在那一家的會話裡收起來——不是藏起來的半成品，是那邊真的沒有這條 API。
 */
const FEATURES: Record<ProviderId, Record<string, boolean>> = {
  lunatalk: {
    editor: true, comments: true, worldbook: true, regex: true, library: true, persona: true,
    validation: true, deleteRole: true, tags: true, welcomeExtras: true,
    outputContract: true, chatTest: true, previewPage: true, review: true,
  },
  harbor: {
    editor: true, comments: false, worldbook: true, regex: true, library: false, persona: false,
    validation: false, deleteRole: false, tags: false, welcomeExtras: false,
    outputContract: false, chatTest: false, previewPage: false, review: false,
  },
};

function isProvider(raw: string | null): raw is ProviderId {
  return PROVIDERS.some((p) => p.id === raw);
}

/** 這個會話接的是哪一家。沒選過、或存進去的值壞了，一律回預設那家。 */
export function currentProvider(): ProviderId {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return isProvider(raw) ? raw : DEFAULT_PROVIDER;
  } catch {
    return DEFAULT_PROVIDER;
  }
}

/**
 * 換一家。換了就等於換一個帳號：上一家的憑證立刻作廢，呼叫端接著要重新登入。
 * 選的是同一家就什麼都不做——不能讓「再點一次目前這家」把人登出。
 */
export function setProvider(id: ProviderId): void {
  if (!isProvider(id)) return;
  const changed = currentProvider() !== id;
  try {
    localStorage.setItem(STORE_KEY, id);
    if (changed) for (const key of CREDENTIAL_KEYS) localStorage.removeItem(key);
  } catch {
    /* 隱私模式下寫不進去：這一次就用預設那家，不影響瀏覽 */
  }
}

export function apiBaseOf(id: ProviderId = currentProvider()): string {
  return API_BASE[id] ?? API_BASE[DEFAULT_PROVIDER];
}

export function scopeOf(id: ProviderId = currentProvider()): string {
  return SCOPES[id] ?? "";
}

/** 目前這家有沒有這項能力。 */
export function can(feature: keyof (typeof FEATURES)["lunatalk"], id: ProviderId = currentProvider()): boolean {
  return FEATURES[id]?.[feature] ?? false;
}

export function providerName(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}
