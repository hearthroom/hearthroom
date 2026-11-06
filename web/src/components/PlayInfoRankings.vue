<script setup lang="ts">
/**
 * 卡片資訊面板的「榜單」分頁（PlayInfoPanel）。
 *
 * - 卡片榮譽：只列這張卡拿到過的（owner 2026-11-04：絕大多數卡拿不到，留空位會讓人以為每張卡都該有）。
 *   每個「榜別×期別×名次」一枚徽章標籤，拿過兩次以上寫 ×N，跟卡片頁、作者名字旁同一種長相；
 *   「查看全部 N 項」開卡片頁同一個「卡片榮譽」對話框看各期日期。封面沒有徽章的卡不打這一次請求。
 *   這裡是結算出的名次段，不是即時名次。
 * - 知音榜：只有 Harbor 供應商的卡才有，用卡片頁同一個元件的摘要版（前三名、我的名次、查看完整榜）。
 * - 兩樣都沒有：只放一行空態。榮譽與知音榜各自載入、各自失敗與重試。
 */
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import BadgeLabel from "@/components/BadgeLabel.vue";
import CardHonorsDialog from "@/components/CardHonorsDialog.vue";
import CardSpendLeaderboard from "@/components/CardSpendLeaderboard.vue";
import { fetchCardHonors } from "@/lib/api";
import { coverHonors, groupHonors, honorKey, honorName, type CardHonor } from "@/lib/honors";
import type { CommunityCard } from "@/lib/types";

const props = defineProps<{ card: CommunityCard }>();
const { t } = useI18n();

const top = computed(() => coverHonors(props.card.honors ?? []));
const all = ref<CardHonor[] | null>(null);
const failed = ref(false);
let generation = 0;
async function load() {
  const n = ++generation;
  all.value = null; failed.value = false;
  if (!top.value.length) return;
  try { const items = await fetchCardHonors(props.card.id); if (n === generation) all.value = items; }
  catch { if (n === generation) failed.value = true; }
}
// 卡片資料重讀後內容沒變（同一張卡、同一組封面徽章）就不重讀
watch(() => `${props.card.id}|${top.value.map(honorKey).join()}`, load, { immediate: true });

const groups = computed(() => groupHonors(all.value ?? []));
/** 封面沒有徽章、或讀完發現一個都沒有：整塊不畫 */
const showHonors = computed(() => top.value.length > 0 && (all.value === null || groups.value.length > 0));
const kindred = computed(() => props.card.provider === "harbor");

const opened = ref(false);
let opener: HTMLElement | null = null;
function openAll(e: Event) {
  opener = e.currentTarget as HTMLElement | null;
  opened.value = true;
}
async function closeAll() {
  opened.value = false;
  await nextTick();
  if (opener?.isConnected) opener.focus();
  opener = null;
}
</script>

<template>
  <div class="pip-rank">
    <section v-if="showHonors" class="pip-rank__honors" aria-labelledby="pip-honors-h" :aria-busy="!all && !failed ? 'true' : undefined">
      <h3 id="pip-honors-h" class="pip-rank__h">{{ t("honor.dialogTitle") }}</h3>
      <div v-if="failed" class="notice notice--error pip-rank__error" role="alert">
        <span>{{ t("play.info.honorsFailed") }}</span>
        <button type="button" class="btn btn--sm" @click="load">{{ t("spendBoard.retry") }}</button>
      </div>
      <div v-else-if="!all" class="pip-rank__labels" aria-hidden="true"><span v-for="i in 2" :key="i" class="ghost pip-rank__ghost" /></div>
      <template v-else>
        <ul class="pip-rank__labels">
          <li v-for="group in groups" :key="honorKey(group.honor)"><BadgeLabel :honor="group.honor" :text="honorName(t, group.honor)" :count="group.count" /></li>
        </ul>
        <button v-if="all.length > groups.length" type="button" class="btn btn--ghost btn--sm pip-rank__all" aria-haspopup="dialog" @click="openAll">{{ t("play.info.honorsAll", { n: all.length }) }}</button>
      </template>
    </section>

    <CardSpendLeaderboard v-if="kindred" :key="card.id" :card-id="card.id" layout="summary" />

    <p v-if="!showHonors && !kindred" class="pip-rank__empty">{{ t("play.info.rankEmpty") }}</p>

    <CardHonorsDialog v-if="opened" :items="all" :failed="failed" @close="closeAll" @retry="load" />
  </div>
</template>

<style scoped>
.pip-rank { display: grid; gap: var(--s-4); min-width: 0; }
.pip-rank__h { margin: 0 0 var(--s-3); font-size: 16px; font-weight: 600; }
.pip-rank__labels { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: 0; padding: 0; list-style: none; }
.pip-rank__labels > li { display: flex; min-width: 0; max-width: 100%; }
.pip-rank__ghost { width: 120px; height: 28px; border-radius: var(--r-pill); }
.pip-rank__all { margin-top: var(--s-2); padding-inline: var(--s-2); }
.pip-rank__error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); }
.pip-rank__empty { margin: var(--s-6) 0; text-align: center; font-size: 14px; color: var(--text-2); }
.pip-rank :deep(.spend-summary) { box-shadow: none; border: 0; padding: 0; background: transparent; }
</style>
