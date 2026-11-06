<script setup lang="ts">
/**
 * 「卡片榮譽」對話框：一張卡拿過的全部榮譽，每一筆寫期別與頒發日（新頒發的在前）。
 * 卡片頁標籤列那顆榮譽 chip（CardHonors）與對話頁卡片資訊面板的榜單分頁（PlayInfoRankings）共用。
 * 開的人用 v-if 掛它；關掉時送 close，焦點由開的人還給原本那顆按鈕。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { wrapTab } from "@/lib/focus-trap";
import { honorKey, honorName, periodLabel, type CardHonor } from "@/lib/honors";
import BadgeLabel from "./BadgeLabel.vue";

defineProps<{ items: CardHonor[] | null; failed: boolean }>();
const emit = defineEmits<{ (e: "close"): void; (e: "retry"): void }>();
const { t, locale } = useI18n();
const box = ref<HTMLElement | null>(null);

const issued = (at: number) => new Intl.DateTimeFormat(locale.value, { month: "short", day: "numeric" }).format(at);

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); emit("close"); return; }
  wrapTab(e, box.value);
}
onMounted(async () => {
  document.addEventListener("keydown", onKey);
  await nextTick();
  box.value?.querySelector<HTMLElement>(".card-honors__close")?.focus();
});
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div ref="box" class="modal panel card-honors" role="dialog" aria-modal="true" aria-labelledby="card-honors-title">
        <h2 id="card-honors-title" class="modal__title">{{ t("honor.dialogTitle") }}</h2>
        <p v-if="failed" class="notice notice--error" role="alert">{{ t("badgeWall.loadFailed") }} <button type="button" class="btn btn--sm" @click="emit('retry')">{{ t("badgeWall.retry") }}</button></p>
        <div v-else-if="!items" class="card-honors__loading" aria-busy="true"><div v-for="i in 3" :key="i" class="ghost" /></div>
        <ul v-else class="card-honors__list">
          <li v-for="item in items" :key="honorKey(item) + item.period">
            <BadgeLabel :honor="item" :text="honorName(t, item)" size="lg" />
            <span class="card-honors__when">
              <span>{{ periodLabel(item.window, item.period, locale) }}</span>
              <span class="subtle">{{ t("honor.issuedAt", { date: issued(item.at) }) }}</span>
            </span>
          </li>
        </ul>
        <div class="modal__actions"><button type="button" class="btn card-honors__close" @click="emit('close')">{{ t("dialog.close") }}</button></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.card-honors { max-height: min(70dvh, calc(100dvh - 2 * var(--s-5))); grid-template-rows: auto 1fr auto; }
.card-honors__list { display: grid; gap: var(--s-3); margin: 0; padding: 8px 8px 0 0; list-style: none; overflow-y: auto; min-height: 0; }
.card-honors__list > li { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-width: 0; }
.card-honors__list :deep(.badge-label) { min-width: 0; }
.card-honors__when { display: grid; justify-items: end; flex: none; font-size: 13px; color: var(--text-2); text-align: end; font-variant-numeric: tabular-nums; }
.card-honors__loading { display: grid; gap: var(--s-3); }
.card-honors__loading .ghost { height: 34px; border-radius: var(--r-pill); }
</style>
