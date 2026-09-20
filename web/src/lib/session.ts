import { PROVIDERS } from "./provider";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { fetchMe, fetchSiteMe, fetchWallet, setLoginViewer, setNsfwViewer, setViewerHiddenTags } from "./api";
import type { Me, SiteMe, Wallet } from "./api";
import {
  beginLogin,
  persist,
  refresh,
  restorePersisted,
  revokeSession,
  type TokenPair,
} from "./oauth";

/**
 * 登入狀態。
 *
 * 憑證放 localStorage 所以重新整理不會掉。access token 與 refresh token 一起放：
 * 兩者暴露面相同，而 refresh token 權限更大，只藏 access token 擋不住任何攻擊，
 * 卻讓每次重新整理都多跑一次換發。
 *
 * **restore() 與 accessToken() 都必須單飛。** refresh token 是一次性的，伺服器把
 * 重複使用視為重放並把整個 session 標成 revoked——所以兩個並發的換發不是慢一點，
 * 是兩個都死。路由守衛與 App 的 onMounted 本來就會同時觸發，這不是罕見情況。
 */
export const useSession = defineStore("session", () => {
  const token = ref<TokenPair | null>(null);
  const me = ref<Me | null>(null);
  /** 積分與會員。頁首要顯示餘額，所以跟身分一起載；讀不到不影響登入。 */
  const wallet = ref<Wallet | null>(null);
  /** 本站的身分（公開 ID、連結的帳號）。登入後問一次就建好成員；讀不到不影響登入。 */
  const profile = ref<SiteMe | null>(null);
  const ready = ref(false);
  const displayName = computed(() => profile.value?.displayName || profile.value?.handle || "HearthRoom");
  const avatarUrl = computed(() => profile.value?.avatarUrl || "");

  async function loadWallet(accessToken: string) {
    try {
      wallet.value = await fetchWallet(accessToken);
    } catch {
      wallet.value = null;
    }
  }
  /** 正在載的本站身分：公開讀取要等它到了再決定要不要帶成人內容，不然第一屏永遠是沒開的版本 */
  let profilePromise: Promise<void> | null = null;
  function loadProfile(bearerToken: string): Promise<void> {
    profilePromise = (async () => {
      try {
        profile.value = await fetchSiteMe(bearerToken);
      } catch {
        profile.value = null;
      }
    })();
    return profilePromise;
  }
  // 開了成人內容（且驗過年齡）的人：公開讀取帶 token，伺服器才給成人內容。
  // 身分還在載就先等它——卡片頁第一次讀常常比 /v1/me 早到，等一下比讀成 403 再重讀便宜。
  setNsfwViewer(async () => {
    if (profilePromise) await profilePromise;
    return profile.value?.showNsfw && profile.value.ageVerified ? await accessToken() : null;
  });
  // 登入了就給卡片頁一把 token：作者看自己還沒上榜的卡要靠它（伺服器只對作者本人放行）
  setLoginViewer(async () => (me.value ? await accessToken() : null));
  // 不想看的類型：同樣等身分載好再答，第一屏就是過濾好的版本
  setViewerHiddenTags(async () => {
    if (profilePromise) await profilePromise;
    return profile.value?.hiddenTags ?? [];
  });

  let restoring: Promise<void> | null = null;

  async function adopt(pair: TokenPair) {
    token.value = pair;
    persist(pair);
    me.value = await fetchMe(pair.accessToken);
    void loadWallet(pair.accessToken);
    void loadProfile(pair.accessToken);
  }

  function restore(): Promise<void> {
    if (ready.value) return Promise.resolve();
    // 存 Promise 而不是等 finally 裡的旗標——旗標在非同步邊界之前都還是舊值，
    // 並發的呼叫者會全部通過守衛。
    if (restoring) return restoring;

    restoring = (async () => {
      try {
        // 還沒過期就直接用，一次網路都不用跑。
        const saved = restorePersisted();
        if (saved) {
          token.value = saved;
          me.value = await fetchMe(saved.accessToken);
          void loadWallet(saved.accessToken);
          void loadProfile(saved.accessToken);
          return;
        }
        const pair = await refresh();
        if (pair) await adopt(pair);
      } catch {
        token.value = null;
        me.value = null;
      } finally {
        ready.value = true;
        restoring = null;
      }
    })();
    return restoring;
  }

  /** 每次用之前檢查有效期，過期就換新的；換不到就是真的登出了。 */
  async function accessToken(): Promise<string | null> {
    if (token.value && token.value.expiresAt > Date.now()) return token.value.accessToken;
    // refresh() 自己是單飛的，這裡並發呼叫也只會有一次換發。
    const pair = await refresh();
    if (!pair) {
      token.value = null;
      me.value = null;
      return null;
    }
    await adopt(pair);
    return pair.accessToken;
  }

  async function logout() {
    token.value = null;
    me.value = null;
    wallet.value = null;
    profile.value = null;
    setNsfwViewer(null);
    setLoginViewer(null);
    await Promise.all(PROVIDERS.map(provider => revokeSession(provider.id)));
  }

  async function ensureProfile() { if (profilePromise) await profilePromise; }

  /** 剛充完值回來、或想看最新餘額時呼叫。 */
  async function refreshWallet() {
    const t = await accessToken();
    if (t) await loadWallet(t);
  }

  /** 重新向供應商授權（真正開始 OAuth）。進站的「登入」一律先到本站的登入頁（/login），由那一頁呼叫這個。 */
  return { displayName, avatarUrl, token, me, wallet, profile, ready, adopt, restore, accessToken, ensureProfile, refreshWallet, logout, login: beginLogin };
});
