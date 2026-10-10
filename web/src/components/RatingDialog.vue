<script setup lang="ts">
/**
 * 分級作者自評問卷（owner 2026-10-10）。
 *
 * 照官方「分級級別評量系統」的走法：先複選這張卡會出現哪些內容，再就每一類選最接近、
 * 而且不低於實際內容的那一項，最後一題問其他可能的不良影響，結果取最高級別。
 * 帶著上一份答案打開時直接停在結果，作者確認沿用或回頭改。題目文字在 shared/content-rating.ts。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RATING_INTRO, RATING_OTHER, RATING_PICK_RULE, RATING_QUESTIONNAIRE_VERSION, RATING_TOPICS, type RatingAnswers, type Topic } from "../../../shared/content-rating";
import { descriptorList, markSrc, rate, ratingLocale, ratingName, ratingState } from "@/lib/rating";
import RatingMark from "./RatingMark.vue";

const { locale, t } = useI18n();
const l = computed(() => ratingLocale(String(locale.value)));
type Step = "pick" | "detail" | "other" | "result";
const step = ref<Step>("pick");
const picked = ref<Topic[]>([]);
const none = ref(false);
const options = ref<Partial<Record<Topic, string>>>({});
const other = ref("");
const missing = ref(false);
const box = ref<HTMLElement | null>(null);
const body = ref<HTMLElement | null>(null);

const answers = computed<RatingAnswers>(() => ({
  version: RATING_QUESTIONNAIRE_VERSION,
  topics: Object.fromEntries(picked.value.map((id) => [id, options.value[id] ?? ""])),
  other: other.value,
}));
const result = computed(() => rate(answers.value));
const topicsShown = computed(() => RATING_TOPICS.filter((x) => picked.value.includes(x.id)));
const stepIndex = computed(() => (["pick", "detail", "other", "result"] as Step[]).filter((s) => s !== "detail" || picked.value.length).indexOf(step.value) + 1);
const stepTotal = computed(() => (picked.value.length ? 4 : 3));

watch(() => ratingState.current, async (cur) => {
  if (!cur) return;
  const init = cur.initial;
  picked.value = init ? (Object.keys(init.topics) as Topic[]) : [];
  options.value = init ? { ...init.topics } : {};
  other.value = init?.other ?? "";
  none.value = !!init && picked.value.length === 0;
  step.value = init ? "result" : "pick";
  missing.value = false;
  await nextTick();
  box.value?.querySelector<HTMLElement>("input, button")?.focus();
});
watch([picked, none, options, other], () => { missing.value = false; }, { deep: true });

function togglePick(id: Topic) {
  none.value = false;
  picked.value = picked.value.includes(id) ? picked.value.filter((x) => x !== id) : [...picked.value, id];
  // 只有一個選項的類型（菸酒、戀愛交友）勾了就等於選了那一項，不必再點一次
  const only = RATING_TOPICS.find((x) => x.id === id)?.options;
  if (only?.length === 1 && picked.value.includes(id)) options.value = { ...options.value, [id]: only[0]!.id };
}
function pickNone() {
  none.value = !none.value;
  if (none.value) picked.value = [];
}

function next() {
  if (step.value === "pick") {
    if (!none.value && !picked.value.length) { missing.value = true; return; }
    step.value = picked.value.length ? "detail" : "other";
  } else if (step.value === "detail") {
    if (picked.value.some((id) => !options.value[id])) { missing.value = true; return; }
    step.value = "other";
  } else if (step.value === "other") {
    if (!other.value) { missing.value = true; return; }
    step.value = "result";
  }
  body.value?.scrollTo?.({ top: 0 });
}
function back() {
  step.value = step.value === "other" ? (picked.value.length ? "detail" : "pick") : "pick";
}
function confirm() {
  if (result.value) ratingState.current?.resolve(result.value.answers);
}
const cancel = () => ratingState.current?.resolve(null);

function onKey(e: KeyboardEvent) {
  if (ratingState.current && e.key === "Escape") { e.preventDefault(); cancel(); }
}
onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>


<template>
  <Teleport to="body">
    <div v-if="ratingState.current" class="dlg-backdrop" @click.self="cancel">
      <div ref="box" class="dlg panel rating-dlg" role="dialog" aria-modal="true" aria-labelledby="rating-title" data-rating-dialog>
        <header class="rating-dlg__head">
          <div class="rating-dlg__title-row">
            <h2 id="rating-title" class="rating-dlg__title">{{ $t("rating.title") }}</h2>
            <span class="rating-dlg__step">{{ $t("rating.step", { n: stepIndex, total: stepTotal }) }}</span>
          </div>
          <div class="rating-dlg__progress" aria-hidden="true">
            <span v-for="i in stepTotal" :key="i" :class="{ on: i <= stepIndex }" />
          </div>
        </header>

        <div ref="body" class="rating-dlg__body">
          <template v-if="step === 'pick'">
            <p class="rating-dlg__lead">{{ RATING_INTRO[l] }}</p>
            <fieldset class="rating-dlg__group">
              <legend class="rating-dlg__q">{{ $t("rating.pick") }}</legend>
              <div class="tiles">
                <label v-for="topic in RATING_TOPICS" :key="topic.id" class="tile" :class="{ 'tile--on': picked.includes(topic.id) }">
                  <input class="sr-only" type="checkbox" :checked="picked.includes(topic.id)" :data-topic="topic.id" @change="togglePick(topic.id)" />
                  <span class="tile__label">{{ topic.title[l] }}</span>
                  <svg class="tile__check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </label>
                <label class="tile tile--wide" :class="{ 'tile--on': none }">
                  <input class="sr-only" type="checkbox" :checked="none" data-topic="none" @change="pickNone" />
                  <span class="tile__label">{{ $t("rating.none") }}</span>
                  <svg class="tile__check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </label>
              </div>
            </fieldset>
          </template>

          <template v-else-if="step === 'detail'">
            <p class="rating-dlg__lead">{{ RATING_PICK_RULE[l] }}</p>
            <fieldset v-for="topic in topicsShown" :key="topic.id" class="rating-dlg__group">
              <legend class="rating-dlg__q">{{ topic.title[l] }}</legend>
              <label v-for="opt in topic.options" :key="opt.id" class="choice" :class="{ 'choice--on': options[topic.id] === opt.id }">
                <input v-model="options[topic.id]" class="sr-only" type="radio" :name="`rating-${topic.id}`" :value="opt.id" :data-option="opt.id" />
                <span class="choice__dot" aria-hidden="true" />
                <span class="choice__text">{{ opt.text[l] }}</span>
                <RatingMark :rating="opt.rating" variant="chip" class="choice__level" />
              </label>
            </fieldset>
          </template>

          <template v-else-if="step === 'other'">
            <fieldset class="rating-dlg__group">
              <legend class="rating-dlg__q">{{ RATING_OTHER.title[l] }}</legend>
              <label v-for="opt in RATING_OTHER.options" :key="opt.id" class="choice" :class="{ 'choice--on': other === opt.id }">
                <input v-model="other" class="sr-only" type="radio" name="rating-other" :value="opt.id" :data-option="opt.id" />
                <span class="choice__dot" aria-hidden="true" />
                <span class="choice__text">{{ opt.text[l] }}</span>
                <RatingMark v-if="opt.rating !== 'G'" :rating="opt.rating" variant="chip" class="choice__level" />
              </label>
            </fieldset>
          </template>

          <div v-else-if="result" class="result" data-rating-mark>
            <p class="rating-dlg__q">{{ $t("rating.result") }}</p>
            <img :src="markSrc(result.rating)" width="88" height="88" :alt="ratingName(result.rating, String(locale))" class="result__mark" />
            <strong class="result__name">{{ ratingName(result.rating, String(locale)) }}</strong>
            <span v-if="result.descriptors.length" class="result__contains">{{ $t("rating.contains", { list: descriptorList(result.descriptors, String(locale)) }) }}</span>
            <p class="result__note">{{ $t("rating.policy") }}</p>
          </div>

          <p v-if="missing" class="rating-dlg__missing" role="alert">{{ $t(step === "pick" ? "rating.missingPick" : "rating.missingOption") }}</p>
        </div>

        <footer class="rating-dlg__actions">
          <button v-if="step === 'pick'" class="btn" data-cancel @click="cancel">{{ $t("dialog.cancel") }}</button>
          <!-- 結果頁的左鍵是「修改」：從第一題重看一遍，答案都還在 -->
          <button v-else-if="step === 'result'" class="btn" data-back @click="step = 'pick'">{{ $t("rating.edit") }}</button>
          <button v-else class="btn" data-back @click="back">{{ $t("rating.back") }}</button>
          <button v-if="step !== 'result'" class="btn btn--primary" data-next @click="next">{{ $t("rating.next") }}</button>
          <button v-else class="btn btn--primary" data-confirm :disabled="!result" @click="confirm">{{ $t("rating.confirm") }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 105：蓋過編輯器裡的全頁浮層（100），但低於確認框（110）——問卷結束後才會叫出送審確認 */
