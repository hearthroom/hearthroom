<script setup lang="ts">
/**
 * 卡片頁的榜單榮譽：標籤列最前面一顆 chip，和 #標籤 同高——小徽章＋這張卡最高的那一個榮譽，拿過不只一個時後面接「+其他幾個」；
 * 點了開「卡片榮譽」對話框（CardHonorsDialog）列出全部（新頒發的在前）。沒有榮譽時整顆不出現。這個元件只輸出 <li>，放在卡片頁的標籤列裡。
 * （原本是每個期別一顆 34 高的標籤再接「榮譽 N」，和 26 高的 #標籤 大小不一，owner 2026-11-03 退回。）
 * 全部榮譽要另外讀一次；只有封面有榮譽的卡才讀，沒有榮譽的卡不多打一次請求。
 */
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { fetchCardHonors } from "@/lib/api";
import { bestHonor, coverHonors, honorKey, honorName, type CardHonor, type Honor } from "@/lib/honors";
import CardHonorsDialog from "./CardHonorsDialog.vue";
import RankBadge from "./RankBadge.vue";

const props = defineProps<{ cardId: string; honors?: Honor[] }>();
const { t } = useI18n();
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

const opened = ref(false);
let opener: HTMLElement | null = null;
function open(e: Event) {
  opener = e.currentTarget as HTMLElement | null;
  opened.value = true;
  if (failed.value) void load();
}
async function close() {
  opened.value = false;
  await nextTick();
  if (opener?.isConnected) opener.focus();
  opener = null;
}
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
  <CardHonorsDialog v-if="opened" :items="all" :failed="failed" @close="close" @retry="load" />
</template>

<style scoped>
.card-honors__item { display: flex; align-items: center; min-width: 0; }
/* 和 #標籤 同一種 chip（26 高、12px），徽章縮到 20 高放進去；名字可省略，數字不省略 */
.card-honors__chip { cursor: pointer; font: inherit; font-size: 12px; max-width: 100%; padding-left: 4px; gap: 5px; --rank-badge-h: 20px; }
.card-honors__chip:hover { background: var(--border); }
.card-honors__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.card-honors__count { flex: none; font-variant-numeric: tabular-nums; }
</style>
