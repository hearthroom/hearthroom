<script setup lang="ts">
/**
 * 正則規則編輯器：整頁彈窗。
 *
 * 左欄是規則清單（搜尋、新建、上下移、啟用、刪除），右欄是選中那條的名字／匹配／替換內容，
 * 下面一塊測試台：貼一段 AI 回覆進來，看套用後長什麼樣。編輯的是一份本地副本，按「完成」才
 * 交回給表單——關掉彈窗不等於存檔，存檔跟卡片一起。
 *
 * 替換內容多半是幾千到兩萬字的 HTML/CSS/JS，所以右欄那格 textarea 要夠大，並用等寬字。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { confirmDialog } from "@/lib/confirm";
import {
  REGEX_LIMITS,
  applyRules,
  makeRule,
  parseFind,
  validateRuleSet,
  type RegexRule,
  type RegexRuleSet,
} from "@/lib/regex-rules";

const props = defineProps<{ modelValue: RegexRuleSet }>();
const emit = defineEmits<{ "update:modelValue": [RegexRuleSet]; close: [] }>();
const { t } = useI18n();

// 本地副本：改到一半按取消，外面那份不動
const set = ref<RegexRuleSet>(JSON.parse(JSON.stringify(props.modelValue)) as RegexRuleSet);
const selectedId = ref<string>(set.value.rules[0]?.id ?? "");
const query = ref("");
const testInput = ref("");
const testScope = ref<"all" | "one">("all");
const dirty = computed(() => JSON.stringify(set.value) !== JSON.stringify(props.modelValue));

const selected = computed(() => set.value.rules.find((r) => r.id === selectedId.value) ?? null);
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? set.value.rules.filter((r) => r.name.toLowerCase().includes(q) || r.find.toLowerCase().includes(q)) : set.value.rules;
});
const issues = computed(() => validateRuleSet(set.value));
const issueOf = (id: string) => issues.value.find((i) => i.ruleId === id);
const findKind = computed(() => {
  if (!selected.value) return "";
  const parsed = parseFind(selected.value.find);
  if (parsed instanceof Error) return "bad";
  return typeof parsed === "string" ? "literal" : "regex";
});
const length = (s: string) => [...s].length;

const testOutput = computed(() => {
  if (!testInput.value) return "";
  const rules = testScope.value === "one" && selected.value ? [selected.value] : set.value.rules;
  return applyRules(testInput.value, rules);
});

function add() {
  const rule = makeRule({ name: t("regex.rule.untitled") });
  set.value.rules.push(rule);
  selectedId.value = rule.id;
  void nextTick(() => document.getElementById("rx-name")?.focus());
}
async function remove(rule: RegexRule) {
  if (rule.find.trim() || rule.replace.trim()) {
    if (!(await confirmDialog({ message: t("regex.rule.deleteConfirm", { name: rule.name || t("regex.rule.untitled") }), confirmText: t("regex.rule.delete"), danger: true }))) return;
  }
  const index = set.value.rules.findIndex((r) => r.id === rule.id);
  set.value.rules.splice(index, 1);
  if (selectedId.value === rule.id) selectedId.value = set.value.rules[Math.min(index, set.value.rules.length - 1)]?.id ?? "";
}
function move(rule: RegexRule, delta: number) {
  const rules = set.value.rules;
  const from = rules.indexOf(rule);
  const to = from + delta;
  if (to < 0 || to >= rules.length) return;
  [rules[from], rules[to]] = [rules[to], rules[from]];
}
function done() {
  emit("update:modelValue", JSON.parse(JSON.stringify(set.value)) as RegexRuleSet);
  emit("close");
}
async function cancel() {
  if (dirty.value && !(await confirmDialog({ message: t("regex.discard"), confirmText: t("dialog.leave"), danger: true }))) return;
  emit("close");
}

// 彈窗開著時鎖住背景捲動；Esc 關閉
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") void cancel();
};
onMounted(() => {
  document.body.style.overflow = "hidden";
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  document.body.style.overflow = "";
  window.removeEventListener("keydown", onKey);
});
watch(selectedId, () => { testScope.value = testScope.value; });
</script>

<template>
  <div class="rx" role="dialog" aria-modal="true" :aria-label="$t('regex.title')">
    <div class="rx__scrim" @click="cancel" />
    <div class="rx__panel panel">
      <header class="rx__head">
        <h2>{{ $t("regex.title") }}</h2>
        <span class="subtle">{{ $t("regex.count", { n: set.rules.length, max: REGEX_LIMITS.rules }) }}</span>
        <div class="rx__head-acts">
          <button type="button" class="btn btn--sm btn--ghost" @click="cancel">{{ $t("dialog.cancel") }}</button>
          <button type="button" class="btn btn--sm btn--primary" :disabled="issues.length > 0" @click="done">{{ $t("regex.done") }}</button>
        </div>
      </header>

      <div class="rx__body">
        <!-- 左：清單 -->
        <aside class="rx__list">
          <input v-model="query" class="input" type="search" :placeholder="$t('regex.search')" :aria-label="$t('regex.search')" />
          <button type="button" class="btn btn--sm" :disabled="set.rules.length >= REGEX_LIMITS.rules" @click="add">{{ $t("regex.rule.add") }}</button>
          <ul class="rx__rules">
            <li v-for="rule in filtered" :key="rule.id" class="rx__rule" :class="{ 'rx__rule--on': rule.id === selectedId, 'rx__rule--off': !rule.enabled, 'rx__rule--bad': issueOf(rule.id) }">
              <input type="checkbox" v-model="rule.enabled" :aria-label="$t('regex.rule.enabled')" @click.stop />
              <button type="button" class="rx__rule-name" @click="selectedId = rule.id">
                <span class="rx__rule-title">{{ rule.name || $t("regex.rule.untitled") }}</span>
                <span class="subtle rx__rule-find">{{ rule.find }}</span>
              </button>
              <span class="rx__rule-tools">
                <button type="button" class="btn btn--icon btn--sm btn--ghost" :aria-label="$t('list.up')" :title="$t('list.up')" :disabled="set.rules.indexOf(rule) === 0" @click="move(rule, -1)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
                </button>
                <button type="button" class="btn btn--icon btn--sm btn--ghost" :aria-label="$t('list.down')" :title="$t('list.down')" :disabled="set.rules.indexOf(rule) === set.rules.length - 1" @click="move(rule, 1)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M18 13l-6 6-6-6" /></svg>
                </button>
                <button type="button" class="btn btn--icon btn--sm btn--ghost btn--danger" :aria-label="$t('regex.rule.delete')" :title="$t('regex.rule.delete')" @click="remove(rule)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" /></svg>
                </button>
              </span>
            </li>
          </ul>
          <p v-if="!set.rules.length" class="subtle rx__empty">{{ $t("regex.empty") }}</p>
        </aside>

        <!-- 右：編輯 -->
        <section v-if="selected" class="rx__edit">
          <div class="field">
            <label for="rx-name">{{ $t("regex.rule.name") }}</label>
            <input id="rx-name" v-model="selected.name" class="input" :maxlength="REGEX_LIMITS.name" />
            <span class="field__foot"><span /><span class="subtle count">{{ length(selected.name) }} / {{ REGEX_LIMITS.name }}</span></span>
          </div>
          <div class="field">
            <label for="rx-find">{{ $t("regex.rule.find") }}</label>
            <input id="rx-find" v-model="selected.find" class="input mono-input" spellcheck="false" :placeholder="$t('regex.rule.find.placeholder')" />
            <span class="field__foot">
              <span class="subtle" :class="{ over: findKind === 'bad' }">
                {{ findKind === "regex" ? $t("regex.rule.find.regex") : findKind === "bad" ? $t("regex.issue.badRegex") : $t("regex.rule.find.literal") }}
              </span>
              <span class="subtle count" :class="{ over: length(selected.find) > REGEX_LIMITS.find }">{{ length(selected.find) }} / {{ REGEX_LIMITS.find }}</span>
            </span>
          </div>
          <div class="field rx__replace">
            <label for="rx-replace">{{ $t("regex.rule.replace") }}</label>
            <textarea id="rx-replace" v-model="selected.replace" class="input mono-input" spellcheck="false" :placeholder="$t('regex.rule.replace.placeholder')" />
            <span class="field__foot">
              <span class="subtle">{{ $t("regex.rule.replace.hint") }}</span>
              <span class="subtle count" :class="{ over: length(selected.replace) > REGEX_LIMITS.replace }">{{ length(selected.replace) }} / {{ REGEX_LIMITS.replace }}</span>
            </span>
          </div>
        </section>
        <section v-else class="rx__edit rx__edit--empty">
          <p class="muted">{{ $t("regex.pick") }}</p>
        </section>
      </div>

      <!-- 底：測試台 + 全局設定 -->
      <footer class="rx__foot">
        <div class="rx__globals">
          <div class="field">
            <label for="rx-statusbar">{{ $t("regex.statusbar") }}</label>
            <input id="rx-statusbar" v-model="set.statusbar" class="input mono-input" spellcheck="false" :placeholder="$t('regex.statusbar.placeholder')" />
            <span class="field__foot">
              <span class="subtle">{{ $t("regex.statusbar.hint") }}</span>
              <span class="subtle count" :class="{ over: length(set.statusbar) > REGEX_LIMITS.statusbar }">{{ length(set.statusbar) }} / {{ REGEX_LIMITS.statusbar }}</span>
            </span>
          </div>
          <label class="check rx__lowered">
            <input v-model="set.lowered" type="checkbox" />
            <span>{{ $t("regex.lowered") }}</span>
            <span class="subtle">{{ $t("regex.lowered.hint") }}</span>
          </label>
        </div>
        <div class="rx__test">
          <div class="rx__test-head">
            <label for="rx-test">{{ $t("regex.test") }}</label>
            <div class="seg" role="radiogroup" :aria-label="$t('regex.test.scope')">
              <button type="button" class="seg__item" :class="{ 'seg__item--on': testScope === 'all' }" role="radio" :aria-checked="testScope === 'all'" @click="testScope = 'all'">{{ $t("regex.test.all") }}</button>
              <button type="button" class="seg__item" :class="{ 'seg__item--on': testScope === 'one' }" role="radio" :aria-checked="testScope === 'one'" :disabled="!selected" @click="testScope = 'one'">{{ $t("regex.test.one") }}</button>
            </div>
          </div>
          <div class="rx__test-panes">
            <textarea id="rx-test" v-model="testInput" class="input mono-input" rows="5" :placeholder="$t('regex.test.placeholder')" />
            <pre class="rx__out input mono-input" aria-live="polite">{{ testOutput || $t("regex.test.empty") }}</pre>
          </div>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.rx { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: var(--s-4); }
.rx__scrim { position: absolute; inset: 0; background: rgba(10, 10, 14, 0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.rx__panel {
  position: relative; width: min(1240px, 100%); height: min(92vh, 900px);
  display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden;
  box-shadow: var(--shadow-md), 0 0 0 1px var(--line);
}
.rx__head { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) var(--s-4); box-shadow: 0 1px 0 var(--line); }
.rx__head h2 { font-size: 16px; }
.rx__head-acts { margin-left: auto; display: flex; gap: var(--s-2); }

.rx__body { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 0; }
.rx__list { display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: var(--s-2); padding: var(--s-3); box-shadow: 1px 0 0 var(--line); min-height: 0; }
.rx__rules { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: grid; gap: 2px; align-content: start; }
.rx__rule { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: var(--r-sm); }
.rx__rule:hover { background: var(--surface-2); }
.rx__rule--on { background: var(--accent-tint); box-shadow: inset 2px 0 0 var(--accent); }
.rx__rule--off .rx__rule-title { color: var(--text-3); text-decoration: line-through; }
.rx__rule--bad .rx__rule-title { color: var(--danger); }
.rx__rule-name { flex: 1; min-width: 0; display: grid; text-align: left; background: none; border: 0; padding: 2px 0; cursor: pointer; }
.rx__rule-title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rx__rule-find { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rx__rule-tools { display: none; gap: 0; }
.rx__rule:hover .rx__rule-tools, .rx__rule--on .rx__rule-tools { display: inline-flex; }
.rx__empty { text-align: center; padding: var(--s-5) 0; }

.rx__edit { display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: 0; padding: var(--s-3) var(--s-4); min-height: 0; overflow: hidden; }
.rx__edit--empty { place-items: center; }
.rx__edit .field { margin-bottom: var(--s-2); gap: 6px; }
.rx__replace { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-height: 0; }
.rx__replace textarea { height: 100%; min-height: 160px; resize: none; }
.mono-input { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.55; }
.count { font-variant-numeric: tabular-nums; }
.over { color: var(--danger); }

.rx__foot { display: grid; grid-template-columns: 300px minmax(0, 1fr); box-shadow: 0 -1px 0 var(--line); }
.rx__globals { padding: var(--s-3); display: grid; gap: 0; box-shadow: 1px 0 0 var(--line); }
.rx__globals .field { margin-bottom: var(--s-2); gap: 6px; }
.rx__lowered { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; }
.rx__test { padding: var(--s-3) var(--s-4); display: grid; gap: var(--s-2); }
.rx__test-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.rx__test-head label { font-size: 13px; font-weight: 600; }
.rx__test-panes { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-2); }
.rx__test-panes textarea { resize: none; min-height: 120px; }
.rx__out { margin: 0; min-height: 120px; max-height: 160px; overflow: auto; white-space: pre-wrap; word-break: break-all; color: var(--text-2); }

@media (max-width: 900px) {
  .rx { padding: 0; }
  .rx__panel { height: 100vh; width: 100%; border-radius: 0; }
  .rx__body, .rx__foot { grid-template-columns: 1fr; }
  .rx__list { box-shadow: 0 1px 0 var(--line); grid-template-rows: auto auto 200px; }
  .rx__test-panes { grid-template-columns: 1fr; }
}
</style>
