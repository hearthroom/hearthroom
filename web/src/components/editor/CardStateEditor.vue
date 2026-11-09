<script setup lang="ts">
import PanelPreview from "@/components/editor/PanelPreview.vue";
/**
 * 卡片變數的編輯區：有哪些數值（表格／原始碼）、變數規則、面板皮膚。
 *
 * 骨架原文（dataText）是唯一的真相，表格只是它的另一種畫法（lib/card-state-table）：
 * 表格改一格就整份寫回原文，寫法（mvu／plain）跟著自動判斷，作者不必懂 MVU。
 * 表格放不下的結構只開原始碼分頁，不做部分顯示，免得表格改壞看不到的部分。
 * 表格的列留在本地：原文是我們自己剛寫回的就不重讀，重讀會換掉每一列的 id，正在打字的格子會失去焦點。
 * 名稱空白、重複或數字打到一半時先不寫回原文，錯誤標在那一格下面。
 *
 * 骨架是作者手打的 JSON，打到一半一定解不開，所以錯誤只在下面標出來、不擋輸入；
 * 存檔前編輯頁會再檢查一次（stateProblem），上游拒收時也照同一組句子講。
 * 每一輪都會把目前的數值整份送進對話，所以表格下面常駐一行「每一輪大約多送幾個字」，
 * 超過 4 KB 換成提醒的樣子——數值太多會讓每一輪變慢、變貴，作者應該在寫的時候就知道。
 *
 * 面板預覽：用遊玩畫布同一份渲染器（PanelPreview），預覽用的是開局的值。
 */
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  STATE_TURN_WARN_BYTES,
  formatJson,
  stateLimitParams,
  stateProblem,
  stateTurnSize,
  stateValues,
  type CardStateDraft,
} from "@/lib/card-state";
import {
  isNumberText,
  mergeStateExample,
  newRow,
  readStateTable,
  rowProblems,
  writeStateTable,
  type RowProblem,
  type StateKind,
  type StateRow,
  type StateTableRead,
} from "@/lib/card-state-table";
import { EXAMPLE_PANEL_SKIN } from "@/lib/state-panel-example";
import { confirmDialog } from "@/lib/confirm";
import examples from "@/locales/card-defaults/state-examples.json";

const props = defineProps<{ modelValue: CardStateDraft; language: string }>();
const emit = defineEmits<{ "update:modelValue": [CardStateDraft] }>();
const { t, locale } = useI18n();

const update = (patch: Partial<CardStateDraft>) => emit("update:modelValue", { ...props.modelValue, ...patch });
const field = <K extends keyof CardStateDraft>(key: K) =>
  computed({ get: () => props.modelValue[key], set: (value: CardStateDraft[K]) => update({ [key]: value } as Partial<CardStateDraft>) });
const dataText = field("dataText");
const rulesText = field("rulesText");
const template = field("template");

/** 骨架解不開時，盡量指出第幾行（各家瀏覽器的錯誤訊息格式不同，拿不到就只講格式有誤）。 */
const parseError = computed(() => {
  const text = props.modelValue.dataText;
  if (!text.trim()) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const line = /line (\d+)/i.exec(message)?.[1];
    const position = /position (\d+)/i.exec(message)?.[1];
    const at = line ? Number(line) : position ? text.slice(0, Number(position)).split("\n").length : 0;
    return at ? t("editor.state.data.errorAt", { line: at }) : t("editor.state.data.error");
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? "" : t("editor.state.data.notObject");
});

/** 解得開之後的其他問題（太大、太深、規則太長…），各標在自己那一格下面。 */
const problem = computed(() => (parseError.value ? null : stateProblem(props.modelValue)));
const problemText = computed(() => (problem.value ? t(`editor.state.reject.${problem.value}`, stateLimitParams()) : ""));
const dataProblem = computed(() => parseError.value || (problem.value && !["rules_text_size", "template_size"].includes(problem.value) ? problemText.value : ""));

const size = computed(() => (parseError.value ? null : stateTurnSize(props.modelValue)));
const sizeWarn = computed(() => (size.value?.bytes ?? 0) > STATE_TURN_WARN_BYTES);
const sizeText = computed(() =>
  size.value ? t(sizeWarn.value ? "editor.state.size.warn" : "editor.state.size", { n: size.value.chars.toLocaleString(String(locale.value)) }) : "",
);

