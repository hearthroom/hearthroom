/**
 * 遊玩畫布「積分不夠」時，宿主（綺夢社）給畫布的說法與兩條路（ui.md §7.2、PM 裁定 Q6）：
 *   - 今日任務還能拿 N 積分 → 簽到頁的任務區（N 是今天還沒領的任務積分加總；0 就不給這條）
 *   - 儲值 → 既有的儲值頁（第二期月卡上線後換成月卡）
 * 新分頁開，網址要是絕對網址：沙箱卡的殼在別的網域。中性標籤，不寫說教句。
 */
import type { RewardsPanel } from "./rewards";

export interface RecoveryOptions {
  origin: string;
  lp: (path: string) => string;
  t: (key: string, params?: Record<string, unknown>) => string;
  whole: (n: number) => string;
  topUp: string;
}

export function creditsRecovery(panel: RewardsPanel | null, shortfall: { needed: number; available: number } | null, o: RecoveryOptions) {
  const left = (panel?.tasks.daily ?? [])
    .filter((task) => task.status === "locked" || task.status === "claimable")
    .reduce((sum, task) => sum + (task.reward.credits ?? 0), 0);
  const links: { id: string; label: string; href: string }[] = [];
  if (left > 0) links.push({ id: "tasks", label: o.t("credits.recovery.taskLeft", { n: o.whole(left) }), href: `${o.origin}${o.lp("/checkin")}#tasks` });
  links.push({ id: "topup", label: o.t("credits.recovery.topup"), href: o.topUp });
  return {
    title: shortfall ? o.t("credits.recovery.title") : undefined,
    body: shortfall ? o.t("credits.recovery.body", { need: o.whole(shortfall.needed), have: o.whole(shortfall.available) }) : undefined,
    links,
  };
}
