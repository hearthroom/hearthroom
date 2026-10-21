/**
 * 按下「切換到線路三」之後的那一段，對話框與提示卡共用同一套（ui.md §4.2、§6.2）：
 * 先確認目標連得上 → 已登入再向目前線路要換手單 → 交給瀏覽器。每一步失敗都停在原地，
 * 由畫面說清楚發生什麼；取消在交給瀏覽器之前都有效（放棄＝什麼都沒發生）。
 */
import { computed, onBeforeUnmount, ref } from "vue";
import { isStandalone } from "@/lib/pwa";
import { ROUTE_TUNING, SwitchError, prepareSwitch, type Line, type SwitchFailure } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";

export function useRouteSwitch(source: "routes_dialog" | "routes_prompt") {
  const session = useSession();
  const standalone = isStandalone();
  const phase = ref<"idle" | "connecting" | "carrying">("idle");
  const failure = ref<SwitchFailure | null>(null);
  /** 目前線路自己發不出換手單：接下來的切換不帶登入（使用者按「仍然切換」才走） */
  const withoutLogin = ref(false);
  const slow = ref(false);
  const busy = computed(() => phase.value !== "idle");
  let attempt = 0;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;

  function reset() {
    attempt++;
    clearTimeout(slowTimer);
    phase.value = "idle";
    slow.value = false;
  }
  function clearFailure() {
    failure.value = null;
    withoutLogin.value = false;
  }

  async function start(line: Line): Promise<void> {
    if (busy.value) return;
    const mine = ++attempt;
    failure.value = null;
    slow.value = false;
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => { if (mine === attempt) slow.value = true; }, ROUTE_TUNING.slowStepMs);
    const carry = !!session.me && !withoutLogin.value;
    phase.value = "connecting";
    try {
      const url = await prepareSwitch(line, { withLogin: carry, onTargetReady: () => { if (mine === attempt && carry) phase.value = "carrying"; } });
      if (mine !== attempt) return;
      track(source === "routes_dialog" ? "routes_dialog" : "routes_prompt", { detail: source === "routes_dialog" ? "switched" : "switch", subject: String(line.n) });
      if (standalone) {
        // 主畫面 App 綁定安裝時的網域：跳過去會開在覆蓋層裡，改在瀏覽器新分頁開
        window.open(url, "_blank", "noopener");
        reset();
        return;
      }
      // 交給瀏覽器之後維持「正在帶上登入」，直到新頁面接手，不白屏
      location.assign(url);
    } catch (e) {
      if (mine !== attempt) return;
      reset();
      const kind: SwitchFailure = e instanceof SwitchError ? e.kind : "start-denied";
      failure.value = kind;
      if (kind === "start-unavailable") withoutLogin.value = true;
      track(source, { detail: "failed", subject: String(line.n), ok: false });
    }
  }

  onBeforeUnmount(() => { attempt++; clearTimeout(slowTimer); });
  return { phase, failure, withoutLogin, slow, busy, standalone, start, cancel: reset, clearFailure };
}