/** 給預覽插槽的值：正規化之後、開局時送出的那份。 */
const values = computed(() => (parseError.value ? null : stateValues(props.modelValue)?.data ?? null));

// ---------------------------------------------------------------------------
// 表格

/** 打過、離開過的格子才標「名稱不能空白」「要是數字」，剛加的空白列不先罵人。 */
const touched = reactive(new Set<string>());
const read = ref<StateTableRead>({ ok: true, rows: [] });
const rows = ref<StateRow[]>([]);
/** 表格最後一次寫回的原文：props 帶回來的還是它，就不重讀。 */
let written: string | null = null;
watch(
  () => [props.modelValue.dataText, props.modelValue.convention, props.modelValue.pathRules] as const,
  () => {
    if (props.modelValue.dataText === written) return;
    written = null;
    read.value = readStateTable(props.modelValue);
    if (read.value.ok) {
      rows.value = read.value.rows;
      touched.clear();
    }
  },
  { immediate: true },
);

/** 改了表格的任何一格：沒有問題就整份寫回原文。 */
function commit() {
  const out = writeStateTable(rows.value);
  if (!out) return;
  if (out.dataText === props.modelValue.dataText && out.convention === props.modelValue.convention) return;
  written = out.dataText;
  emit("update:modelValue", { ...props.modelValue, ...out });
}

type Tab = "table" | "source";
const chosen = ref<Tab>("table");
/** 表格不能用的原因：原文解不開，或結構表格放不下。 */
const tableBlocked = computed(() => (read.value.ok ? null : read.value.reason));
// 被擋到原始碼時記住作者在原始碼：修好之後不自動跳回表格，免得打字打到一半畫面換掉
watch(tableBlocked, (blocked) => { if (blocked) chosen.value = "source"; }, { immediate: true });
const tab = computed<Tab>(() => (tableBlocked.value ? "source" : chosen.value));
const TABS: Tab[] = ["table", "source"];
const tabDisabled = (x: Tab) => x === "table" && !!tableBlocked.value;
const tableTitle = computed(() => (tableBlocked.value === "invalid" ? t("editor.state.view.invalid") : tableBlocked.value === "unsupported" ? t("editor.state.view.unsupported") : undefined));
const root = ref<HTMLElement | null>(null);

function selectTab(x: Tab, focus = false) {
  if (tabDisabled(x)) return;
  chosen.value = x;
  if (focus) void nextTick(() => root.value?.querySelector<HTMLElement>(`#f-state-tab-${x}`)?.focus());
}
function onTabKey(e: KeyboardEvent) {
  const list = TABS.filter((x) => !tabDisabled(x));
  const at = list.indexOf(tab.value);
  const next = e.key === "ArrowRight" ? list[(at + 1) % list.length]
    : e.key === "ArrowLeft" ? list[(at - 1 + list.length) % list.length]
    : e.key === "Home" ? list[0] : e.key === "End" ? list[list.length - 1] : null;
  if (!next) return;
  e.preventDefault();
  selectTab(next, true);
}

const touch = (row: StateRow, part: "name" | "value") => touched.add(`${row.id}:${part}`);
const problems = (siblings: StateRow[], row: StateRow): RowProblem[] => rowProblems(siblings, row);
function nameError(siblings: StateRow[], row: StateRow): string {
  const list = problems(siblings, row);
  if (list.includes("name_reserved")) return t("editor.state.name.reserved");
  if (list.includes("name_duplicate")) return t("editor.state.name.duplicate");
  if (list.includes("name_empty") && touched.has(`${row.id}:name`)) return t("editor.state.name.empty");
  return "";
}
const numberError = (row: StateRow): string =>
  row.kind === "number" && !isNumberText(row.value.trim()) && touched.has(`${row.id}:value`) ? t("editor.state.number.invalid") : "";

const kindLabel = (row: StateRow): string =>
  row.kind === "group" ? t("editor.state.group.count", { n: row.children.length }) : t(`editor.state.kind.${row.kind}`);
const rowLabel = (row: StateRow): string => row.name.trim() || t("editor.state.row.unnamed");

const collapsed = reactive(new Set<number>());
function toggle(row: StateRow) {
  if (collapsed.has(row.id)) collapsed.delete(row.id);
  else collapsed.add(row.id);
}

const ADD_KINDS: Array<Exclude<StateKind, "boolean">> = ["number", "text", "list", "group"];
const CHILD_KINDS: Array<Exclude<StateKind, "boolean" | "group">> = ["number", "text", "list"];