.dlg-backdrop {
  position: fixed; inset: 0; z-index: 105;
  display: grid; place-items: center; padding: var(--s-5);
  background: rgba(16, 16, 24, 0.45);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
/* 頭與按鈕固定，中間捲：題目再長，進度與「下一步」都在原位 */
.rating-dlg {
  width: min(520px, 100%); max-height: min(760px, calc(100dvh - 2 * var(--s-5)));
  display: flex; flex-direction: column; overflow: hidden; padding: 0;
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
}
.rating-dlg__head { padding: var(--s-5) var(--s-5) var(--s-3); display: grid; gap: var(--s-3); }
.rating-dlg__title-row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-3); }
.rating-dlg__title { font-size: 17px; font-weight: 600; }
.rating-dlg__step { font-size: 12.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.rating-dlg__progress { display: flex; gap: 4px; }
.rating-dlg__progress span { flex: 1; height: 3px; border-radius: var(--r-pill); background: var(--surface-2); transition: background var(--dur) var(--ease); }
.rating-dlg__progress span.on { background: var(--accent); }
.rating-dlg__body { flex: 1; overflow-y: auto; padding: var(--s-2) var(--s-5) var(--s-4); display: grid; gap: var(--s-5); align-content: start; }
.rating-dlg__lead { font-size: 13.5px; line-height: 1.6; color: var(--text-2); }
.rating-dlg__group { display: grid; gap: var(--s-2); margin: 0; padding: 0; border: 0; min-width: 0; }
.rating-dlg__q { padding: 0; margin-bottom: var(--s-1); font-size: 14px; font-weight: 600; }
.rating-dlg__missing { font-size: 13px; color: var(--danger); }
.rating-dlg__actions {
  display: flex; justify-content: flex-end; gap: var(--s-2);
  padding: var(--s-3) var(--s-5) var(--s-4); border-top: 1px solid var(--line);
}

/* 類型：兩欄方塊，選了換色並打勾 */
.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-2); }
.tile {
  position: relative; display: flex; align-items: center; justify-content: space-between; gap: var(--s-2);
  min-height: 44px; padding: 0 var(--s-3); border: 1px solid var(--border-strong); border-radius: var(--r-md);
  font-size: 14px; cursor: pointer; user-select: none;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.tile:hover { border-color: var(--line-strong); background: var(--surface-2); }
.tile--wide { grid-column: 1 / -1; }
.tile__check { width: 16px; height: 16px; flex: none; color: var(--accent); opacity: 0; transition: opacity var(--dur) var(--ease); }
.tile--on { border-color: var(--accent); background: var(--accent-tint); }
.tile--on .tile__check { opacity: 1; }
.tile:has(input:focus-visible), .choice:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }

