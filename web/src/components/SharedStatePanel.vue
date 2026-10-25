<script setup lang="ts">
/**
 * 編輯頁「玩家投票與計數」：作者看這張卡的共用狀態、開放或暫停玩家參與、把某一項歸零、清空自己試玩的數字。
 * 規格：docs/studio/tasks/2026-10-25-card-share-context/editor-toggle-ui.md；文案：editor-toggle-copy.md。
 *
 * - 這裡的操作立即寫入，跟編輯頁的內容儲存分開：不動 dirty、不觸發儲存或發布。
 * - 四種狀態：平台總開關沒開、或這張卡沒宣告 → 整塊不顯示；有宣告 → 完整面板；平台暫停這張卡 → 唯讀。
 * - 讀不到（含宣告讀不到的 503）不能當成「沒宣告」藏起來，就地顯示錯誤與重新載入。
 * - 只有 4xx 算「確定沒做」；5xx 與斷線＝結果不明：先鎖住寫入、重新讀狀態，不自動重送（尤其是歸零）。
 * - 確認與寫入綁住開始時的卡與世代：確認框開著時換了卡，舊的確認不會寫到新卡。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError, clearSharedStateDraft, fetchSharedStateSettings, resetSharedStateKey, setSharedStateEnabled, type SharedItem, type SharedStateSettings } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm";
import type { ProviderId } from "@/lib/provider";

const props = defineProps<{ roleId: string; provider: ProviderId; cardName: string; token: () => Promise<string | null> }>();
const { t, locale } = useI18n();
const k = (key: string, params?: Record<string, unknown>) => t(`editor.shared.${key}`, params ?? {});

type Phase = "loading" | "hidden" | "ready" | "error";
const phase = ref<Phase>("loading");
const data = ref<SharedStateSettings | null>(null);
/** 第一次讀取超過 200ms 才畫骨架：很快就回來的不閃一下。 */
const showSkeleton = ref(false);
/** 正在做的寫入；做的期間本區所有寫入控件都鎖住。 */
const busy = ref<null | "toggle" | "reset" | "clear">(null);
/** 上一次寫入的結果：成功只是短暫回饋，拒絕與不明會一直留著直到下一次操作或讀回。 */
const result = ref<{ kind: "success" | "rejected" | "unknown"; text: string } | null>(null);
/** 結果不明之後要先成功讀回一次，才放開寫入。 */
const needsReadback = ref(false);
let generation = 0;
let skeletonTimer: ReturnType<typeof setTimeout> | undefined;
let successTimer: ReturnType<typeof setTimeout> | undefined;

const declared = (s: SharedStateSettings) => Object.keys(s.declaration?.polls ?? {}).length + Object.keys(s.declaration?.counters ?? {}).length > 0;

async function load(initial = false) {
  const g = ++generation;
  if (initial) {
    phase.value = "loading";
    clearTimeout(skeletonTimer);
    skeletonTimer = setTimeout(() => { if (g === generation && phase.value === "loading") showSkeleton.value = true; }, 200);
  }
  try {
    const token = await props.token();
    if (!token) throw new ApiError(401, "", "unauthorized");
    const next = await fetchSharedStateSettings(props.roleId, token, props.provider);
    if (g !== generation) return false;
    data.value = next;
    phase.value = next.platformEnabled && declared(next) ? "ready" : "hidden";
    needsReadback.value = false;
    return true;
  } catch {
    if (g !== generation) return false;
    phase.value = "error";
    return false;
  } finally {
    if (g === generation) { showSkeleton.value = false; clearTimeout(skeletonTimer); }
  }
}

/**
 * 這張卡的世代：切卡或切供應商就加一。確認框與寫入在開始時記下來源（卡、供應商、世代），
 * 每次 await 之後核對；換了就作廢，不改用新的 props，舊請求的結果也不更新新卡。
 */
let epoch = 0;
interface Source { roleId: string; provider: ProviderId; epoch: number }
const sourceNow = (): Source => ({ roleId: props.roleId, provider: props.provider, epoch });
const same = (src: Source) => src.epoch === epoch;

// 切卡或切供應商：丟掉舊請求的回應，從頭讀
watch(() => [props.roleId, props.provider] as const, () => {
  epoch++;
  data.value = null; result.value = null; needsReadback.value = false; busy.value = null;
  void load(true);
}, { immediate: true });
onBeforeUnmount(() => { generation++; clearTimeout(skeletonTimer); clearTimeout(successTimer); });

const platformOff = computed(() => !!data.value?.platformOff);
const open = computed(() => !!data.value && !data.value.authorOff && !data.value.platformOff);
/** 寫入控件能不能按：讀到可信資料、沒在寫、平台沒暫停、沒有等著讀回的不明結果。 */
const writable = computed(() => phase.value === "ready" && !busy.value && !platformOff.value && !needsReadback.value);

