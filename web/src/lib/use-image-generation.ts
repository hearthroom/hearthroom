import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError } from "./api";
import { accountToken } from "./connections";
import { dropManagedToken } from "./managed-auth";
import type { ProviderId } from "./provider";
import { useSession } from "./session";
import { generationClient, type GenerationModel } from "./media-generation";

/** 用某個平台的登入身分叫 API：換發 token 的途中登出或換了帳號，就當過期，不拿別人的 token 送。 */
export function useProviderCredentials() {
  const session = useSession();
  const { t } = useI18n();
  return async function credentials(id: ProviderId | "") {
    if (!id) throw new Error(t("resource.choose"));
    const identity = session.profile?.identities.find((i) => i.provider === id);
    if (!identity) throw new Error(t("auth.expired"));
    const account = identity.externalId;
    const sameAccount = () => session.profile?.identities.some(i => i.provider === id && i.externalId === account);
    const token = async (rejected?: string) => {
      if (!sameAccount()) throw new ApiError(401, t("auth.expired"));
      if (rejected) dropManagedToken(id, rejected);
      const value = await accountToken(id, account, { verifyManaged: true });
      // A sign-out/account change can also happen while token renewal is in flight.
      if (!value || !sameAccount()) throw new ApiError(401, t("auth.expired"));
      return value;
    };
    await token();
    return { id, token };
  };
}

const REAUTH_KEY = "hearthroom.resources.generateReauthAt";

/**
 * 生成圖片的入口狀態（資源頁、卡片編輯器共用）：Harbor 有這組端點才出現入口（還沒上線時 404，就不顯示）；
 * 這次登入沒有 media.generate 時是 403，入口照樣出現，打開後請他重新登入授權。
 * 剛授權回來還是 403，就不再帶去登入，免得在登入頁之間繞圈。
 */
export function useImageGeneration(provider: () => ProviderId | "") {
  const { locale } = useI18n();
  const credentials = useProviderCredentials();
  const imageGen = ref<{ access: "ready" | "reauth" | "unavailable"; models: GenerationModel[] } | null>(null);
  const recentlyReauthorized = () => {
    try {
      return Date.now() - Number(sessionStorage.getItem(REAUTH_KEY) || 0) < 120_000;
    } catch {
      return false;
    }
  };
  async function generator() {
    const c = await credentials(provider());
    return generationClient(c.id, c.token);
  }
  async function probeGeneration() {
    const id = provider();
    try {
      const models = await (await generator()).models(String(locale.value));
      if (provider() === id) imageGen.value = { access: "ready", models };
    } catch (e) {
      if (provider() !== id || !(e instanceof ApiError) || e.status !== 403) return;
      imageGen.value = { access: recentlyReauthorized() ? "unavailable" : "reauth", models: [] };
    }
  }
  /** 帶去重新登入之前記一筆：回來還是 403 就說「這裡還不能生成」。 */
  function markReauthorizing() {
    try {
      sessionStorage.setItem(REAUTH_KEY, String(Date.now()));
    } catch {}
  }
  return { credentials, imageGen, generator, probeGeneration, markReauthorizing };
}
