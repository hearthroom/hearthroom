<script setup lang="ts">
/**
 * 我的長期指令組：把常用的長期指令存成幾組，遊玩時在畫布選給一張卡或一個存檔（ui.md §5）。
 *
 * 這一頁只管組本身（新增、編輯、刪除）。「這張卡的新存檔自動帶上哪一組」只在畫布設：網頁沒有「目前這張卡」
 * 的脈絡，所以這裡只顯示有幾張卡在用（PM 2026-10-31）。上限一律取伺服器回傳的值。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { pageTitle } from "@/lib/i18n";
import { whole } from "@/lib/format";
import { useSession } from "@/lib/session";
import { listInstructionSets, type InstructionLimits, type InstructionSet } from "@/lib/instruction-sets";
import MascotSay from "@/components/MascotSay.vue";
import InstructionSetEditor from "@/components/InstructionSetEditor.vue";

const { t } = useI18n();
const session = useSession();

const sets = ref<InstructionSet[]>([]);
const limits = ref<InstructionLimits | null>(null);
const loading = ref(true);
const loadFailed = ref(false);
/** 編輯中的那一組；"new" 是新增。 */
const editing = ref<InstructionSet | "new" | null>(null);
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const full = computed(() => !!limits.value && sets.value.length >= limits.value.maxCount);
const PREVIEW = 3;

async function token(): Promise<string> {
  const value = await session.accessToken();
  if (!value) throw new Error(t("auth.expired"));
  return value;
}

async function load() {
  loading.value = !sets.value.length;
  loadFailed.value = false;
  try {
    const got = await listInstructionSets(await token());
    sets.value = got.list;
    limits.value = { maxCount: got.maxCount, maxItems: got.maxItems, maxLength: got.maxLength, maxTitle: got.maxTitle };
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}

function say(text: string) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2400);
}

function create() {
  if (full.value || !limits.value) return;
  editing.value = "new";
}

function saved(set: InstructionSet) {
  editing.value = null;
  // 伺服器照最近更新排序：存好的那一組移到最上面，cardCount 保留列表上的（存檔回應不一定帶）
  const before = sets.value.find((s) => s.presetId === set.presetId);
  sets.value = [{ ...set, cardCount: set.cardCount || before?.cardCount || 0 }, ...sets.value.filter((s) => s.presetId !== set.presetId)];
  say(t("instructions.toast.saved", { name: set.title }));
}

function deleted(set: InstructionSet) {
  editing.value = null;
  sets.value = sets.value.filter((s) => s.presetId !== set.presetId);
  say(t("instructions.toast.deleted", { name: set.title }));
}

// 條數與卡數各自變單複數，所以是兩句接起來（文案拆成 meta.items＋meta.used／unused）
const metaOf = (s: InstructionSet) => `${t("instructions.meta.items", { n: whole(s.items.length) }, s.items.length)} · ${s.cardCount > 0
  ? t("instructions.meta.used", { m: whole(s.cardCount) }, s.cardCount)
  : t("instructions.meta.unused")}`;

onMounted(() => {
  document.title = pageTitle(t("instructions.title"));
  void load();
});
onBeforeUnmount(() => clearTimeout(toastTimer));
</script>

<template>
  <div class="page page--narrow isets">
    <header class="isets__head">
      <div class="isets__intro">
        <h1 class="display">{{ $t("instructions.title") }}</h1>
        <p class="muted">{{ $t("instructions.lede") }}</p>
      </div>
      <div v-if="!loadFailed && (loading || sets.length)" class="isets__actions">
        <button type="button" class="btn btn--primary isets__new" :disabled="loading || full" data-testid="instructions-new" @click="create">{{ $t("instructions.new") }}</button>
        <span v-if="full && limits" class="subtle" data-testid="instructions-limit">{{ $t("instructions.limit", { max: whole(limits.maxCount) }) }}</span>
      </div>
    </header>

    <ul v-if="loading" class="isets__list" aria-busy="true">
      <li v-for="n in 3" :key="n" class="panel isets__ghost ghost" />
    </ul>
    <div v-else-if="loadFailed" class="notice notice--error isets__failed" role="alert">
      <span>{{ $t("instructions.error.load") }}</span>
      <button type="button" class="btn btn--sm" data-testid="instructions-reload" @click="load">{{ $t("instructions.reload") }}</button>
    </div>
    <section v-else-if="!sets.length" class="panel isets__empty" data-testid="instructions-empty">
      <MascotSay src="/mascot/chuchu-heart.webp" :size="112" />
      <h2>{{ $t("instructions.empty.title") }}</h2>
      <p class="muted">{{ $t("instructions.empty.body") }}</p>
      <button type="button" class="btn btn--primary" data-testid="instructions-new-empty" @click="create">{{ $t("instructions.new") }}</button>
    </section>
    <ul v-else class="isets__list">
      <li v-for="s in sets" :key="s.presetId" class="panel isets__row" data-testid="instructions-row">
        <div class="isets__top">
          <div class="isets__titles">
            <strong class="isets__name">{{ s.title }}</strong>
            <span class="subtle isets__meta" data-testid="instructions-meta">{{ metaOf(s) }}</span>
          </div>
          <button type="button" class="btn btn--sm" data-testid="instructions-edit" @click="editing = s">{{ $t("instructions.edit") }}</button>
        </div>
        <ol class="isets__preview">
          <li v-for="(item, i) in s.items.slice(0, PREVIEW)" :key="i"><span class="isets__clamp">{{ item }}</span></li>
        </ol>
        <p v-if="s.items.length > PREVIEW" class="subtle isets__more" data-testid="instructions-more">
          {{ $t("instructions.preview.more", { n: whole(s.items.length - PREVIEW) }, s.items.length - PREVIEW) }}
        </p>
        <p v-if="s.cardCount === 0" class="subtle isets__hint">{{ $t("instructions.unusedHint") }}</p>
      </li>
    </ul>

    <InstructionSetEditor
      v-if="editing && limits" :set="editing === 'new' ? null : editing" :limits="limits" :token="token"
      @close="editing = null" @saved="saved" @deleted="deleted" @stale="load"
    />
    <div class="toast" role="status" :hidden="!toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.isets { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-4); padding-block: var(--s-6) var(--s-7); }
.isets__head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--s-4); }
.isets__intro { flex: 1 1 240px; min-width: 0; }
.isets__head p { margin: var(--s-2) 0 0; }
.isets__actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--s-1) var(--s-3); }
.isets__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
.isets__ghost { height: 148px; }
.isets__failed { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); }
.isets__empty { padding: var(--s-6) var(--s-5); display: grid; gap: var(--s-3); justify-items: center; text-align: center; }
.isets__empty h2 { margin: 0; font-size: 16px; }
.isets__empty p { margin: 0; max-width: 30ch; }
.isets__row { padding: var(--s-4); display: grid; gap: var(--s-2); }
.isets__top { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s-3); }
.isets__titles { min-width: 0; display: grid; gap: var(--s-1); }
.isets__name { font-weight: 600; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.isets__top .btn { flex-shrink: 0; }
.isets__preview { margin: 0; padding-inline-start: 1.4em; display: grid; gap: var(--s-1); font-size: 13px; color: var(--text-2); }
.isets__clamp { overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.isets__more, .isets__hint { margin: 0; }
:lang(ko) .isets { word-break: keep-all; }
@media (max-width: 760px) {
  .isets__actions { width: 100%; flex-direction: column; align-items: stretch; }
  .isets__new { height: var(--h-lg); font-size: 15px; }
}
</style>
