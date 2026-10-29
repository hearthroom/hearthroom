/**
 * 預設頁共用的身分處理：拿這個帳號的 token；上游說授權裡沒有預設的權限（舊登入沒同意過），
 * 就停下來請他重新同意一次，同意完回到原頁，不把它當成一般錯誤。
 */
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { ApiError } from "./api";
import { accountToken } from "./connections";
import { i18n } from "./i18n";
import { beginLogin } from "./oauth";
import { currentProvider } from "./provider";
import { useSession } from "./session";

const ASKED_KEY = "hearthroom.presetConsentAskedAt";
const ASK_WINDOW = 2 * 60_000;
function recentlyAsked(): boolean {
  try { return Date.now() - Number(sessionStorage.getItem(ASKED_KEY) || 0) < ASK_WINDOW; } catch { return false; }
}

export function usePresetAccess() {
  const session = useSession();
  const route = useRoute();
  const provider = currentProvider();
  const needsConsent = ref(false);
  const account = computed(() => session.profile?.identities.find((i) => i.provider === provider)?.externalId ?? session.me?.accountNumId);

  async function token(): Promise<string> {
    const value = await accountToken(provider, account.value);
    if (!value) throw new Error(i18n.global.t("auth.expired"));
    return value;
  }

  /**
   * 是授權缺權限的錯就記下來並回 true，呼叫端不必再顯示錯誤。剛同意完回來還是缺（例如站台這邊
   * 還沒開這兩項授權），就不再請他同意——那只會一直繞圈——回 false 讓呼叫端照一般錯誤講。
   */
  function consentNeeded(err: unknown): boolean {
    if (!(err instanceof ApiError && err.code === "insufficient_scope")) return false;
    if (recentlyAsked()) return false;
    needsConsent.value = true;
    return true;
  }

  function reauthorize() {
    try { sessionStorage.setItem(ASKED_KEY, String(Date.now())); } catch { /* 存不了：最多多問一次 */ }
    void beginLogin(route.fullPath, { provider });
  }

  return { token, needsConsent, consentNeeded, reauthorize };
}

/** 一次寫入操作的冪等鍵：同一個動作重送沿用，換一個動作才換新的。 */
export function operationKeys() {
  const keys = new Map<string, string>();
  return {
    key(action: string): string {
      let k = keys.get(action);
      if (!k) keys.set(action, (k = crypto.randomUUID()));
      return k;
    },
    done(action: string) { keys.delete(action); },
  };
}
