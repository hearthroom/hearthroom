import { currentProvider, type ProviderId, setProvider } from "./provider";

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
