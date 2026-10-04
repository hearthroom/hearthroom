<script setup lang="ts">
/**
 * 首頁的一行更新提示：有新功能上線、讀者還沒看過時，在排序列上方出現一行。
 *
 * 不浮在畫面上、跟著頁面捲走；關掉、點了、或去過更新頁，20 小時內都不再出現；
 * 三天沒理會就自己收起來（規則在 lib/updates.ts）。只有修正的日子不出現。
 * Android 下載橫幅出現時讓位：手機首屏留給卡片（owner 2026-10-02），下載橫幅與加到主畫面提示維持原狀（owner 2026-09-25）。
 */
import { computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { isStandalone } from "@/lib/pwa";
import { readAndroidBannerDismissed, shouldShowAndroidBanner } from "@/lib/download";
import { track } from "@/lib/track";
import { useUpdates } from "@/lib/updates";
import { useLocalePath } from "@/lib/use-locale";

const { t } = useI18n();
const { lp, locale } = useLocalePath();
const store = useUpdates();
const yielded = shouldShowAndroidBanner({ ua: navigator.userAgent, standalone: isStandalone(), dismissed: readAndroidBannerDismissed() });
const decision = computed(() => (yielded ? null : store.strip));
const top = computed(() => (decision.value?.show ? decision.value.top : null));
const more = computed(() => (decision.value?.show ? decision.value.more : 0));
const target = computed(() => (top.value?.try ? lp(top.value.try) : `${lp("/updates")}?from=strip`));

let reported = "";
watch(top, (item) => {
  if (!item) { store.settleStrip(); return; }
  store.stripShown();
  if (reported !== item.id) { reported = item.id; track("updates_strip", { detail: "shown", subject: item.id }); }
}, { immediate: true });
onMounted(() => { void store.load(locale.value); });

function go() {
  if (!top.value) return;
  track("updates_strip", { detail: "clicked", subject: top.value.id });
  track("update_try", { detail: "strip", subject: top.value.id });
  store.acknowledgeAll(true);
}
function all() {
  if (top.value) track("updates_strip", { detail: "clicked", subject: top.value.id });
  store.acknowledgeAll(true);
}
function close() {
  if (top.value) track("updates_strip", { detail: "dismissed", subject: top.value.id });
  store.acknowledgeAll(true);
}
</script>

<template>
  <aside v-if="top" class="update-strip" :aria-label="t('updates.strip.label')">
    <svg class="update-strip__icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6zM15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></svg>
    <RouterLink class="update-strip__title" :to="target" @click="go">{{ top.title }}</RouterLink>
    <RouterLink class="update-strip__go" :to="target" tabindex="-1" aria-hidden="true" @click="go">{{ t("updates.strip.go") }} →</RouterLink>
    <RouterLink class="update-strip__more" :to="`${lp('/updates')}?from=strip`" :aria-label="more ? t('updates.strip.more', { n: more }, more) : t('updates.strip.all')" @click="all">
      <span class="update-strip__long">{{ more ? t("updates.strip.more", { n: more }, more) : t("updates.strip.all") }}</span>
      <span class="update-strip__short" aria-hidden="true">{{ more ? t("updates.strip.moreShort", { n: more }, more) : t("updates.strip.allShort") }}</span>
    </RouterLink>
    <button type="button" class="btn btn--icon btn--sm btn--ghost update-strip__close" :aria-label="t('dialog.close')" @click="close">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" /></svg>
    </button>
  </aside>
</template>

<style scoped>
.update-strip {
  display: flex; align-items: center; gap: var(--s-3); min-width: 0;
  margin-bottom: var(--s-4); padding: var(--s-2) var(--s-2) var(--s-2) var(--s-4);
  border-radius: var(--r-md); background: var(--accent-tint); color: var(--text);
  font-size: 14px;
}
.update-strip__icon { flex: none; width: 16px; height: 16px; fill: var(--accent-text); }
.update-strip__title { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--text); font-weight: 600; }
.update-strip__title:hover { color: var(--accent-text); }
.update-strip__go, .update-strip__more { flex: none; white-space: nowrap; color: var(--accent-text); font-weight: 600; }
.update-strip__more { color: var(--text-2); font-weight: 500; }
.update-strip__more:hover { color: var(--accent-text); }
.update-strip__close { flex: none; }
.update-strip__close svg { width: 16px; height: 16px; }
.update-strip__short { display: none; }
/* 手機：標題本身就是「去看看」，省下那顆字；「還有幾項」縮短但留著，那是去更新頁的路 */
@media (max-width: 640px) {
  .update-strip { gap: var(--s-2); }
  .update-strip__go, .update-strip__long { display: none; }
  .update-strip__short { display: inline; }
}
</style>