/** 加一列後把焦點放進它的名稱格：新列沒有名稱，先取名才會寫回原文。 */
function focusName(row: StateRow) {
  void nextTick(() => root.value?.querySelector<HTMLInputElement>(`[data-name-of="${row.id}"]`)?.focus());
}
function addRow(kind: Exclude<StateKind, "boolean">) {
  const row = newRow(kind);
  rows.value.push(row);
  focusName(row);
}
function addChild(group: StateRow, kind: Exclude<StateKind, "boolean" | "group">) {
  const row = newRow(kind);
  group.children.push(row);
  collapsed.delete(group.id);
  focusName(row);
}
function removeRow(list: StateRow[], row: StateRow) {
  list.splice(list.indexOf(row), 1);
  commit();
}

// 清單：chip 列＋「＋」。新項目的種類跟著清單原有的項目（全是數字就收數字、全是是否就收是否），其餘當文字。
const adding = ref<number | null>(null);
const draftItem = ref("");
function startAdd(row: StateRow) {
  adding.value = row.id;
  draftItem.value = "";
  void nextTick(() => root.value?.querySelector<HTMLInputElement>(`[data-item-of="${row.id}"]`)?.focus());
}
function addItem(row: StateRow, keepOpen: boolean) {
  const v = draftItem.value.trim();
  if (v) {
    const all = (kind: string) => row.items.length > 0 && row.items.every((i) => i.kind === kind);
    if (all("number") && isNumberText(v)) row.items.push({ kind: "number", value: v });
    else if (all("boolean") && (v === "true" || v === "false")) row.items.push({ kind: "boolean", value: v });
    else row.items.push({ kind: "text", value: v });
    commit();
  }
  draftItem.value = "";
  if (!keepOpen) adding.value = null;
}
function cancelAdd() {
  draftItem.value = "";
  adding.value = null;
}
function removeItem(row: StateRow, index: number) {
  row.items.splice(index, 1);
  commit();
}

// ---------------------------------------------------------------------------
// 範例

type ExampleKey = "affection" | "inventory" | "quests";
const EXAMPLES: ExampleKey[] = ["affection", "inventory", "quests"];
type ExampleSet = Record<ExampleKey, Record<string, unknown>>;

/**
 * 插入範例：範例跟著卡片語言（鍵名是那個語言的字），本身是 MVU 寫法（帶規則）。骨架是空的就直接放；
 * 解得開就把範例的項目併進去（同名的由範例蓋掉）；解不開時先問要不要整份換掉。
 */
async function insertExample(key: ExampleKey) {
  const set = (examples as Record<string, ExampleSet>)[props.language] ?? (examples as Record<string, ExampleSet>).en;
  const merged = mergeStateExample(props.modelValue, set[key]);
  if (merged) return update(merged);
  const ok = await confirmDialog({ message: t("editor.state.example.replace"), confirmText: t("editor.state.example.replaceConfirm"), danger: true });
  if (ok) update({ dataText: formatJson(set[key]), convention: "mvu" });
}

const useExampleSkin = () => update({ template: EXAMPLE_PANEL_SKIN });
</script>

