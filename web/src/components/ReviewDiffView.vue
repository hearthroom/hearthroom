<script lang="ts">
import type { ReviewDiffSummary } from "@/lib/api";

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string;

/**
 * 改動摘要的 chip（審核頁「更新內容」與佇列「更新」列共用同一份字）。
 * 只列有改動的項目；封面不比（每次封存的網址都不同，比了只是噪音），所以不出現「封面 沒改」。
 */
export function diffSummaryChips(s: ReviewDiffSummary, t: Translate, n: (v: number) => string): string[] {
  const out: string[] = [];
  if (s.setting?.charsAdded || s.setting?.charsRemoved) out.push(t("reviewV2.diff.chip.setting", { a: n(s.setting.charsAdded), d: n(s.setting.charsRemoved) }));
  if (s.opening?.changed) out.push(t("reviewV2.diff.chip.opening"));
  const wb = s.worldbook;
  if (wb && (wb.added || wb.modified || wb.removed)) out.push(t("reviewV2.diff.chip.worldbook", { a: n(wb.added), m: n(wb.modified), d: n(wb.removed) }));
  const rules = s.rules;
  if (rules && (rules.added || rules.modified || rules.removed)) out.push(t("reviewV2.diff.chip.rules", { a: n(rules.added), m: n(rules.modified), d: n(rules.removed) }));
  if (s.tags?.removed) out.push(t("reviewV2.diff.chip.tagsChanged", { a: n(s.tags.added), d: n(s.tags.removed) }));
  else if (s.tags?.added) out.push(t("reviewV2.diff.chip.tags", { a: n(s.tags.added) }));
  return out;
}
</script>

<script setup lang="ts">
/**
 * 更新差異（審卡 V2 第二批，ui.md §4.1、copy.md §10）：這一版跟基準版（上次通過版；駁回後重送是上次駁回版）差在哪。
 * 第一次打開「更新內容」分頁才讀；兩邊都是伺服器即時讀的封存版，這裡只負責畫。
 *
 * 改動標示不靠顏色：新增＝底線＋淡綠底、刪除＝刪除線＋淡紅底，另有讀屏用的「新增／刪除」。
 * 「只看改動」把沒改的段落收成一行，點開才看；「全文」整段照列。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError, fetchReviewDiff, type ReviewDiffEntry, type ReviewDiffResult } from "@/lib/api";
import { useSession } from "@/lib/session";
import { readTalkExample } from "@/lib/role-draft";
import { isOpeningReason, reasonKey, REVIEW_REASON_GROUPS } from "@/lib/review-reasons";
import ReviewDiffLines, { lineOps, type DiffOp } from "./ReviewDiffLines.vue";

const props = defineProps<{ submissionId: string; previousReasons?: string[] }>();
const { t, te, locale } = useI18n();
const session = useSession();

const result = ref<ReviewDiffResult | null>(null);
const loading = ref(true);
/** retry＝網路或不明錯誤，可以重試；其他是讀了也不會變的狀態，只說明 */
const failure = ref<{ text: string; retry: boolean } | null>(null);
const mode = ref<"changes" | "full">("changes");

