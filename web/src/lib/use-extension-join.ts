/**
 * 「加入」一個擴充：工坊列表與擴充詳情共用。
 *
 *   沒登入 → 先去登入，回到原頁（加入是個人的清單，遊客沒有地方存）
 *   分級高於原卡 → 先過年齡確認：沒驗過或聲明是舊版走成人內容聲明窗（AdultConsentDialog，由呼叫端畫），
 *                 已經同意過的只問一次「這個擴充含成人內容」
 *   加入 → toast「已加入「名稱」」；移除另給「復原」
 */
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "./api";
import { needsAdultConsent, viewerAdult } from "./adult-consent";
import { confirmDialog } from "./confirm";
import { joinExtension, leaveExtension, type CardWorkshopState } from "./card-workshop";
import { loginPath } from "./login-return";
import { useSession } from "./session";
import { useLocalePath } from "./use-locale";
import type { ExtensionSummary } from "./workshop";

export function useExtensionJoin(state: () => CardWorkshopState | null, say: (text: string, undo?: () => void) => void) {
  const session = useSession();
  const router = useRouter();
  const route = useRoute();
  const { lp } = useLocalePath();
  const { t } = useI18n();
  /** 要先填成人內容聲明：呼叫端看到它就畫 AdultConsentDialog，done 時呼叫 adultDone */
  const askingAdult = ref<ExtensionSummary | null>(null);
  const busy = ref<string | null>(null);

  async function token(): Promise<string | null> {
    if (!session.me) { await router.push(lp(loginPath(route.fullPath))); return null; }
    const tk = await session.accessToken();
    if (!tk) await router.push(lp(loginPath(route.fullPath)));
    return tk;
  }

  async function doJoin(ext: Pick<ExtensionSummary, "id" | "name">) {
    const s = state();
    const tk = s && (await token());
    if (!s || !tk) return;
    busy.value = ext.id;
    try {
      await joinExtension(s, ext.id, tk);
      say(t("workshop.toast.added", { name: ext.name }));
    } catch (err) {
      if (err instanceof ApiError && err.code === "adult_content") { askingAdult.value = ext as ExtensionSummary; return; }
      say(err instanceof Error ? err.message : t("state.actionFailed"));
    } finally {
      busy.value = null;
    }
  }

  async function join(ext: ExtensionSummary) {
    if (!session.me) { await token(); return; }
    if (ext.adult) {
      const adult = viewerAdult(session);
      if (needsAdultConsent(adult) || !adult?.showNsfw) { askingAdult.value = ext; return; }
      const ok = await confirmDialog({ title: t("workshop.age.title"), message: t("workshop.age.body"), confirmText: t("workshop.age.confirm"), focusCancel: true, phraseWrap: true });
      if (!ok) return;
    }
    await doJoin(ext);
  }
  async function adultDone() {
    const ext = askingAdult.value;
    askingAdult.value = null;
    if (ext) await doJoin(ext);
  }

  async function leave(ext: Pick<ExtensionSummary, "id" | "name">) {
    const s = state();
    const tk = s && (await token());
    if (!s || !tk) return;
    busy.value = ext.id;
    try {
      await leaveExtension(s, ext.id, tk);
      // 移除可逆：給「復原」，不跳確認框
      say(t("workshop.toast.removed", { name: ext.name }), () => { void doJoin(ext); });
    } catch (err) {
      say(err instanceof Error ? err.message : t("state.actionFailed"));
    } finally {
      busy.value = null;
    }
  }

  return { join, leave, adultDone, askingAdult, busy };
}
