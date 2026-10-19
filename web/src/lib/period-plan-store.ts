/**
 * 月卡（期間方案）的持卡狀態：簽到頁的月卡列、「積分與會員」、「我的」頁與畫布宿主讀同一份。
 * 讀不到就安靜：月卡在綺夢社是附加資訊，不擋簽到與錢包（ui.md §7）。
 * 簽到時 Harbor 會代領；代領沒成功（unavailable）時，舞台關掉後自動補領一次，再失敗才給按鈕（ui.md §3.3 P4）。
 */
import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import { claimPeriodPlan, fetchMyPeriodPlans, fetchPeriodPlans, type MyPeriodPlan, type PeriodPlan, type PeriodPlanOutcome } from "./rewards";
import { clearRequestId, requestIdFor } from "./checkin";
import { todayLine, type TodayLine } from "./period-plan";
import { useSession } from "./session";

export const usePeriodPlans = defineStore("periodPlans", () => {
  const session = useSession();
  /** 方案的規則（公開清單的第一個） */
  const offer = shallowRef<PeriodPlan | null>(null);
  /** 自己的卡；沒有方案、讀不到時是 null */
  const mine = shallowRef<MyPeriodPlan | null>(null);
  const loaded = ref(false);
  const failed = ref(false);
  /** 這次簽到回來的代領結果 */
  const outcome = shallowRef<PeriodPlanOutcome | null>(null);
  /** 簽到回應帶回來、還沒揭曉的結果：開箱舞台關掉（settle）才放進 outcome，月卡列不搶在舞台前更新 */
  let pending: PeriodPlanOutcome | null = null;
  /** 自動補領也沒成功 */
  const missed = ref(false);
  const claiming = ref(false);
  let retried = false;
  let inflight: Promise<void> | null = null;

  function load(): Promise<void> {
    if (inflight) return inflight;
    inflight = (async () => {
      const [rules, own] = await Promise.allSettled([
        fetchPeriodPlans(),
        (async () => {
          const token = await session.accessToken();
          if (!token) throw new Error("signed out");
          return fetchMyPeriodPlans(token);
        })(),
      ]);
      if (rules.status === "fulfilled") offer.value = rules.value.list[0] ?? null;
      if (own.status === "fulfilled") {
        const next = own.value.list[0] ?? null;
        // 換了業務日：昨天的簽到結果與補領失敗不再算數
        if (next?.businessDay !== mine.value?.businessDay) { outcome.value = null; missed.value = false; retried = false; pending = null; }
        mine.value = next;
        failed.value = false;
      } else {
        mine.value = null;
        failed.value = true;
      }
      loaded.value = true;
    })().finally(() => { inflight = null; });
    return inflight;
  }

  /** 簽到回應帶的 periodPlan（成功或錯誤都有）。舞台關掉時由 settle 揭曉。 */
  function noteCheckin(o: PeriodPlanOutcome | undefined | null) {
    if (o) pending = o;
  }

  async function send(): Promise<boolean> {
    const plan = mine.value;
    if (!plan) return false;
    const scope = `plan:${plan.id}:${plan.businessDay}`;
    try {
      const token = await session.accessToken();
      if (!token) return false;
      const r = await claimPeriodPlan(token, plan.id, requestIdFor(scope));
      clearRequestId(scope);
      outcome.value = { status: r.status, day: r.day, credits: r.credits, bonusCredits: r.bonusCredits, replayed: r.replayed };
      return r.status === "granted";
    } catch {
      return false;
    }
  }

  /** 舞台關掉、頁面重讀時呼叫：代領沒成功就安靜地補領一次，然後重讀。 */
  async function settle(): Promise<void> {
    if (pending) { outcome.value = pending; pending = null; }
    if (outcome.value?.status === "unavailable" && !retried) {
      retried = true;
      const ok = await send();
      missed.value = !ok;
    }
    await load();
  }

  /** 「領取」按鈕。送出期間不能再按；成功時餘額一起重讀。 */
  async function claim(): Promise<boolean> {
    if (claiming.value) return false;
    claiming.value = true;
    try {
      const ok = await send();
      if (ok) {
        missed.value = false;
        await Promise.all([load(), session.refreshWallet?.()]);
      }
      return ok;
    } finally {
      claiming.value = false;
    }
  }

  /** 今天那一行。checkedIn：今天簽到過沒有，不知道就給 null。 */
  const line = (checkedIn: boolean | null): TodayLine => todayLine(mine.value, { checkedIn, outcome: outcome.value, missed: missed.value });

  function reset() { offer.value = null; mine.value = null; loaded.value = false; failed.value = false; outcome.value = null; missed.value = false; retried = false; }

  return { offer, mine, loaded, failed, outcome, missed, claiming, load, noteCheckin, settle, claim, line, reset };
});
