<script lang="ts">
/**
 * 一段文字的逐行差異（審卡 V2 第二批，ui.md §4.1）。演算法跟伺服器的 lineDelta（src/review-diff.ts）同一套：
 * 先削掉共同的頭尾，中段做 LCS；任一邊超過 2000 行、或兩邊行數相乘太大，就整段當「刪掉舊的、換上新的」，
 * 免得一份很長的開場網頁把手機卡住。
 */
export type DiffOp = { kind: "same" | "add" | "del"; text: string };

const MAX_LINES = 2000;
const MAX_CELLS = 1_000_000;

export function lineOps(before: string, after: string): DiffOp[] {
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  if (before === after) return a.map((text) => ({ kind: "same", text }));
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const head: DiffOp[] = a.slice(0, start).map((text) => ({ kind: "same", text }));
  const tail: DiffOp[] = a.slice(endA).map((text) => ({ kind: "same", text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  const mid: DiffOp[] = [];
  if (!n || !m || n > MAX_LINES || m > MAX_LINES || n * m > MAX_CELLS) {
    for (const text of midA) mid.push({ kind: "del", text });
    for (const text of midB) mid.push({ kind: "add", text });
  } else {
    const w = m + 1;
    const dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = midA[i] === midB[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { mid.push({ kind: "same", text: midA[i]! }); i++; j++; }
      else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) mid.push({ kind: "del", text: midA[i++]! });
      else mid.push({ kind: "add", text: midB[j++]! });
    }
    while (i < n) mid.push({ kind: "del", text: midA[i++]! });
    while (j < m) mid.push({ kind: "add", text: midB[j++]! });
  }
  return [...head, ...mid, ...tail];
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";

const props = defineProps<{ ops: DiffOp[]; mode: "changes" | "full" }>();

/** 連續相同的行收成一段；改動的行一段一段照順序排 */
type Run = { kind: "same"; ops: DiffOp[]; trailing: boolean; paragraphs: number } | { kind: "change"; ops: DiffOp[] };
const runs = computed<Run[]>(() => {
  const out: Run[] = [];
  for (const op of props.ops) {
    const same = op.kind === "same";
    const last = out[out.length - 1];
    if (last && (last.kind === "same") === same) last.ops.push(op);
    else out.push(same ? { kind: "same", ops: [op], trailing: false, paragraphs: 0 } : { kind: "change", ops: [op] });
  }
  out.forEach((r, i) => {
    if (r.kind !== "same") return;
    r.trailing = i === out.length - 1 && i > 0;
    r.paragraphs = r.ops.filter((o) => o.text.trim()).length;
  });
  return out;
});

const opened = ref(new Set<number>());
const runEls = ref<Record<number, HTMLElement | null>>({});
const folded = (r: Run, i: number) => props.mode === "changes" && r.kind === "same" && !opened.value.has(i);
async function open(i: number) {
  opened.value = new Set(opened.value).add(i);
  await nextTick();
  runEls.value[i]?.focus();
}
</script>

<template>
  <div class="dl" data-diff-lines>
    <template v-for="(r, i) in runs" :key="i">
      <template v-if="folded(r, i)">
        <button v-if="r.kind === 'same' && r.paragraphs" type="button" class="dl__fold" data-diff-fold @click="open(i)">
          {{ $t(r.trailing ? "reviewV2.diff.collapsedAfter" : "reviewV2.diff.collapsed", { n: r.paragraphs }, r.paragraphs) }}
        </button>
      </template>
      <div v-else :ref="(el) => { runEls[i] = el as HTMLElement | null; }" class="dl__run" tabindex="-1">
        <div v-for="(op, k) in r.ops" :key="k" class="dl__line" :class="`dl__line--${op.kind}`" :data-diff-line="op.kind">
          <ins v-if="op.kind === 'add'" class="dl__add"><span class="sr-only">{{ $t("reviewV2.diff.added") }}</span>{{ op.text }}</ins>
          <del v-else-if="op.kind === 'del'" class="dl__del"><span class="sr-only">{{ $t("reviewV2.diff.removed") }}</span>{{ op.text }}</del>
          <span v-else>{{ op.text }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dl { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; min-width: 0; font-size: 13px; line-height: 1.7; }
.dl__run { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; min-width: 0; border-radius: var(--r-sm); }
.dl__run:focus { outline: none; }
.dl__run:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.dl__line { min-width: 0; min-height: 1.7em; padding: 0 var(--s-2); white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.dl__line--add { background: var(--success-soft); }
.dl__line--del { background: color-mix(in srgb, var(--danger) 10%, transparent); }
/* 不靠顏色：新增一律底線、刪除一律刪除線，讀屏另有「新增／刪除」 */
.dl__add { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; color: inherit; }
.dl__del { text-decoration: line-through; color: var(--text-2); }
.dl__fold {
  justify-self: start; min-height: var(--h-sm); padding: 0 var(--s-2); border: 1px dashed var(--line-strong); border-radius: var(--r-sm);
  background: transparent; color: var(--text-2); font: inherit; font-size: 13px; text-align: start; overflow-wrap: anywhere; cursor: pointer; max-width: 100%;
}
.dl__fold:hover { background: var(--surface-2); color: var(--text); }
</style>
