<script setup lang="ts">
/*
 * 卡片頁的「卡片數據」：跟預覽抽屜同一組數據、同一個順序（ui.md「卡片詳情頁」）。
 * 桌機在右欄評分之後、維持展開；手機在名字與簡介正下方、介紹之前，預設收合成一行摘要，點標題列展開（PM 2026-11-28）。
 * 只在上榜的卡出現（私卡、連結版沒有已過審的數字）；伺服器旗標沒開、或這張卡沒有任何數字就整塊不出現。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import CardQualityData from "./CardQualityData.vue";
import { ApiError } from "@/lib/api";
import { loadCardQuality } from "@/lib/card-preview";
import { useCardQualityCapability } from "@/lib/card-quality-capability";
import { qualityRate } from "@/lib/card-quality-format";
import type { CommunityCard } from "@/lib/types";
import type { CardQualityDetail } from "../../../shared/card-quality";

const props = defineProps<{ card: CommunityCard }>();
const { t } = useI18n();
const enabled = useCardQualityCapability();

const detail = ref<CardQualityDetail | null>(null);
const loading = ref(false);
const failed = ref(false);
/** 伺服器說這張卡沒有數據（404）：整塊收起來，不顯示「載入不了」 */
const absent = ref(false);
let ticket = 0;
async function load() {
  const id = props.card.id;
  const mine = ++ticket;
  loading.value = true; failed.value = false; absent.value = false; detail.value = null;
  try {
    const got = await loadCardQuality(String(id));
    if (mine === ticket) detail.value = got;
  } catch (err) {
    if (mine !== ticket) return;
    if (err instanceof ApiError && err.status === 404) absent.value = true;
    else failed.value = true;
  } finally {
    if (mine === ticket) loading.value = false;
  }
}
watch([enabled, () => props.card.id], ([on]) => { if (on) void load(); }, { immediate: true });

/* 內容區只列設定、世界書、顯示規則與呈現方式（不列篇幅總數）：這幾項都沒有時，length 有值也等於沒有可看的 */
function hasContent(l: CardQualityDetail["length"]) {
  if (!l) return false;
  const p = l.presentation;
  return l.setting !== null || l.worldbook.entries > 0 || p.displayRules > 0 || p.openingPage || p.panel;
}
const empty = computed(() => {
  const d = detail.value;
  return !!d && !hasContent(d.length) && !d.deepPlay && !d.rating && !d.comments;
});
const shown = computed(() => enabled.value && !absent.value && !empty.value);

/* 收合時的一行摘要：「續玩率 82%」；未滿合格玩家門檻就不寫摘要。篇幅總數不再出現（owner 2026-11-29） */
const summary = computed(() => {
  // 數據到了就只看數據（合格人數跌回門檻下時 deepPlay 是 null，不能拿列表那份舊的補回來）
  const deep = detail.value ? detail.value.deepPlay : props.card.qualitySignal?.deepPlay ?? null;
  return deep ? `${t("quality.retention.label")} ${qualityRate(deep.rate)}` : "";
});

const PHONE = "(max-width: 820px)";
const phone = ref(typeof matchMedia === "function" ? matchMedia(PHONE).matches : false);
const open = ref(false);
let media: MediaQueryList | undefined;
const onMedia = () => { phone.value = !!media?.matches; };
onMounted(() => { if (typeof matchMedia === "function") { media = matchMedia(PHONE); media.addEventListener?.("change", onMedia); } });
onBeforeUnmount(() => media?.removeEventListener?.("change", onMedia));
const expanded = computed(() => !phone.value || open.value);
</script>

<template>
  <section v-if="shown" class="panel cqs" aria-labelledby="card-quality-h">
    <!-- 手機：標題列整條是展開鈕（標題包著按鈕，讀屏照樣把它當標題） -->
    <h2 v-if="phone" id="card-quality-h" class="cqs__h">
      <button type="button" class="cqs__toggle" :aria-expanded="open" aria-controls="card-quality-body" @click="open = !open">
        <span class="cqs__toggle-main">
          <span>{{ $t("quality.dataTitle") }}</span>
          <span v-if="!open && summary" class="cqs__sum">{{ summary }}</span>
        </span>
        <svg class="cqs__chev" :class="{ 'cqs__chev--open': open }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
    </h2>
    <h2 v-else id="card-quality-h" class="cqs__h">{{ $t("quality.dataTitle") }}</h2>
    <div v-show="expanded" id="card-quality-body" class="cqs__body">
      <CardQualityData :detail="detail" :loading="loading" :failed="failed" @retry="load" />
    </div>
  </section>
</template>

<style scoped>
.cqs { display: grid; padding: var(--s-4); }
.cqs__h { margin: 0; font-size: 15px; font-weight: 600; }
.cqs__body { margin-top: var(--s-4); }
.cqs__toggle {
  display: flex; align-items: center; justify-content: space-between; gap: var(--s-3);
  width: 100%; min-height: var(--h-lg); margin: calc(-1 * var(--s-2)) 0; padding: 0; border: 0; background: none;
  color: inherit; font: inherit; text-align: start; cursor: pointer;
}
.cqs__toggle-main { display: grid; gap: 2px; min-width: 0; }
.cqs__sum { font-size: 13px; font-weight: 400; color: var(--text-2); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cqs__chev { flex: none; width: 18px; height: 18px; color: var(--text-3); transition: transform var(--dur) var(--ease); }
.cqs__chev--open { transform: rotate(180deg); }
</style>