async function load() {
  loading.value = true;
  failure.value = null;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    result.value = await fetchReviewDiff(props.submissionId, token);
  } catch (err) {
    if (err instanceof ApiError && err.code === "age_verification_required") failure.value = { text: t("error.ageVerificationRequired"), retry: false };
    else if (err instanceof ApiError && err.status === 410) failure.value = { text: t("review.inactive"), retry: false };
    else if (err instanceof ApiError && err.status === 403) failure.value = { text: err.message, retry: false };
    else failure.value = { text: t("state.loadFailed"), retry: true };
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const numbers = computed(() => new Intl.NumberFormat(String(locale.value)));
const fmt = (v: number) => numbers.value.format(v);
const ready = computed(() => (result.value?.state === "ready" ? result.value : null));
const summary = computed(() => ready.value?.diff.summary ?? null);
const chips = computed(() => (summary.value ? diffSummaryChips(summary.value, t, fmt) : []));

/** 欄位名稱沿用編輯頁與審核頁現有的字；作者資產的欄位帶 asset. 前綴 */
const FIELD_LABELS: Record<string, string> = {
  name: "editor.name",
  summary: "editor.summary",
  setting: "editor.detail",
  userName: "reviewV2.diff.field.userName",
  instructions: "editor.jailbreak",
  talkExample: "editor.talkExample",
  outputContract: "editor.contract",
  speech: "reviewV2.diff.field.speech",
  type: "reviewV2.diff.field.type",
  sex: "settings.persona.sex",
  language: "create.language",
  tags: "review.tags",
  world: "editor.section.world",
  opening: "editor.welcome",
  alternates: "editor.alternates",
  prologue: "editor.prologue",
  "asset.openingPage": "editor.opening.page",
  "asset.openingMode": "editor.opening.mode",
  "asset.cardFormat": "reviewV2.diff.field.cardFormat",
  "asset.cardCss": "editor.cardCss.title",
  "asset.cardCssDialect": "reviewV2.diff.field.cardCssDialect",
  "asset.pageMode": "reviewV2.diff.field.pageMode",
  "asset.mountTrigger": "reviewV2.diff.field.mountTrigger",
  "asset.mountLayer": "reviewV2.diff.field.mountLayer",
};
/* 伺服器之後多比一個欄位、這裡還沒有字時，退回鍵名本身，不讓整塊消失 */
const fieldLabel = (key: string) => (FIELD_LABELS[key] && te(FIELD_LABELS[key]) ? t(FIELD_LABELS[key]) : key.replace(/^asset\./, ""));

/** 對話示例存的是 JSON：拆成一輪一輪再比，不然整段只會是一行刪、一行加 */
function talkText(raw: string): string {
  const turns = readTalkExample(raw);
  if (!turns.length) return raw;
  return turns.map((turn) => t("review.confirm.row", { label: t(turn.roleType === "user" ? "editor.talkExample.user" : "editor.talkExample.ai"), value: turn.content })).join("\n");
}
/** 標籤是集合：沒變的照新順序列，新加的標新增，拿掉的標刪除 */
function tagOps(before: string, after: string): DiffOp[] {
  const split = (s: string) => s.split(", ").map((x) => x.trim()).filter(Boolean);
  const a = split(before);
  const b = split(after);
  const had = new Set(a);
  const has = new Set(b);
  return [
    ...b.map((text): DiffOp => ({ kind: had.has(text) ? "same" : "add", text })),
    ...a.filter((text) => !has.has(text)).map((text): DiffOp => ({ kind: "del", text })),
  ];
}
const fieldBlocks = computed(() =>
  (ready.value?.diff.fields ?? []).map((f) => ({
    key: f.key,
    label: fieldLabel(f.key),
    ops: f.key === "tags" ? tagOps(f.before, f.after) : f.key === "talkExample" ? lineOps(talkText(f.before), talkText(f.after)) : lineOps(f.before, f.after),
  })),
);

/**
 * 條目的「常駐」「已停用」與關鍵詞：修改的條目常常只動了這些、內容一字未改，
 * 所以前後不同時舊的劃掉、新的加底線，不然審核人只會看到「修改」底下什麼都沒有。
 */
type Flag = { key: string; kind: "same" | "add" | "del" };
type EntryRow = { change: "added" | "removed" | "modified"; name: string; oldName: string | null; flags: Flag[]; keywords: string; oldKeywords: string | null; ops: DiffOp[] };
const flagsOf = (before: ReviewDiffEntry | null, after: ReviewDiffEntry): Flag[] => {
  const out: Flag[] = [];
  const pick = (key: string, was: boolean | null, now: boolean) => {
    if (now && (was === null || was)) out.push({ key, kind: "same" });
    else if (now) out.push({ key, kind: "add" });
    else if (was) out.push({ key, kind: "del" });
  };
  pick("review.entry.constant", before ? before.isConstant : null, after.isConstant);
  pick("review.entry.disabled", before ? !before.isEnabled : null, !after.isEnabled);
  return out;
};
const words = (e: ReviewDiffEntry) => e.keywords.join("、");
const entryRows = computed<EntryRow[]>(() => {
  const wb = ready.value?.diff.worldbook;
  if (!wb) return [];
  return [
    ...wb.modified.map((p): EntryRow => ({
      change: "modified", name: p.after.name, oldName: p.before.name !== p.after.name ? p.before.name : null,
      flags: flagsOf(p.before, p.after), keywords: words(p.after), oldKeywords: words(p.before) !== words(p.after) ? words(p.before) : null,
      ops: lineOps(p.before.content, p.after.content),
    })),
    ...wb.added.map((e): EntryRow => ({ change: "added", name: e.name, oldName: null, flags: flagsOf(null, e), keywords: words(e), oldKeywords: null, ops: lineOps("", e.content) })),
    ...wb.removed.map((e): EntryRow => ({ change: "removed", name: e.name, oldName: null, flags: flagsOf(null, e), keywords: words(e), oldKeywords: null, ops: lineOps(e.content, "") })),
  ];
});
const ruleItems = computed(() => ready.value?.diff.rules.items ?? []);
const changeLabel = (c: "added" | "removed" | "modified") => t(c === "added" ? "reviewV2.diff.added" : c === "removed" ? "reviewV2.diff.removed" : "reviewV2.diff.edited");

/**
 * 駁回後重送：上次的理由逐項對照這次有沒有動到對應的欄位。只標事實，不判斷改得夠不夠。
 * 開場類理由看開場白、設定類看設定多了幾字；分級與其他理由沒有對應欄位，只列名稱。
 */
const SETTING_REASONS: readonly string[] = REVIEW_REASON_GROUPS.setting;
const previousRows = computed(() => {
  const s = summary.value;
  if (!s || ready.value?.baseKind !== "rejected") return [];
  return (props.previousReasons ?? []).map((code) => {
    const reason = t(reasonKey(code, "name"));
    if (isOpeningReason(code)) return t(s.opening.changed ? "reviewV2.diff.previous.openingChanged" : "reviewV2.diff.previous.openingUnchanged", { reason });
    if (SETTING_REASONS.includes(code)) {
      const added = s.setting.charsAdded;
      return added ? t("reviewV2.diff.previous.settingAdded", { reason, n: fmt(added) }, added) : t("reviewV2.diff.previous.settingUnchanged", { reason });
    }
    return reason;
  });
});
</script>

<template>
  <section class="rd" data-review-diff :aria-busy="loading ? 'true' : undefined">
    <div v-if="loading" class="rd__ghosts" aria-hidden="true" data-diff-loading>
      <div class="ghost rd__ghost rd__ghost--line" />
      <div class="ghost rd__ghost rd__ghost--chips" />
      <div class="ghost rd__ghost rd__ghost--block" />
    </div>
    <p v-else-if="failure" class="notice notice--error" role="alert" data-diff-error>
      {{ failure.text }}
      <button v-if="failure.retry" type="button" class="btn btn--sm" data-diff-retry @click="load">{{ $t("review.correction.reload") }}</button>
    </p>
    <template v-else-if="result">
      <p v-if="result.state === 'no_base'" class="rd__state" data-diff-state="no_base">{{ $t("reviewV2.diff.noBase") }}</p>
      <p v-else-if="!ready" class="rd__state" data-diff-state="unreadable">{{ $t("reviewV2.diff.unreadable") }}</p>
      <template v-else>
        <p class="rd__base" data-diff-base>{{ $t(ready.baseKind === "rejected" ? "reviewV2.diff.base.rejected" : "reviewV2.diff.base.approved") }}</p>

        <section v-if="previousRows.length" class="rd__previous" data-diff-previous>
          <h4 class="rd__title">{{ $t("reviewV2.diff.previous.title") }}</h4>
          <ul class="rd__list">
            <li v-for="(row, i) in previousRows" :key="i">{{ row }}</li>
          </ul>
        </section>

        <p v-if="summary!.unchanged" class="rd__state" data-diff-state="unchanged">
          {{ $t(ready.baseKind === "rejected" ? "reviewV2.diff.unchanged.rejected" : "reviewV2.diff.unchanged.approved") }}
        </p>
        <template v-else>
          <ul v-if="chips.length" class="rd__chips" data-diff-chips>
            <li v-for="c in chips" :key="c" class="chip rd__chip">{{ c }}</li>
          </ul>
          <p class="subtle rd__total" data-diff-total>{{ $t("reviewV2.diff.total", { n: fmt(summary!.totalChanged) }, summary!.totalChanged) }}</p>

          <div class="seg rd__mode" data-diff-mode>
            <button type="button" class="seg__item" :class="{ 'seg__item--on': mode === 'changes' }" :aria-pressed="mode === 'changes'" data-diff-mode-changes @click="mode = 'changes'">{{ $t("reviewV2.diff.mode.changes") }}</button>
            <button type="button" class="seg__item" :class="{ 'seg__item--on': mode === 'full' }" :aria-pressed="mode === 'full'" data-diff-mode-full @click="mode = 'full'">{{ $t("reviewV2.diff.mode.full") }}</button>
          </div>

          <section v-for="f in fieldBlocks" :key="f.key" class="rd__block" :data-diff-field="f.key">
            <h4 class="rd__title">{{ f.label }}</h4>
            <ReviewDiffLines :ops="f.ops" :mode="mode" />
          </section>

          <section v-if="entryRows.length" class="rd__block" data-diff-worldbook>
            <h4 class="rd__title">{{ $t("editor.section.worldbook") }}</h4>
            <details v-for="(e, i) in entryRows" :key="i" class="rd__entry" :open="e.change === 'modified'" :data-diff-entry="e.change">
              <summary class="rd__entry-head">
                <span class="chip rd__change">{{ changeLabel(e.change) }}</span>
                <span class="rd__entry-name">
                  <template v-if="e.oldName !== null"><del class="rd__del"><span class="sr-only">{{ $t("reviewV2.diff.removed") }}</span>{{ e.oldName || $t("wb.entry.untitled") }}</del>{{ " " }}<ins class="rd__add"><span class="sr-only">{{ $t("reviewV2.diff.added") }}</span>{{ e.name || $t("wb.entry.untitled") }}</ins></template>
                  <del v-else-if="e.change === 'removed'" class="rd__del">{{ e.name || $t("wb.entry.untitled") }}</del>
                  <ins v-else-if="e.change === 'added'" class="rd__add">{{ e.name || $t("wb.entry.untitled") }}</ins>
                  <strong v-else>{{ e.name || $t("wb.entry.untitled") }}</strong>
                </span>
                <span v-for="f in e.flags" :key="f.key" class="chip" :data-diff-flag="f.kind">
                  <del v-if="f.kind === 'del'" class="rd__del"><span class="sr-only">{{ $t("reviewV2.diff.removed") }}</span>{{ $t(f.key) }}</del>
                  <ins v-else-if="f.kind === 'add'" class="rd__add"><span class="sr-only">{{ $t("reviewV2.diff.added") }}</span>{{ $t(f.key) }}</ins>
                  <template v-else>{{ $t(f.key) }}</template>
                </span>
                <span v-if="e.oldKeywords !== null" class="subtle rd__keywords" data-diff-keywords>
                  <del v-if="e.oldKeywords" class="rd__del"><span class="sr-only">{{ $t("reviewV2.diff.removed") }}</span>{{ e.oldKeywords }}</del>{{ " " }}<ins v-if="e.keywords" class="rd__add"><span class="sr-only">{{ $t("reviewV2.diff.added") }}</span>{{ e.keywords }}</ins>
                </span>
                <span v-else-if="e.keywords" class="subtle rd__keywords">{{ e.keywords }}</span>
              </summary>
              <ReviewDiffLines :ops="e.ops" :mode="mode" />
            </details>
          </section>

          <section v-if="ruleItems.length" class="rd__block" data-diff-rules>
            <h4 class="rd__title">{{ $t("reviewV2.diff.rules") }}</h4>
            <ul class="rd__list rd__rules">
              <li v-for="(r, i) in ruleItems" :key="i" class="rd__rule" :data-diff-rule="r.change">
                <span class="chip rd__change">{{ changeLabel(r.change) }}</span>
                <del v-if="r.change === 'removed'" class="rd__del">{{ r.label }}</del>
                <ins v-else-if="r.change === 'added'" class="rd__add">{{ r.label }}</ins>
                <span v-else class="rd__rule-name">{{ r.label }}</span>
              </li>
            </ul>
          </section>
        </template>
      </template>
    </template>
  </section>
</template>

<style scoped>
.rd { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-4); min-width: 0; }
.rd__ghosts { display: grid; gap: var(--s-3); }
.rd__ghost { border-radius: var(--r-md); }
.rd__ghost--line { height: 18px; width: 60%; }
.rd__ghost--chips { height: 26px; width: 80%; }
.rd__ghost--block { height: 160px; }
.rd__state, .rd__base { margin: 0; overflow-wrap: anywhere; }
.rd__base { font-weight: 600; }
.rd__title { margin: 0 0 var(--s-2); font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.rd__previous { padding: var(--s-3); border: 1px solid var(--line); border-radius: var(--r-md); min-width: 0; }
.rd__list { margin: 0; padding-left: var(--s-5); display: grid; gap: var(--s-1); min-width: 0; overflow-wrap: anywhere; }
.rd__chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--s-2); min-width: 0; }
/* chip 是單行 pill；字長時允許換行，不把版面撐寬 */
.rd__chip { height: auto; min-height: 26px; max-width: 100%; white-space: normal; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.rd__total { margin: calc(var(--s-2) * -1) 0 0; font-variant-numeric: tabular-nums; }
.rd__mode { justify-self: start; max-width: 100%; }
.rd__block { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-2); min-width: 0; padding-top: var(--s-3); border-top: 1px solid var(--line); }
.rd__entry { min-width: 0; padding: var(--s-2) 0; border-bottom: 1px solid var(--line); }
.rd__entry:last-child { border-bottom: 0; }
.rd__entry-head { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; min-width: 0; cursor: pointer; }
.rd__entry-name { min-width: 0; overflow-wrap: anywhere; }
.rd__keywords { min-width: 0; overflow-wrap: anywhere; }
.rd__entry > .dl { margin-top: var(--s-2); }
.rd__rules { list-style: none; padding: 0; }
.rd__rule { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; min-width: 0; }
.rd__rule-name { min-width: 0; overflow-wrap: anywhere; }
.rd__change { flex: none; }
.rd__add { text-decoration: underline; text-underline-offset: 3px; background: var(--success-soft); color: inherit; overflow-wrap: anywhere; min-width: 0; }
.rd__del { text-decoration: line-through; background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--text-2); overflow-wrap: anywhere; min-width: 0; }
:lang(ko) .rd__state, :lang(ko) .rd__base, :lang(ko) .rd__title, :lang(ko) .rd__list, :lang(ko) .rd__chip, :lang(ko) .rd__total { word-break: keep-all; }
:lang(ja) .rd__state, :lang(ja) .rd__base, :lang(ja) .rd__title, :lang(ja) .rd__list, :lang(ja) .rd__chip, :lang(ja) .rd__total { word-break: auto-phrase; }
</style>