<template>
  <div ref="root" class="cstate">
    <!-- 有哪些數值 -->
    <section class="cstate__block" aria-labelledby="f-state-values">
      <div class="cstate__head">
        <h3 id="f-state-values" class="cstate__title">{{ $t("editor.state.values") }}</h3>
        <div class="seg cstate__seg" role="tablist" aria-labelledby="f-state-values" @keydown="onTabKey">
          <button v-for="x in TABS" :id="`f-state-tab-${x}`" :key="x" type="button" role="tab" class="seg__item"
                  :class="{ 'seg__item--on': tab === x, 'cstate__tab--off': tabDisabled(x) }"
                  :aria-selected="tab === x ? 'true' : 'false'" :aria-controls="`f-state-pane-${x}`"
                  :aria-disabled="tabDisabled(x) ? 'true' : undefined" :title="x === 'table' ? tableTitle : undefined"
                  :tabindex="tab === x ? 0 : -1" @click="selectTab(x)">{{ $t(`editor.state.view.${x}`) }}</button>
        </div>
      </div>

      <!-- 表格 -->
      <div v-show="tab === 'table'" id="f-state-pane-table" role="tabpanel" aria-labelledby="f-state-tab-table" class="cstate__pane">
        <span class="subtle">{{ $t("editor.state.table.hint") }}</span>
        <div v-if="rows.length" class="ctable">
          <div class="ctable__head ctable__row" aria-hidden="true">
            <span>{{ $t("editor.state.col.name") }}</span>
            <span>{{ $t("editor.state.col.value") }}</span>
            <span>{{ $t("editor.state.col.rule") }}</span>
            <span />
          </div>
          <template v-for="row in rows" :key="row.id">
            <div class="ctable__row" :class="{ 'ctable__row--group': row.kind === 'group' }">
              <!-- 名稱＋種類 -->
              <div class="ctable__cell ctable__name">
                <div class="ctable__namebox">
                  <button v-if="row.kind === 'group'" type="button" class="btn btn--ghost btn--icon ctable__toggle"
                          :aria-expanded="collapsed.has(row.id) ? 'false' : 'true'" :aria-controls="`f-state-kids-${row.id}`"
                          :aria-label="$t('editor.state.group.toggle', { name: rowLabel(row) })" @click="toggle(row)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                  <input v-model="row.name" class="input" :data-name-of="row.id" autocomplete="off" spellcheck="false"
                         :aria-label="$t('editor.state.col.name')" :aria-invalid="nameError(rows, row) ? 'true' : undefined"
                         @input="commit" @blur="touch(row, 'name')" />
                  <span class="ctable__kind">{{ kindLabel(row) }}</span>
                </div>
                <p v-if="nameError(rows, row)" class="cstate__error" role="alert">{{ nameError(rows, row) }}</p>
              </div>
              <!-- 開局值 -->
              <div class="ctable__cell ctable__value">
                <span class="ctable__cap" aria-hidden="true">{{ $t("editor.state.col.value") }}</span>
                <template v-if="row.kind === 'group'">
                  <label class="ctable__check">
                    <input v-model="row.extensible" type="checkbox" @change="commit" />
                    <span>{{ $t("editor.state.group.extensible") }}</span>
                  </label>
                </template>
                <template v-else-if="row.kind === 'list'">
                  <div class="ctable__chips">
                    <span v-for="(item, i) in row.items" :key="i" class="chip ctable__chip">
                      <span class="ctable__chiptext">{{ item.value }}</span>
                      <button type="button" class="ctable__chipx" :aria-label="$t('editor.state.list.remove', { item: item.value })" @click="removeItem(row, i)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
                      </button>
                    </span>
                    <input v-if="adding === row.id" v-model="draftItem" class="input ctable__chipin" :data-item-of="row.id"
                           autocomplete="off" :aria-label="$t('editor.state.list.add', { name: rowLabel(row) })"
                           @keydown.enter.prevent="addItem(row, true)" @keydown.esc.prevent="cancelAdd" @blur="addItem(row, false)" />
                    <button v-else type="button" class="chip ctable__chipadd" :aria-label="$t('editor.state.list.add', { name: rowLabel(row) })" @click="startAdd(row)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
                  </div>
                </template>
                <select v-else-if="row.kind === 'boolean'" v-model="row.value" class="input" :aria-label="`${rowLabel(row)} · ${$t('editor.state.col.value')}`" @change="commit">
                  <option value="true">{{ $t("editor.state.bool.true") }}</option>
                  <option value="false">{{ $t("editor.state.bool.false") }}</option>
                </select>
                <template v-else>
                  <input v-model="row.value" class="input" autocomplete="off"
                         :aria-label="`${rowLabel(row)} · ${$t('editor.state.col.value')}`" :aria-invalid="numberError(row) ? 'true' : undefined"
                         @input="commit" @blur="touch(row, 'value')" />
                  <p v-if="numberError(row)" class="cstate__error" role="alert">{{ numberError(row) }}</p>
                </template>
              </div>
              <!-- 什麼時候變 -->
              <div class="ctable__cell ctable__rule">
                <span class="ctable__cap" aria-hidden="true">{{ $t("editor.state.col.rule") }}</span>
                <input v-model="row.rule" class="input" autocomplete="off" :placeholder="$t('editor.state.rule.placeholder')"
                       :aria-label="`${rowLabel(row)} · ${$t('editor.state.col.rule')}`" @input="commit" />
              </div>
              <button type="button" class="btn btn--ghost btn--icon ctable__remove" :aria-label="$t('editor.state.row.remove', { name: rowLabel(row) })" @click="removeRow(rows, row)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
              </button>
            </div>

            <!-- 群組的子列 -->
            <div v-if="row.kind === 'group'" v-show="!collapsed.has(row.id)" :id="`f-state-kids-${row.id}`" class="ctable__kids">
              <div v-for="kid in row.children" :key="kid.id" class="ctable__row">
                <div class="ctable__cell ctable__name">
                  <div class="ctable__namebox">
                    <input v-model="kid.name" class="input" :data-name-of="kid.id" autocomplete="off" spellcheck="false"
                           :aria-label="`${rowLabel(row)} · ${$t('editor.state.col.name')}`" :aria-invalid="nameError(row.children, kid) ? 'true' : undefined"
                           @input="commit" @blur="touch(kid, 'name')" />
                    <span class="ctable__kind">{{ kindLabel(kid) }}</span>
                  </div>
                  <p v-if="nameError(row.children, kid)" class="cstate__error" role="alert">{{ nameError(row.children, kid) }}</p>
                </div>
                <div class="ctable__cell ctable__value">
                  <span class="ctable__cap" aria-hidden="true">{{ $t("editor.state.col.value") }}</span>
                  <div v-if="kid.kind === 'list'" class="ctable__chips">
                    <span v-for="(item, i) in kid.items" :key="i" class="chip ctable__chip">
                      <span class="ctable__chiptext">{{ item.value }}</span>
                      <button type="button" class="ctable__chipx" :aria-label="$t('editor.state.list.remove', { item: item.value })" @click="removeItem(kid, i)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
                      </button>
                    </span>
                    <input v-if="adding === kid.id" v-model="draftItem" class="input ctable__chipin" :data-item-of="kid.id"
                           autocomplete="off" :aria-label="$t('editor.state.list.add', { name: rowLabel(kid) })"
                           @keydown.enter.prevent="addItem(kid, true)" @keydown.esc.prevent="cancelAdd" @blur="addItem(kid, false)" />
                    <button v-else type="button" class="chip ctable__chipadd" :aria-label="$t('editor.state.list.add', { name: rowLabel(kid) })" @click="startAdd(kid)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
                  </div>
                  <select v-else-if="kid.kind === 'boolean'" v-model="kid.value" class="input" :aria-label="`${rowLabel(kid)} · ${$t('editor.state.col.value')}`" @change="commit">
                    <option value="true">{{ $t("editor.state.bool.true") }}</option>
                    <option value="false">{{ $t("editor.state.bool.false") }}</option>
                  </select>
                  <template v-else>
                    <input v-model="kid.value" class="input" autocomplete="off"
                           :aria-label="`${rowLabel(kid)} · ${$t('editor.state.col.value')}`" :aria-invalid="numberError(kid) ? 'true' : undefined"
                           @input="commit" @blur="touch(kid, 'value')" />
                    <p v-if="numberError(kid)" class="cstate__error" role="alert">{{ numberError(kid) }}</p>
                  </template>
                </div>
                <div class="ctable__cell ctable__rule">
                  <span class="ctable__cap" aria-hidden="true">{{ $t("editor.state.col.rule") }}</span>
                  <input v-model="kid.rule" class="input" autocomplete="off" :placeholder="$t('editor.state.rule.placeholder')"
                         :aria-label="`${rowLabel(kid)} · ${$t('editor.state.col.rule')}`" @input="commit" />
                </div>
                <button type="button" class="btn btn--ghost btn--icon ctable__remove" :aria-label="$t('editor.state.row.remove', { name: rowLabel(kid) })" @click="removeRow(row.children, kid)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
                </button>
              </div>
              <div class="ctable__kidadd" role="group" :aria-label="`${rowLabel(row)} · ${$t('editor.state.group.add')}`">
                <span class="subtle">{{ $t("editor.state.group.add") }}</span>
                <button v-for="kind in CHILD_KINDS" :key="kind" type="button" class="btn btn--sm btn--ghost" @click="addChild(row, kind)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                  {{ $t(`editor.state.kind.${kind}`) }}
                </button>
              </div>
            </div>
          </template>
        </div>
        <p v-else class="subtle cstate__empty">{{ $t("editor.state.table.empty") }}</p>
        <p v-if="dataProblem && tab === 'table'" class="cstate__error" role="alert">{{ dataProblem }}</p>
        <div class="cstate__actions" role="group" :aria-label="$t('editor.state.add')">
          <span class="subtle">{{ $t("editor.state.add") }}</span>
          <button v-for="kind in ADD_KINDS" :key="kind" type="button" class="btn btn--sm" @click="addRow(kind)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            {{ $t(`editor.state.kind.${kind}`) }}
          </button>
        </div>
      </div>

      <!-- 原始碼 -->
      <div v-show="tab === 'source'" id="f-state-pane-source" role="tabpanel" aria-labelledby="f-state-tab-source" class="cstate__pane">
        <p v-if="tableBlocked === 'unsupported'" class="notice cstate__note">{{ $t("editor.state.view.unsupported") }}</p>
        <textarea id="f-state-data" v-model="dataText" class="input cstate__code" rows="10" spellcheck="false" autocomplete="off"
                  autocapitalize="off" aria-labelledby="f-state-values" :aria-invalid="dataProblem ? 'true' : undefined"
                  :aria-describedby="dataProblem ? 'f-state-data-error' : 'f-state-source-hint'" />
        <p v-if="dataProblem && tab === 'source'" id="f-state-data-error" class="cstate__error" role="alert">{{ dataProblem }}</p>
        <span id="f-state-source-hint" class="subtle">{{ $t("editor.state.source.hint") }}</span>
      </div>

      <div class="cstate__actions" role="group" :aria-label="$t('editor.state.examples')">
        <span class="subtle">{{ $t("editor.state.examples") }}</span>
        <button v-for="key in EXAMPLES" :key="key" type="button" class="btn btn--sm" @click="insertExample(key)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {{ $t(`editor.state.example.${key}`) }}
        </button>
      </div>
      <span v-if="sizeText && !sizeWarn" class="subtle cstate__size" role="status">{{ sizeText }}</span>
      <p v-if="sizeText && sizeWarn" class="cstate__warn" role="status">{{ sizeText }}</p>
    </section>

    <!-- 變數規則 -->
    <div class="field">
      <label for="f-state-rules">{{ $t("editor.state.rules") }}</label>
      <textarea id="f-state-rules" v-model="rulesText" class="input" rows="5" autocomplete="off"
                :aria-invalid="problem === 'rules_text_size' ? 'true' : undefined" />
      <p v-if="problem === 'rules_text_size'" class="cstate__error" role="alert">{{ problemText }}</p>
      <span class="subtle">{{ $t("editor.state.rules.hint") }}</span>
    </div>

    <!-- 面板皮膚：左程式碼、右預覽 -->
    <div class="cstate__skin">
      <div class="field cstate__skincode">
        <label for="f-state-template">{{ $t("editor.state.template") }}</label>
        <textarea id="f-state-template" v-model="template" class="input cstate__code" rows="10" spellcheck="false" autocomplete="off"
                  autocapitalize="off" :aria-invalid="problem === 'template_size' ? 'true' : undefined" />
        <p v-if="problem === 'template_size'" class="cstate__error" role="alert">{{ problemText }}</p>
        <span class="subtle">{{ $t("editor.state.template.hint") }}</span>
      </div>
      <div class="field cstate__skinview">
        <span class="cstate__label">{{ $t("editor.state.preview") }} <span class="cstate__labelnote">{{ $t("editor.state.preview.opening") }}</span></span>
        <PanelPreview v-if="modelValue.template.trim()" :template="modelValue.template" :data="values" />
        <div v-else class="cstate__skinempty">
          <p class="muted">{{ $t("editor.state.preview.empty") }}</p>
          <button type="button" class="btn btn--sm" @click="useExampleSkin">{{ $t("editor.state.template.example") }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cstate { display: grid; gap: var(--s-5); }
.cstate .field { margin-bottom: 0; }
.cstate__block { display: grid; gap: var(--s-3); }
.cstate__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); flex-wrap: wrap; }
.cstate__title { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.3; }
.cstate__label { font-size: 13px; font-weight: 600; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cstate__labelnote { font-weight: 400; color: var(--text-3); }
.cstate__seg { flex: none; }
.cstate__tab--off { opacity: .45; cursor: not-allowed; }
.cstate__tab--off:hover { color: var(--text-2); }
.cstate__pane { display: grid; gap: var(--s-2); }
.cstate__note { margin: 0; }
.cstate__empty { margin: 0; }
.cstate__actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.cstate__code {
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  tab-size: 2;
  white-space: pre;
  overflow-x: auto;
}
.cstate__size { font-variant-numeric: tabular-nums; }
.cstate__error { margin: 0; color: var(--danger); font-size: 13px; line-height: 1.6; }
.cstate__warn {
  margin: 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-sm);
  background: var(--gold-soft); color: var(--text); font-size: 13px; line-height: 1.6;
}

