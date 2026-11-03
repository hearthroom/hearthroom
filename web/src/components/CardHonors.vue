<script setup lang="ts">
/**
 * 卡片頁的榜單榮譽：標籤列最前面一顆 chip，和 #標籤 同高——小徽章＋這張卡最高的那一個榮譽，拿過不只一個時後面接「+其他幾個」；
 * 點了開「卡片榮譽」對話框列出全部（新頒發的在前）。沒有榮譽時整顆不出現。這個元件只輸出 <li>，放在卡片頁的標籤列裡。
 * （原本是每個期別一顆 34 高的標籤再接「榮譽 N」，和 26 高的 #標籤 大小不一，owner 2026-11-03 退回。）
 * 全部榮譽要另外讀一次；只有封面有榮譽的卡才讀，沒有榮譽的卡不多打一次請求。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { fetchCardHonors } from "@/lib/api";
import { wrapTab } from "@/lib/focus-trap";
import { bestHonor, coverHonors, honorKey, honorName, periodLabel, type CardHonor, type Honor } from "@/lib/honors";
import BadgeLabel from "./BadgeLabel.vue";
import RankBadge from "./RankBadge.vue";

const props = defineProps<{ cardId: string; honors?: Honor[] }>();
const { t, locale } = useI18n();
const top = computed(() => coverHonors(props.honors ?? []));
const all = ref<CardHonor[] | null>(null);
/** 標籤列那一顆：讀到全部榮譽就從全部裡挑最高的，還沒讀到先用封面那幾枚 */
const best = computed(() => bestHonor(all.value?.length ? all.value : top.value));
const descId = computed(() => `card-honors-${props.cardId}`);
const failed = ref(false);
let generation = 0;
async function load() {
  const n = ++generation;
  all.value = null; failed.value = false;
  if (!top.value.length) return;
  try { const items = await fetchCardHonors(props.cardId); if (n === generation) all.value = items; }
  catch { if (n === generation) failed.value = true; }
}
// 用字串當鍵：卡片頁會先顯示快取、再換成剛讀到的同一張卡，陣列換了但內容沒變時不重讀
watch(() => `${props.cardId}|${top.value.map(honorKey).join()}`, load, { immediate: true });

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
  <li v-if="best" class="card-honors__item">
    <!-- 唸出來的名字＝看得到的字（語音操作說「清水日榜第一」要點得到）；「共幾項」放在描述裡 -->
    <button type="button" class="chip card-honors__chip" aria-haspopup="dialog" :aria-describedby="all?.length ? descId : undefined" @click="open">
      <RankBadge :honor="best" decorative />
      <span class="card-honors__name">{{ honorName(t, best) }}</span>
      <!-- 其他還有幾個，和名字旁展示列的「+N」同一種寫法（美術總監 2026-11-03） -->
      <span v-if="(all?.length ?? 0) > 1" class="card-honors__count">+{{ all!.length - 1 }}</span>
    </button>
    <span v-if="all?.length" :id="descId" class="sr-only">{{ t("honor.chipAria", { n: all.length }) }}</span>
  </li>
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
.card-honors__item { display: flex; align-items: center; min-width: 0; }
/* 和 #標籤 同一種 chip（26 高、12px），徽章縮到 20 高放進去；名字可省略，數字不省略 */
.card-honors__chip { cursor: pointer; font: inherit; font-size: 12px; max-width: 100%; padding-left: 4px; gap: 5px; --rank-badge-h: 20px; }
.card-honors__chip:hover { background: var(--border); }
.card-honors__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.card-honors__count { flex: none; font-variant-numeric: tabular-nums; }
.card-honors { max-height: min(70dvh, calc(100dvh - 2 * var(--s-5))); grid-template-rows: auto 1fr auto; }
.card-honors__list { display: grid; gap: var(--s-3); margin: 0; padding: 8px 8px 0 0; list-style: none; overflow-y: auto; min-height: 0; }
.card-honors__list > li { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-width: 0; }
.card-honors__list :deep(.badge-label) { min-width: 0; }
.card-honors__when { display: grid; justify-items: end; flex: none; font-size: 13px; color: var(--text-2); text-align: end; font-variant-numeric: tabular-nums; }
.card-honors__loading { display: grid; gap: var(--s-3); }
.card-honors__loading .ghost { height: 34px; border-radius: var(--r-pill); }
</style>
