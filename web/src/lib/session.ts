import { defineStore } from "pinia";
import { ref } from "vue";
import { fetchMe } from "./api";
import type { Me } from "./api";
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
  const ready = ref(false);

  let restoring: Promise<void> | null = null;

  async function adopt(pair: TokenPair) {
    token.value = pair;
    persist(pair);
    me.value = await fetchMe(pair.accessToken);
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
    await revokeSession();
  }

  return { token, me, ready, adopt, restore, accessToken, logout, login: beginLogin };
});
