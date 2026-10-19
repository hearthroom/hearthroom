/**
 * 桌寵的兩句每天一次的提醒（ui.md §1、§7.1；copy.md §9.4）：
 *   - 今天還沒簽到：「今天的寶箱我幫你捧來了」，附「去開箱」；新手七日期間換成當天的那一句
 *   - 有限時積分今天或明天到期：提醒先拿去聊一段（她不講數字與時間，那些在簽到頁與錢包）
 * 一天最多一次由桌寵自己管（daily 事件）；在簽到頁上就不說，人已經在那裡了。
 */
import { watch } from "vue";
import type { Router } from "vue-router";
import { i18n } from "./i18n";
import { expiryNotice, newcomerView } from "./checkin";
import { useCheckin } from "./checkin-store";
import { suki } from "../pet/events";

export function watchCheckinNudges(router: Router, lp: (p: string) => string): void {
  const store = useCheckin();
  const t = i18n.global.t;
  watch(() => store.panel, (p) => {
    if (!p || /\/checkin(\/|$)/.test(router.currentRoute.value.path)) return;
    const go = { label: t("suki.daily.checkin.action"), run: () => { void router.push(lp("/checkin")); } };
    if (!p.checkin.todayClaimed) {
      const nc = newcomerView(p);
      suki({ type: "daily", key: "checkin-chest", text: nc && !nc.todayDone ? t(`newcomer.suki.${nc.day}`) : t("suki.daily.checkin"), action: go });
    }
    const soon = expiryNotice(p.credits?.expiring ?? [], Date.now());
    if (soon) suki({ type: "daily", key: "credits-expiry", text: t(soon.key === "credits.expiry.today" ? "suki.daily.expiry.today" : "suki.daily.expiry.tomorrow") });
  });
}