/* 表格：名稱｜開局值｜什麼時候變｜移除。同一列的輸入框同高（--h-md）、上緣對齊，錯誤寫在格子下面 */
.ctable { display: grid; gap: var(--s-1); }
.ctable__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr) minmax(0, 1.25fr) var(--h-md);
  gap: var(--s-2);
  align-items: start;
}
.ctable__head { font-size: 13px; font-weight: 600; line-height: 1.3; color: var(--text-2); padding-bottom: var(--s-1); }
.ctable__head > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ctable__cell { display: grid; gap: var(--s-1); align-content: start; min-width: 0; }
.ctable__cell .input, .ctable__cell select { height: var(--h-md); min-width: 0; }
.ctable__namebox { display: flex; align-items: center; gap: var(--s-2); min-width: 0; }
.ctable__namebox .input { flex: 1; }
.ctable__kind { flex: none; font-size: 12px; color: var(--text-3); white-space: nowrap; }
.ctable__toggle { flex: none; }
.ctable__toggle svg { width: 16px; height: 16px; transition: transform var(--dur) var(--ease); }
.ctable__toggle[aria-expanded="true"] svg { transform: rotate(90deg); }
.ctable__cap { display: none; font-size: 12px; color: var(--text-3); }
.ctable__check { display: flex; align-items: center; gap: var(--s-2); min-height: var(--h-md); font-size: 13px; cursor: pointer; }
.ctable__check input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
.ctable__chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1); min-height: var(--h-md); }
.ctable__chip { cursor: default; padding-right: 4px; max-width: 100%; }
.ctable__chiptext { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ctable__chipx {
  display: flex; align-items: center; justify-content: center; flex: none;
  width: 18px; height: 18px; padding: 0; border: 0; border-radius: var(--r-pill);
  background: transparent; color: var(--text-3); cursor: pointer;
}
.ctable__chipx:hover { color: var(--text); background: var(--surface); }
.ctable__chipx svg { width: 12px; height: 12px; }
.ctable__chipadd { justify-content: center; width: 26px; padding: 0; }
.ctable__chipadd svg { width: 14px; height: 14px; }
.ctable__cell .ctable__chipin { height: 26px; width: 9em; padding: 0 var(--s-2); font-size: 12px; }
.ctable__remove svg { width: 16px; height: 16px; }
.ctable__kids {
  display: grid; gap: var(--s-1);
  margin-left: calc(var(--h-md) + var(--s-2));
  padding: var(--s-2); border-radius: var(--r-sm);
  background: var(--surface-2);
}
.ctable__kidadd { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1); }

