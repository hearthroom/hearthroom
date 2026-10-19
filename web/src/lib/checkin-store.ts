/**
 * 簽到與任務的狀態：簽到頁、「我的」頁入口卡、首頁 chip、帳號選單的點都讀同一份面板。
 * 面板只在需要時讀（進簽到頁、回到分頁、登入後一次），不輪詢。
 */
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import {
  checkin as postCheckin, claimNewcomer as postNewcomer, claimTask as postTask, fetchPanel, fetchPlan, forgetCurrentPlan, makeup as postMakeup,
  RewardsError, type CheckinResponse, type ClaimResult, type RewardPlan, type RewardsPanel, type RewardTask,
} from "./rewards";
import { clearRequestId, hasRequestId, requestIdFor } from "./checkin";
import { useSession } from "./session";

export const useCheckin = defineStore("checkin", () => {
  const session = useSession();
  const panel = shallowRef<RewardsPanel | null>(null);
  const plan = shallowRef<RewardPlan | null>(null);
  /** 讀回面板那一刻的本機時間：倒數用伺服器時間加上之後經過的時間 */
  const fetchedAt = ref(0);
  const loading = ref(false);
  const error = ref<RewardsError | Error | null>(null);
  /** 這個帳號的應用沒有開獎勵（rewards_disabled）：入口全部不出現 */
  const disabled = ref(false);
  let inflight: Promise<void> | null = null;

  async function token(): Promise<string> {
    const t = await session.accessToken();
    if (!t) throw new RewardsError(401, "", "unauthorized");
    return t;
  }

  async function ensurePlan(version?: number): Promise<RewardPlan> {
    if (plan.value && (version == null || plan.value.version === version)) return plan.value;
    if (version != null && plan.value && plan.value.version !== version) forgetCurrentPlan();
    plan.value = await fetchPlan();
    return plan.value;
  }

  function load(): Promise<void> {
    if (inflight) return inflight;
    loading.value = true;
    inflight = (async () => {
      try {
        const p = await fetchPanel(await token());
        panel.value = p;
        fetchedAt.value = Date.now();
        error.value = null;
        disabled.value = false;
        await ensurePlan(p.planVersion).catch(() => undefined);
      } catch (e) {
        if (e instanceof RewardsError && e.code === "rewards_disabled") disabled.value = true;
        error.value = e as Error;
      } finally {
        loading.value = false;
        inflight = null;
      }
    })();
    return inflight;
  }

  /**
   * 簽到：冪等鍵以業務日為範圍，重新整理或網路斷掉後再按一次會拿回同一個結果。
   * 回應到了才清掉鍵；失敗時留著，重試用同一個。
   */
  async function checkin(): Promise<CheckinResponse & { elsewhere: boolean }> {
    const scope = `checkin:${panel.value?.businessDay ?? "today"}`;
    const ours = hasRequestId(scope);
    const res = await postCheckin(await token(), requestIdFor(scope));
    clearRequestId(scope);
    // 伺服器說已經簽過、而這個分頁沒有送過：是別的裝置先簽了，舞台直接講結果，不轉滾輪
    return { ...res, elsewhere: res.replayed && !ours };
  }

  async function makeup(day: string): Promise<CheckinResponse> {
    const scope = `makeup:${day}`;
    const res = await postMakeup(await token(), requestIdFor(scope), day);
    clearRequestId(scope);
    return res;
  }

  async function claimTask(task: RewardTask): Promise<ClaimResult> {
    const scope = `task:${task.id}:${task.period}`;
    try {
      const { claim } = await postTask(await token(), task.id, task.period, requestIdFor(scope));
      clearRequestId(scope);
      return claim;
    } catch (e) {
      // 已經領過：伺服器附上原結果，當成功
      if (e instanceof RewardsError && e.code === "already_claimed" && e.original && "status" in e.original) { clearRequestId(scope); return e.original as ClaimResult; }
      throw e;
    }
  }

  async function claimNewcomer(): Promise<ClaimResult> {
    const scope = `newcomer:${panel.value?.businessDay ?? "today"}`;
    const { claim } = await postNewcomer(await token(), requestIdFor(scope));
    clearRequestId(scope);
    return claim;
  }

  const claimableTasks = computed(() => {
    const t = panel.value?.tasks;
    if (!t) return 0;
    return [...t.daily, ...t.weekly, ...(t.dailyAll ? [t.dailyAll] : [])].filter((x) => x.status === "claimable").length;
  });
  /** 今天還沒簽：帳號選單的點、「我的」頁與首頁 chip 用 */
  const canCheckIn = computed(() => !!panel.value && !panel.value.checkin.todayClaimed);

  function reset() { panel.value = null; plan.value = null; error.value = null; disabled.value = false; }

  return { panel, plan, fetchedAt, loading, error, disabled, load, ensurePlan, checkin, makeup, claimTask, claimNewcomer, claimableTasks, canCheckIn, reset };
});