/** 宣告順序：投票在前、計數在後。 */
const keys = computed(() => {
  const d = data.value?.declaration;
  return d ? [...Object.keys(d.polls ?? {}).map((key) => ({ key, kind: "poll" as const })), ...Object.keys(d.counters ?? {}).map((key) => ({ key, kind: "counter" as const }))] : [];
});
const fmt = (n: number) => new Intl.NumberFormat(String(locale.value)).format(n);
function optionsOf(key: string): string[] { return data.value?.declaration.polls[key]?.options ?? []; }
function countOf(item: SharedItem | undefined, option: string): number { return item?.kind === "poll" ? item.counts[option] ?? 0 : 0; }
function counterOf(item: SharedItem | undefined) { return item?.kind === "counter" ? item : { kind: "counter" as const, total: 0 }; }
function goalOf(key: string): number | undefined { return data.value?.declaration.counters[key]?.goal; }

function succeed(text: string) {
  result.value = { kind: "success", text };
  clearTimeout(successTimer);
  successTimer = setTimeout(() => { if (result.value?.kind === "success") result.value = null; }, 4000);
}

/**
 * 有保證「伺服器在寫入前就擋下」的錯誤（4xx：權限、參數、限流、衝突）才算沒做成；
 * 5xx、斷線、回應讀不懂都不能證明沒寫，一律當結果不明：鎖住寫入、重新讀狀態，不重送。
 */
const notExecuted = (err: unknown) => err instanceof ApiError && err.status >= 400 && err.status < 500;

/**
 * 跑一次寫入。來源在開始時就定了（src）：拿 token 之後、寫入回來之後都核對一次，換卡了就什麼都不做。
 * 成功也重新讀，不把畫面硬寫成零（玩家可能同時還在貢獻）。
 */
async function write(src: Source, kind: "toggle" | "reset" | "clear", run: (token: string, src: Source) => Promise<unknown>, ok: string, rejected: string) {
  if (!same(src)) return;
  busy.value = kind;
  result.value = null;
  try {
    const token = await props.token();
    if (!same(src)) return;
    if (!token) throw new ApiError(401, "", "unauthorized");
    await run(token, src);
    if (!same(src)) return;
    succeed(ok);
    await load();
  } catch (err) {
    if (!same(src)) return;
    if (notExecuted(err)) {
      result.value = { kind: "rejected", text: rejected };
    } else {
      // 讀回成功就放開寫入（作者可以照最新資料再操作），但「上一次結果未確認」的說明留著
      result.value = { kind: "unknown", text: k("resultUnknown") };
      needsReadback.value = true;
      await load();
    }
  } finally {
    if (same(src)) busy.value = null;
  }
}

async function checkResult() {
  if (await load()) { needsReadback.value = false; }
}

function toggle(event: Event) {
  const input = event.target as HTMLInputElement;
  const desired = input.checked;
  // 畫面先照最後確認的狀態，寫成功、讀回後才換
  input.checked = open.value;
  if (!writable.value) return;
  void write(sourceNow(), "toggle", (token, src) => setSharedStateEnabled(src.roleId, desired, token, src.provider), desired ? k("enabledSuccess") : k("pausedSuccess"), k("updateRejected"));
}

async function reset(key: string, kind: "poll" | "counter", ns: "live" | "draft", from: HTMLElement) {
  if (!writable.value) return;
  const src = sourceNow();
  const live = ns === "live";
  const ok = await confirmDialog({
    title: k(live ? "resetLiveTitle" : "resetDraftTitle", { name: key }),
    message: k(live ? (kind === "poll" ? "resetLivePollBody" : "resetLiveCounterBody") : (kind === "poll" ? "resetDraftPollBody" : "resetDraftCounterBody")),
    detail: props.cardName ? `${props.cardName} · ${key}` : key,
    confirmText: k("confirmReset"),
    cancelText: k("keepNumbers"),
    danger: true,
    dangerAppearance: "subdued",
    focusCancel: true,
  });
  from.focus();
  // 確認期間可能換了卡、平台暫停了或正在寫：再核一次，換卡就作廢
  if (!ok || !same(src) || !writable.value) return;
  await write(src, "reset", (token, s) => resetSharedStateKey(s.roleId, key, ns, token, s.provider), k("resetSuccess", { name: key }), k("resetRejected"));
}

async function clearDraft(from: HTMLElement) {
  if (!writable.value) return;
  const src = sourceNow();
  const ok = await confirmDialog({
    title: k("clearDraftTitle"),
    message: k("clearDraftBody"),
    ...(props.cardName ? { detail: props.cardName } : {}),
    confirmText: k("confirmClearDraft"),
    cancelText: k("keepDraft"),
    danger: true,
    dangerAppearance: "subdued",
    focusCancel: true,
  });
  from.focus();
  if (!ok || !same(src) || !writable.value) return;
  await write(src, "clear", (token, s) => clearSharedStateDraft(s.roleId, token, s.provider), k("clearDraftSuccess"), k("clearDraftRejected"));
}