/* 描述：整列可點，右邊標出這一項對應的級別 */
.choice {
  display: flex; align-items: flex-start; gap: var(--s-3);
  padding: var(--s-3); border: 1px solid var(--border-strong); border-radius: var(--r-md);
  font-size: 14px; line-height: 1.5; cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.choice:hover { background: var(--surface-2); }
.choice--on { border-color: var(--accent); background: var(--accent-tint); }
.choice__dot {
  flex: none; width: 16px; height: 16px; margin-top: 3px; border-radius: 50%;
  border: 1.5px solid var(--border-strong); background: var(--surface);
  transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.choice--on .choice__dot { border-color: var(--accent); box-shadow: inset 0 0 0 3.5px var(--surface), inset 0 0 0 8px var(--accent); }
.choice__text { flex: 1; min-width: 0; }
.choice__level { flex: none; margin-top: 1px; }

/* 結果：標識置中放大 */
.result { display: grid; justify-items: center; gap: var(--s-2); text-align: center; padding-top: var(--s-2); }
.result .rating-dlg__q { justify-self: start; }
.result__mark { display: block; margin-top: var(--s-2); border-radius: 3px; }
.result__name { font-size: 18px; font-weight: 600; }
.result__contains { font-size: 13.5px; color: var(--text-2); }
.result__note {
  justify-self: stretch; margin-top: var(--s-3); padding: var(--s-3); border-radius: var(--r-sm);
  background: var(--surface-2); font-size: 12.5px; line-height: 1.6; color: var(--text-2); text-align: left;
}

@media (max-width: 480px) {
  .dlg-backdrop { place-items: end center; padding: var(--s-3); padding-bottom: calc(var(--s-3) + env(safe-area-inset-bottom)); }
  .rating-dlg { width: 100%; max-height: calc(100dvh - 2 * var(--s-3)); }
  .rating-dlg__head { padding: var(--s-4) var(--s-4) var(--s-3); }
  .rating-dlg__body { padding: var(--s-2) var(--s-4) var(--s-4); }
  .rating-dlg__actions { padding: var(--s-3) var(--s-4); }
  .rating-dlg__actions .btn { flex: 1; height: var(--h-lg); }
}
</style>
