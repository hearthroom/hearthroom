<script setup lang="ts">
/**
 * 卡片頁的榜單榮譽：標籤列最前面放每個期別最高的那枚（徽章＋完整名稱），後面接「榮譽 N」，
 * 點任何一枚都開「卡片榮譽」對話框列出全部（新頒發的在前）。這個元件只輸出 <li>，放在卡片頁的標籤列裡。
 * 全部榮譽要另外讀一次；只有封面有榮譽的卡才讀，沒有榮譽的卡不多打一次請求。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { fetchCardHonors } from "@/lib/api";
import { wrapTab } from "@/lib/focus-trap";
import { coverHonors, honorKey, honorName, periodLabel, type CardHonor, type Honor } from "@/lib/honors";
import BadgeLabel from "./BadgeLabel.vue";

const props = defineProps<{ cardId: string; honors?: Honor[] }>();
const { t, locale } = useI18n();
const top = computed(() => coverHonors(props.honors ?? []));
const all = ref<CardHonor[] | null>(null);
const failed = ref(false);
let generation = 0;
async function load() {
  const n = ++generation;
  all.value = null; failed.value = false;
  if (!top.value.length) return;
  try { const items = await fetchCardHonors(props.cardId); if (n === generation) all.value = items; }
  catch { if (n === generation) failed.value = true; }
}
watch(() => [props.cardId, top.value.map(honorKey).join()], load, { immediate: true });

const issued = (at: number) => new Intl.DateTimeFormat(locale.value, { month: "short", day: "numeric" }).format(at);

const opened = ref(false);
const box = ref<HTMLElement | null>(null);
let opener: HTMLElement | null = null;
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") return void close();
  wrapTab(e, box.value);
}
async function open(e: Event) {
  opener = e.currentTarget as HTMLElement | null;
  opened.value = true;
  if (failed.value) void load();
  document.addEventListener("keydown", onKey);
  await nextTick();
  box.value?.querySelector<HTMLElement>(".card-honors__close")?.focus();
}
async function close() {
  document.removeEventListener("keydown", onKey);
  opened.value = false;
  await nextTick();
  if (opener?.isConnected) opener.focus();
  opener = null;
}
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <template v-if="top.length">
    <li v-for="honor in top" :key="honor.window">
      <BadgeLabel as="button" :honor="honor" :text="honorName(t, honor)" size="lg" class="card-honors__label" aria-haspopup="dialog" @click="open" />
    </li>
    <li v-if="all?.length">
      <button type="button" class="chip card-honors__more" aria-haspopup="dialog" :aria-label="t('honor.chipAria', { n: all.length })" @click="open">{{ t("honor.chip", { n: all.length }, all.length) }}</button>
    </li>
  </template>
  <Teleport to="body">
    <div v-if="opened" class="modal-backdrop" @click.self="close">
      <div ref="box" class="modal panel card-honors" role="dialog" aria-modal="true" aria-labelledby="card-honors-title">
        <h2 id="card-honors-title" class="modal__title">{{ t("honor.dialogTitle") }}</h2>
        <p v-if="failed" class="notice notice--error" role="alert">{{ t("badgeWall.loadFailed") }} <button type="button" class="btn btn--sm" @click="load">{{ t("badgeWall.retry") }}</button></p>
        <div v-else-if="!all" class="card-honors__loading" aria-busy="true"><div v-for="i in 3" :key="i" class="ghost" /></div>
        <ul v-else class="card-honors__list">
          <li v-for="item in all" :key="honorKey(item) + item.period">
            <BadgeLabel :honor="item" :text="honorName(t, item)" size="lg" />
            <span class="card-honors__when">
              <span>{{ periodLabel(item.window, item.period, locale) }}</span>
              <span class="subtle">{{ t("honor.issuedAt", { date: issued(item.at) }) }}</span>
            </span>
          </li>
        </ul>
        <div class="modal__actions"><button type="button" class="btn card-honors__close" @click="close">{{ t("dialog.close") }}</button></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.card-honors__more { cursor: pointer; font: inherit; font-size: 12px; border: 0; color: var(--text-2); }
.card-honors__more:hover { background: var(--border); }
.card-honors { max-height: min(70dvh, calc(100dvh - 2 * var(--s-5))); grid-template-rows: auto 1fr auto; }
.card-honors__list { display: grid; gap: var(--s-3); margin: 0; padding: 8px 8px 0 0; list-style: none; overflow-y: auto; min-height: 0; }
.card-honors__list > li { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-width: 0; }
.card-honors__list :deep(.badge-label) { min-width: 0; }
.card-honors__when { display: grid; justify-items: end; flex: none; font-size: 13px; color: var(--text-2); text-align: end; font-variant-numeric: tabular-nums; }
.card-honors__loading { display: grid; gap: var(--s-3); }
.card-honors__loading .ghost { height: 34px; border-radius: var(--r-pill); }
</style>
