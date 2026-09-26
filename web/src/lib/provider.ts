/** Active platform, capabilities and issuer-scoped credential compatibility. */
export type ProviderId = "harbor";

/** 名稱是專有名詞，各語言都一樣，不進翻譯檔。 */
/* i18n-ignore */
export const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: "harbor", name: "HarperHarbor" },
];

/** 預設那家。沒選過就是它，地區閘道也只作用在它身上。 */
export const DEFAULT_PROVIDER: ProviderId = "harbor";

const STORE_KEY = "hearthroom.provider";

/** Legacy mirrors follow the last-selected issuer; scoped credentials remain independent. */
const CREDENTIAL_KEYS = [
  "hearthroom.oauth.access",
  "hearthroom.oauth.refresh",
  "hearthroom.oauth.client",
  "hearthroom.oauth.verifier",
  "hearthroom.oauth.state",
];

/** 那一家自己的帳號頁。使用者要改密碼、換信箱、換綁第三方，都只能回它家做。 */
export const ACCOUNT_PAGE: Record<ProviderId, string | null> = {
  harbor: "https://console.harperharbor.com/me/account",
};

const API_BASE: Record<ProviderId, string> = {
  harbor: import.meta.env.VITE_HARBOR_API_BASE ?? "https://api.harperharbor.com",
};

/**
 * Harper OAuth 授權範圍。
 * Harbor 不給 scope 只會拿到唯讀，寫不了卡。
 */
const SCOPES: Record<ProviderId, string> = {
  harbor: "profile.read email.read role.read role.write chat.play referral",
};

/**
 * Harper 的能力宣告；會員方案由服務供應商決定。
 * 這兩個入口在那一家的會話裡收起來——不是藏起來的半成品，是那邊真的沒有這條 API。
 */
const FEATURES: Record<ProviderId, Record<string, boolean>> = {
  harbor: {
    editor: true, worldbook: true, regex: true, library: true, persona: true,
    validation: true, deleteRole: true, tags: true, welcomeExtras: true,
    outputContract: true, chatTest: true, previewPage: true, review: true, membership: false,
    world: true,
  },
};

function isProvider(raw: string | null): raw is ProviderId {
  return PROVIDERS.some((p) => p.id === raw);
}

/** 這個會話接的是哪一家。沒選過、或存進去的值壞了，一律回預設那家。 */
export function currentProvider(): ProviderId {
  try {
    const raw = sessionStorage.getItem(STORE_KEY) ?? localStorage.getItem(STORE_KEY);
    return isProvider(raw) ? raw : DEFAULT_PROVIDER;
  } catch {
    return DEFAULT_PROVIDER;
  }
}

/** Pin this tab to its platform. Another tab's selection cannot reroute its requests. */
export function setProvider(id: ProviderId): void {
  if (!isProvider(id)) return;
  try {
    const stored=localStorage.getItem(STORE_KEY);
    // Unscoped pre-retirement tokens have no safe issuer unless explicitly Harbor.
    const mirrorProvider=stored==='harbor'?'harbor':null;
    for(const key of CREDENTIAL_KEYS){
      localStorage.removeItem(`${key}.lunatalk`);
      sessionStorage.removeItem(`${key}.lunatalk`);
      if(mirrorProvider===null)localStorage.removeItem(key);
    }
    sessionStorage.removeItem('hr.apiBase');
    sessionStorage.setItem(STORE_KEY,id);
    if(mirrorProvider===id){localStorage.setItem(STORE_KEY,id);return;}
    for(const key of CREDENTIAL_KEYS)localStorage.removeItem(key);
    localStorage.setItem(STORE_KEY,id);
    for(const key of CREDENTIAL_KEYS) {
      if(!key.endsWith('.access')&&!key.endsWith('.refresh'))continue;
      const value=localStorage.getItem(`${key}.${id}`);
      if(value)localStorage.setItem(key,value);
    }
  } catch { /* Storage unavailable: requests remain subject to authentication. */ }
}

export function apiBaseOf(id: ProviderId = currentProvider()): string {
  if(!isProvider(id))throw new Error("unknown_provider");
  return API_BASE[id];
}

export function scopeOf(id: ProviderId = currentProvider()): string {
  return SCOPES[id] ?? "";
}

/** 目前這家有沒有這項能力。 */
export function can(feature: keyof (typeof FEATURES)["harbor"], id: ProviderId = currentProvider()): boolean {
  return FEATURES[id]?.[feature] ?? false;
}

export function providerName(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}