/* 面板皮膚：桌機左程式碼、右預覽 */
.cstate__skin { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--s-4); align-items: start; }
.cstate__skinview { align-content: start; }
.cstate__skinempty {
  display: grid; justify-items: start; gap: var(--s-2);
  min-height: 160px; align-content: center; padding: var(--s-4);
  border: 1px dashed var(--line-strong); border-radius: var(--r-sm);
}
.cstate__skinempty p { margin: 0; font-size: 13px; }

@media (max-width: 760px) {
  .ctable__head { display: none; }
  .ctable__row {
    grid-template-columns: minmax(0, 1fr) var(--h-md);
    grid-template-areas: "name remove" "value value" "rule rule";
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--line);
  }
  .ctable__kids .ctable__row:last-of-type { border-bottom: 0; }
  .ctable__name { grid-area: name; }
  .ctable__value { grid-area: value; }
  .ctable__rule { grid-area: rule; }
  .ctable__remove { grid-area: remove; }
  .ctable__cap { display: block; }
  .ctable__kids { margin-left: var(--s-3); }
  .cstate__skin { grid-template-columns: minmax(0, 1fr); }
}
:lang(ko) .cstate .subtle, :lang(ko) .cstate__warn, :lang(ko) .cstate__error, :lang(ko) .cstate__note { word-break: keep-all; }
:lang(ja) .cstate .subtle, :lang(ja) .cstate__warn, :lang(ja) .cstate__error, :lang(ja) .cstate__note { word-break: auto-phrase; }
</style>