const statusLabel = computed(() => (platformOff.value ? k("platformPaused") : open.value ? k("active") : k("paused")));
const waitText = computed(() => (busy.value === "toggle" ? k("updating") : busy.value === "reset" ? k("resetting") : busy.value === "clear" ? k("clearingDraft") : ""));
</script>

<template>
  <section v-if="phase !== 'hidden'" class="panel shared" :aria-busy="phase === 'loading' ? 'true' : undefined" data-shared-state>
    <h2>{{ k("title") }}</h2>
    <p class="subtle shared__hint">{{ k("immediateHint") }}</p>

    <div v-if="phase === 'loading'" class="shared__loading">
      <template v-if="showSkeleton">
        <span class="sr-only">{{ k("loading") }}</span>
        <div class="ghost shared__ghost shared__ghost--row" />
        <div class="ghost shared__ghost" />
        <div class="ghost shared__ghost" />
      </template>
    </div>

    <template v-else-if="phase === 'error'">
      <div class="notice notice--error shared__error" role="alert">
        <span>{{ k("loadError") }}</span>
        <button type="button" class="btn" @click="load(!data)">{{ k("reload") }}</button>
      </div>
      <p v-if="data" class="subtle">{{ k("previousData") }}</p>
    </template>

    <template v-if="data && (phase === 'ready' || phase === 'error')">
      <label class="shared__row" :class="{ 'shared__row--locked': platformOff }">
        <span class="shared__text">
          <strong>{{ k("toggle") }}</strong>
          <span class="shared__state" :class="platformOff ? 'shared__state--platform' : open ? 'shared__state--open' : 'shared__state--paused'">{{ statusLabel }}</span>
          <template v-if="platformOff">
            <span class="subtle">{{ k("platformPausedHint") }}</span>
            <span class="subtle">{{ k("platformPausedReadHint") }}</span>
          </template>
          <span v-else-if="open" class="subtle">{{ k("activeHint") }}</span>
          <template v-else>
            <span class="subtle">{{ k("pausedHint") }}</span>
            <span class="subtle">{{ k("pausedReadHint") }}</span>
          </template>
        </span>
        <input type="checkbox" class="shared__switch" :checked="open" :disabled="!writable" @change="toggle" />
      </label>

      <p v-if="waitText" class="subtle shared__wait" role="status">{{ waitText }}</p>
      <div v-if="result?.kind === 'success'" class="shared__ok" role="status">{{ result.text }}</div>
      <div v-else-if="result" class="notice shared__error" :class="{ 'notice--error': result.kind === 'rejected' }" role="alert">
        <span>{{ result.text }}</span>
        <button v-if="result.kind === 'unknown'" type="button" class="btn" :disabled="!!busy" @click="checkResult">{{ k("checkResult") }}</button>
        <button v-else type="button" class="btn" :disabled="!!busy" @click="load()">{{ k("reload") }}</button>
      </div>

      <h3 class="shared__group">{{ k("liveTitle") }}</h3>
      <ul class="shared__items">
        <li v-for="item in keys" :key="`live-${item.key}`" class="shared__item">
          <div class="shared__main">
            <p class="shared__head"><span class="subtle">{{ k(item.kind) }}</span> <span class="shared__key">{{ item.key }}</span></p>
            <ul v-if="item.kind === 'poll'" class="shared__options">
              <li v-for="option in optionsOf(item.key)" :key="option"><span class="shared__key">{{ option }}</span><span class="shared__num">{{ k("votes", { count: fmt(countOf(data.live[item.key], option)) }) }}</span></li>
            </ul>
            <p v-else class="shared__counter">
              <template v-if="goalOf(item.key)">
                <span class="subtle">{{ k("progress") }}</span>
                <span class="shared__num">{{ fmt(counterOf(data.live[item.key]).total) }} / {{ fmt(goalOf(item.key)!) }}</span>
                <span class="subtle">{{ counterOf(data.live[item.key]).reachedAt ? k("reached") : k("notReached") }}</span>
              </template>
              <template v-else><span class="subtle">{{ k("total") }}</span> <span class="shared__num">{{ fmt(counterOf(data.live[item.key]).total) }}</span></template>
            </p>
          </div>
          <button type="button" class="btn btn--danger shared__reset" :disabled="!writable" :aria-label="k('resetLabel', { name: item.key })"
                  @click="reset(item.key, item.kind, 'live', $event.currentTarget as HTMLElement)">{{ k("reset") }}</button>
        </li>
      </ul>

      <details class="shared__draft">
        <summary>{{ k("draftTitle") }}</summary>
        <!-- details 的內容不會當 grid 子項排，間距與靠右要放在自己的容器上 -->
        <div class="shared__draft-body">
        <p class="subtle">{{ k("draftHint") }}</p>
        <ul class="shared__items">
          <li v-for="item in keys" :key="`draft-${item.key}`" class="shared__item">
            <div class="shared__main">
              <p class="shared__head"><span class="subtle">{{ k(item.kind) }}</span> <span class="shared__key">{{ item.key }}</span></p>
              <ul v-if="item.kind === 'poll'" class="shared__options">
                <li v-for="option in optionsOf(item.key)" :key="option"><span class="shared__key">{{ option }}</span><span class="shared__num">{{ k("votes", { count: fmt(countOf(data.draft[item.key], option)) }) }}</span></li>
              </ul>
              <p v-else class="shared__counter">
                <template v-if="goalOf(item.key)">
                  <span class="subtle">{{ k("progress") }}</span>
                  <span class="shared__num">{{ fmt(counterOf(data.draft[item.key]).total) }} / {{ fmt(goalOf(item.key)!) }}</span>
                  <span class="subtle">{{ counterOf(data.draft[item.key]).reachedAt ? k("reached") : k("notReached") }}</span>
                </template>
                <template v-else><span class="subtle">{{ k("total") }}</span> <span class="shared__num">{{ fmt(counterOf(data.draft[item.key]).total) }}</span></template>
              </p>
            </div>
            <button type="button" class="btn btn--danger shared__reset" :disabled="!writable" :aria-label="k('resetDraftLabel', { name: item.key })"
                    @click="reset(item.key, item.kind, 'draft', $event.currentTarget as HTMLElement)">{{ k("reset") }}</button>
          </li>
        </ul>
        <button type="button" class="btn btn--danger shared__clear" :disabled="!writable" @click="clearDraft($event.currentTarget as HTMLElement)">{{ k("clearDraft") }}</button>
        </div>
      </details>
    </template>
  </section>
