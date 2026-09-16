import { COMMUNITY_API } from "./config";
import { currentProvider, PROVIDERS, type ProviderId, providerName, setProvider } from "./provider";

/**
 * 換供應商的規則。
 *
 * 換一家不是換個登入方式，是**換一個帳號**：兩家的資料完全不混，換過去之後我的卡片、
 * 榜單、錢包都是那一家的。所以已經登入的人要換，得先看到這句話再決定。
 *
 * 規則放在這裡而不是元件裡：登入頁、帳號選單、切換器三個地方都要用同一套判斷，
 * 各寫一份遲早會有一個地方忘了先登出。
 */

/** 已經登入、而且點的是另一家時，才要先問過。點目前這家不算換。 */
export function needsSwitchConfirm(id: ProviderId, ctx: { signedIn: boolean }): boolean {
  return ctx.signedIn && id !== currentProvider();
}

export interface ChooseOptions {
  /** 開始那一家的 OAuth。 */
  login: () => Promise<void> | void;
  /** 登出目前這家；換家時會先叫它。 */
  logout?: () => Promise<void> | void;
  signedIn?: boolean;
}

/**
 * 選一家並開始登入。
 *
 * 順序是「先登出舊的，再換供應商，最後開始新的登入」——反過來的話，登出會把剛換好的
 * 那一家的憑證一起清掉（憑證的鍵不分家，見 provider.ts 的 CREDENTIAL_KEYS）。
 */
export async function chooseProvider(id: ProviderId, opts: ChooseOptions): Promise<void> {
  const switching = opts.signedIn === true && id !== currentProvider();
  if (switching && opts.logout) await opts.logout();
  setProvider(id);
  await opts.login();
}

/**
 * 這個部署真的有哪幾家。伺服器說了算——前端寫死的話，沒配第二家的部署（包括自架的人）
 * 也會看到那顆按鈕，按下去每個請求都 400。
 *
 * 問不到就只給預設那家：寧可少一顆按鈕，也不要一顆按了就報錯的按鈕。
 */
export async function availableProviders(): Promise<{ id: ProviderId; name: string }[]> {
  const fallback = [{ id: "lunatalk" as ProviderId, name: providerName("lunatalk") }];
  try {
    const res = await fetch(`${COMMUNITY_API}/providers`);
    if (!res.ok) return fallback;
    const body = (await res.json()) as { providers?: { id?: string }[] };
    const known = (body.providers ?? [])
      .map((p) => PROVIDERS.find((known) => known.id === p.id))
      .filter((p): p is (typeof PROVIDERS)[number] => !!p);
    return known.length ? known : fallback;
  } catch {
    return fallback;
  }
}
