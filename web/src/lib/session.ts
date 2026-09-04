import { defineStore } from "pinia";
import { ref } from "vue";
import { fetchMe } from "./api";
import type { Me } from "./api";
import { beginLogin, forgetSession, refresh, type TokenPair } from "./oauth";

/**
 * 登入狀態。
 *
 * access token 只放在記憶體，不寫 localStorage——那裡的東西任何 XSS 都拿得到。
 * 只有 refresh token 落地（換 access token 時還要配上 PKCE 註冊的 client_id）。
 * 重新整理後由 restore() 靜默換一顆新的。
 */
export const useSession = defineStore("session", () => {
  const token = ref<TokenPair | null>(null);
  const me = ref<Me | null>(null);
  const ready = ref(false);

  async function adopt(pair: TokenPair) {
    token.value = pair;
    me.value = await fetchMe(pair.accessToken);
  }

  async function restore() {
    if (ready.value) return;
    try {
      const pair = await refresh();
      if (pair) await adopt(pair);
    } catch {
      token.value = null;
      me.value = null;
    } finally {
      ready.value = true;
    }
  }

  /** 每次用之前檢查有效期，過期就換新的；換不到就是真的登出了。 */
  async function accessToken(): Promise<string | null> {
    if (token.value && token.value.expiresAt > Date.now()) return token.value.accessToken;
    const pair = await refresh();
    if (!pair) {
      token.value = null;
      me.value = null;
      return null;
    }
    await adopt(pair);
    return pair.accessToken;
  }

  function logout() {
    forgetSession();
    token.value = null;
    me.value = null;
  }

  return { token, me, ready, adopt, restore, accessToken, logout, login: beginLogin };
});
