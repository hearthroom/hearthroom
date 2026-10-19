/**
 * 遊玩畫布「積分不夠」時，宿主（綺夢社）給畫布的說法與兩條路（ui.md §7.2、PM 裁定 Q6）：
 *   - 今日任務還能拿 N 積分 → 簽到頁的任務區（N 是今天還沒領的任務積分加總；0 就不給這條）
 *   - 月卡 → Console 帳單頁的月卡分段；停售、疊到上限、沒有方案時退回儲值（任務 2026-10-19-month-card-surfaces ui.md §5.2）
 * 新分頁開，網址要是絕對網址：沙箱卡的殼在別的網域。中性標籤，不寫說教句。
 */
import type { PeriodPlan, RewardsPanel } from "./rewards";
import type { RouteLocationNormalizedLoaded, Router } from "vue-router";
import { purchaseLink } from "./period-plan";
import { track } from "./track";

/** 從「積分不夠」那張卡點出去的連結都帶這個 from，落地頁才數得到是從這裡來的 */
export const SHORTFALL_FROM = "canvas_shortfall";

export interface RecoveryOptions {
  origin: string;
  lp: (path: string) => string;
  t: (key: string, params?: Record<string, unknown>) => string;
  whole: (n: number) => string;
  topUp: string;
  /** 月卡：方案（沒有就 null）與這個帳號現在買不買得了（持卡狀態沒讀到時是 null） */
  plan?: { offer: Pick<PeriodPlan, "onSale" | "purchaseUrl"> | null; canPurchase: boolean | null };
}

export function creditsRecovery(panel: RewardsPanel | null, shortfall: { needed: number; available: number } | null, o: RecoveryOptions) {
  const left = (panel?.tasks.daily ?? [])
    .filter((task) => task.status === "locked" || task.status === "claimable")
    .reduce((sum, task) => sum + (task.reward.credits ?? 0), 0);
  const links: { id: string; label: string; href: string }[] = [];
  if (left > 0) links.push({ id: "tasks", label: o.t("credits.recovery.taskLeft", { n: o.whole(left) }), href: `${o.origin}${o.lp("/checkin")}?from=${SHORTFALL_FROM}#tasks` });
  if (o.plan?.offer?.onSale && o.plan.canPurchase !== false) links.push({ id: "plan", label: o.t("plan.canvas.action"), href: purchaseLink(o.plan.offer) });
  else links.push({ id: "topup", label: o.t("credits.recovery.topup"), href: o.topUp });
  return {
    title: shortfall ? o.t("credits.recovery.title") : undefined,
    body: shortfall ? o.t("credits.recovery.body", { need: o.whole(shortfall.needed), have: o.whole(shortfall.available) }) : undefined,
    links,
  };
}

/*
 * B7 讀回要看得到這張卡真的出現、兩條路有人點（PM 2026-10-20）。不帶任何帳號、卡或對話的識別。
 * 畫布每次重畫都會問宿主一次：同一張卡（同一份 shortfall）只記一次；沒有數字的卡認不出是不是同一張，
 * 就半分鐘最多記一次。
 */
const shownCards = new WeakSet<object>();
let lastShownWithoutNumbers = 0;
export function noteShortfallShown(shortfall: { needed: number; available: number } | null, now = Date.now()): void {
  if (shortfall) {
    if (shownCards.has(shortfall)) return;
    shownCards.add(shortfall);
  } else {
    if (now - lastShownWithoutNumbers < 30_000) return;
    lastShownWithoutNumbers = now;
  }
  track("credits_shortfall_shown");
}

/** 落地頁（簽到頁、月卡入口）：從那張卡點進來的記一次，然後把 from 從網址拿掉，重新整理不會再算 */
export function noteShortfallLanding(
  route: Pick<RouteLocationNormalizedLoaded, "query" | "hash">,
  router: Pick<Router, "replace">,
  path: "checkin" | "plan",
): void {
  if (route.query.from !== SHORTFALL_FROM) return;
  track("credits_shortfall_click", { detail: path });
  const { from: _from, ...query } = route.query;
  void router.replace({ query, hash: route.hash });
}