</template>

<style scoped>
.shared { padding: var(--s-4); display: grid; gap: var(--s-2); }
.shared h2 { margin: 0; font-size: 15px; overflow-wrap: anywhere; }
.shared__hint { margin: 0; }
.shared__group { margin-top: var(--s-2); }
.shared__ghost { height: 20px; border-radius: var(--r-sm); }
.shared__ghost--row { height: var(--h-lg); }
.shared__loading { display: grid; gap: var(--s-3); }
.shared__row { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-height: var(--h-lg); cursor: pointer; }
.shared__row--locked { cursor: default; }
.shared__text { display: grid; gap: 2px; min-width: 0; flex: 1; font-size: 14px; color: var(--text-2); }
.shared__text strong { color: var(--text); }
.shared__switch { width: 22px; height: 22px; flex: none; accent-color: var(--accent); }
.shared__state { font-size: 13px; font-weight: 600; }
.shared__state--open { color: var(--accent-text); }
.shared__state--paused { color: var(--text-2); }
.shared__state--platform { color: var(--warning-text); }
.shared__wait, .shared__ok { margin: 0; font-size: 13px; color: var(--text-2); }
.shared__error { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); }
.shared__group { margin: 0; font-size: 14px; font-weight: 600; color: var(--text); }
.shared__items { list-style: none; margin: 0; padding: 0; display: grid; }
.shared__item { display: grid; gap: var(--s-3); padding: var(--s-4) 0; border-top: 1px solid var(--line); }
.shared__item:first-child { border-top: 0; padding-top: 0; }
.shared__main { display: grid; gap: var(--s-2); min-width: 0; }
.shared__head { margin: 0; font-size: 14px; }
.shared__key { color: var(--text); overflow-wrap: anywhere; word-break: keep-all; }
.shared__options { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 14px; }
.shared__options li { display: flex; justify-content: space-between; gap: var(--s-3); }
.shared__options li .shared__key { min-width: 0; }
.shared__num { color: var(--text); font-variant-numeric: tabular-nums; white-space: nowrap; }
.shared__counter { margin: 0; display: flex; flex-wrap: wrap; gap: 4px var(--s-2); font-size: 14px; align-items: baseline; }
.shared__reset, .shared__clear { justify-self: end; min-height: var(--h-lg); }
.shared__draft-body { display: grid; gap: var(--s-3); }
.shared__draft-body > .subtle { margin: 0; }
/* 不用 flex：summary 一變成 flex，瀏覽器的展開三角形就不見了 */
.shared__draft summary { padding: 12px 0; line-height: 20px; cursor: pointer; font-size: 14px; font-weight: 600; color: var(--text); }
@media (min-width: 761px) {
  .shared__item { grid-template-columns: minmax(0, 1fr) auto; align-items: start; }
  .shared__reset, .shared__clear { min-height: var(--h-md); }
}
</style>
