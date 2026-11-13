<script setup lang="ts">
/**
 * 擴充的更新紀錄（ui.md §3.3）：版面與樣式語言沿用卡片的 CardVersionHistory，但規則簡單得多——
 * 所有玩家一律用最新版，所以沒有舊版可選、沒有靜默更新的分組、也不寫相容提示；每筆就是 vN、時間、作者寫的更新說明。
 * 最新一筆（第一頁第一筆，伺服器新到舊排）帶「目前版本」。更新說明是作者寫的純文字，只用文字插值，不當 HTML。
 */
import { onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { fetchWorkshopVersions, type ExtensionVersion } from "@/lib/workshop";

const props = defineProps<{ workshopId: string }>();
const { t, locale } = useI18n();
const items = ref<ExtensionVersion[]>([]);
const busy = ref(false), failed = ref(false), moreBusy = ref(false), moreFailed = ref(false), hasMore = ref(false), page = ref(1);
// 換了擴充（同一頁換網址）時，前一個擴充晚回來的回應不能蓋掉現在這個
let generation = 0;

function when(v: ExtensionVersion): string {
  return v.publishedAt === null || !Number.isFinite(v.publishedAt) ? "" : new Intl.DateTimeFormat(locale.value, { dateStyle: "medium", timeStyle: "short" }).format(v.publishedAt);
}
const iso = (v: ExtensionVersion) => (v.publishedAt === null ? undefined : new Date(v.publishedAt).toISOString());
/** 首版的更新說明可以空著（送審時首版不必填）；空的首版寫「首次發布」，之後的版本照理一定有說明，萬一空就不寫 */
const note = (v: ExtensionVersion) => v.note.trim() || (v.version === 1 ? t("workshop.detail.versions.first") : "");

async function load() {
  const g = ++generation, id = props.workshopId;
  busy.value = true; failed.value = false; moreFailed.value = false; items.value = []; page.value = 1; hasMore.value = false;
  try {
    const res = await fetchWorkshopVersions(id, 1);
    if (g !== generation) return;
    items.value = res.items; hasMore.value = res.hasMore;
  } catch { if (g === generation) failed.value = true; } finally { if (g === generation) busy.value = false; }
}
async function more() {
  if (busy.value || moreBusy.value || !hasMore.value) return;
  const g = generation, id = props.workshopId, next = page.value + 1;
  moreBusy.value = true; moreFailed.value = false;
  try {
    const res = await fetchWorkshopVersions(id, next);
    if (g !== generation) return;
    // 兩頁之間剛好有新版上線時，同一個版號可能出現兩次：只接沒看過的
    const known = new Set(items.value.map((v) => v.version));
    items.value.push(...res.items.filter((v) => !known.has(v.version)));
    page.value = next; hasMore.value = res.hasMore;
  } catch { if (g === generation) moreFailed.value = true; } finally { if (g === generation) moreBusy.value = false; }
}
watch(() => props.workshopId, () => { void load(); }, { immediate: true });
onBeforeUnmount(() => { generation++; });
</script>

<template>
  <section class="ext-versions" :aria-label="$t('workshop.detail.tab.versions')" :aria-busy="busy || undefined">
    <div v-if="busy" class="ext-versions__skeleton" aria-hidden="true">
      <div v-for="i in 3" :key="i" class="ghost ext-versions__ghost" />
    </div>
    <div v-else-if="failed" class="notice notice--error ext-versions__status" role="alert">
      <span class="ws-text">{{ $t("workshop.detail.versions.loadFailed") }}</span>
      <button type="button" class="btn btn--sm" @click="load">{{ $t("library.retry") }}</button>
    </div>
    <p v-else-if="!items.length" class="subtle ws-text">{{ $t("workshop.detail.versions.empty") }}</p>
    <ol v-else class="ext-versions__list">
      <li v-for="(v, i) in items" :key="v.version" class="ext-versions__entry" :data-version="v.version">
        <div class="ext-versions__head">
          <strong class="ext-versions__ver">v{{ v.version }}</strong>
          <span v-if="i === 0" class="chip ws-chip--on" data-current-version>{{ $t("workshop.detail.version.current") }}</span>
          <time v-if="when(v)" class="subtle" :datetime="iso(v)">{{ when(v) }}</time>
        </div>
        <p v-if="note(v)" class="ext-versions__note">{{ note(v) }}</p>
      </li>
    </ol>
    <template v-if="!busy && !failed && items.length">
      <p v-if="moreFailed" class="subtle ws-text" role="status">{{ $t("workshop.detail.versions.loadFailed") }}</p>
      <button v-if="hasMore" type="button" class="btn btn--sm ext-versions__more" data-versions-more :disabled="moreBusy" @click="more">
        {{ $t(moreFailed ? "library.retry" : "workshop.detail.versions.more") }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.ext-versions { display: grid; gap: var(--s-3); min-width: 0; }
.ext-versions__list { display: grid; margin: 0; padding: 0; list-style: none; }
.ext-versions__entry { display: grid; gap: var(--s-2); padding: var(--s-4) 0; border-top: 1px solid var(--line); }
.ext-versions__entry:first-child { border-top: 0; padding-top: 0; }
.ext-versions__head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); }
.ext-versions__ver { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ext-versions__note { margin: 0; font-size: 14px; line-height: 1.7; color: var(--text-2); white-space: pre-wrap; overflow-wrap: anywhere; }
.ext-versions__status { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); }
.ext-versions__more { justify-self: start; min-width: 12em; }
.ext-versions__skeleton { display: grid; gap: var(--s-3); }
.ext-versions__ghost { height: 64px; border-radius: var(--r-md); }
</style>
