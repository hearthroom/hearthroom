<script setup lang="ts">
/**
 * 個人資料表單裡的打賞連結。
 *
 * 作者多半沒接過打賞平台，一排圖示加一個空白網址框他不知道要填什麼（owner 2026-10-11）。所以分三步：
 *   1. 選平台：每個平台一列，一句話說明收款方式與能不能放成人內容
 *   2. 填這個平台：沒有帳號就給開通連結；有帳號就貼個人頁網址，只打帳號名也行；禁止成人內容的平台先提醒
 *   3. 加好的平台列成清單，每條可以打開確認是不是自己的頁面
 * 伺服器會再驗一次（shared/tip-links.ts）；這裡負責即時告訴作者這格認不認得。
 */
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import TipPlatformIcon from "./TipPlatformIcon.vue";
import { TIP_LINKS_MAX, TIP_PLATFORMS, resolveTipInput, tipPlatform, type TipParse, type TipPlatformId } from "../../../shared/tip-links";

export interface TipRow { platform: TipPlatformId; value: string }

const props = defineProps<{ modelValue: TipRow[]; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [TipRow[]] }>();
const { t, locale } = useI18n();

/** 還沒加任何平台時直接攤開平台清單：第一眼就看得到能選什麼 */
const picking = ref(false);
const showPicker = computed(() => props.modelValue.length < TIP_LINKS_MAX && (picking.value || props.modelValue.length === 0));
const taken = computed(() => new Set(props.modelValue.map((r) => r.platform)));

const rows = computed(() => props.modelValue.map((row) => ({ ...row, parsed: row.value.trim() ? resolveTipInput(row.platform, row.value) : null })));

const supported = computed(() => TIP_PLATFORMS.map((p) => p.name).join(/^(zh|ja)/.test(locale.value) ? "、" : ", "));
function message(parsed: TipParse) {
  if (parsed.ok) return t("tips.field.ok", { platform: tipPlatform(parsed.link.platform).name, handle: parsed.link.handle });
  if (parsed.reason === "shortener") return t("tips.field.shortener");
  if (parsed.reason === "not_profile") return t("tips.field.notProfile", { platform: tipPlatform(parsed.platform!).name });
  if (parsed.reason === "unsupported") return t("tips.field.unsupported", { platforms: supported.value });
  return t("tips.field.invalid");
}

function pick(platform: TipPlatformId) {
  picking.value = false;
  const index = props.modelValue.length;
  emit("update:modelValue", [...props.modelValue, { platform, value: "" }]);
  void nextTick(() => document.getElementById(`tip-link-${index}`)?.focus());
}
function set(i: number, value: string) {
  const next = props.modelValue.map((r) => ({ ...r }));
  next[i].value = value;
  // 貼的是另一個平台的網址：照網址認，這一列跟著換成那個平台
  const parsed = resolveTipInput(next[i].platform, value);
  if (parsed.ok) next[i].platform = parsed.link.platform;
  emit("update:modelValue", next);
}
function remove(i: number) {
  emit("update:modelValue", props.modelValue.filter((_, j) => j !== i));
}
</script>

<template>
  <fieldset class="tips-field" :disabled="disabled">
    <legend>{{ $t("tips.field.title") }}</legend>
    <p class="tips-field__hint">{{ $t("tips.field.hint", { n: TIP_LINKS_MAX }) }}</p>

    <!-- 已加入的平台：一列一個，填網址或帳號名 -->
    <div v-for="(row, i) in rows" :key="i" class="tips-row">
      <div class="tips-row__head">
        <TipPlatformIcon :platform="row.platform" class="tips-row__icon" />
        <strong>{{ tipPlatform(row.platform).name }}</strong>
        <a v-if="row.parsed?.ok" :href="row.parsed.link.url" target="_blank" rel="noopener noreferrer nofollow" class="tips-row__open">{{ $t("tips.field.open") }}</a>
        <button type="button" class="tips-row__remove" @click="remove(i)">{{ $t("tips.field.remove") }}</button>
      </div>
      <p v-if="tipPlatform(row.platform).caution" class="tips-row__caution">{{ $t("tips.field.caution", { platform: tipPlatform(row.platform).name }) }}</p>
      <label :for="`tip-link-${i}`" class="tips-row__label">{{ $t("tips.field.inputLabel", { platform: tipPlatform(row.platform).name }) }}</label>
      <input
        :id="`tip-link-${i}`" :value="row.value" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
        :placeholder="tipPlatform(row.platform).example"
        :aria-invalid="row.parsed && !row.parsed.ok ? 'true' : undefined" :aria-describedby="`tip-link-${i}-msg`"
        @input="set(i, ($event.target as HTMLInputElement).value)"
      />
      <p :id="`tip-link-${i}-msg`" class="tips-row__msg" :class="row.parsed ? (row.parsed.ok ? 'tips-row__msg--ok' : 'tips-row__msg--bad') : ''">
        <template v-if="row.parsed">{{ message(row.parsed) }}</template>
        <template v-else>{{ $t("tips.field.howTo", { platform: tipPlatform(row.platform).name }) }}</template>
      </p>
      <a v-if="!row.parsed?.ok" :href="tipPlatform(row.platform).signup" target="_blank" rel="noopener noreferrer" class="tips-row__signup">{{ $t("tips.field.signup", { platform: tipPlatform(row.platform).name }) }}</a>
    </div>

    <!-- 選平台：每一列一句話，看說明就知道該選哪個 -->
    <div v-if="showPicker" class="tips-pick">
      <p class="tips-pick__title">{{ $t("tips.field.choose") }}</p>
      <ul>
        <li v-for="p in TIP_PLATFORMS" :key="p.id">
          <button type="button" class="tips-pick__item" :disabled="taken.has(p.id)" @click="pick(p.id)">
            <TipPlatformIcon :platform="p.id" class="tips-pick__icon" />
            <span class="tips-pick__text"><strong>{{ p.name }}</strong><span>{{ $t(`tips.platform.${p.id}`) }}</span></span>
            <span v-if="taken.has(p.id)" class="tips-pick__taken">{{ $t("tips.field.added") }}</span>
          </button>
        </li>
      </ul>
      <button v-if="modelValue.length" type="button" class="tips-field__ghost" @click="picking = false">{{ $t("tips.field.cancel") }}</button>
    </div>
    <button v-else-if="modelValue.length < TIP_LINKS_MAX" type="button" class="tips-field__add" @click="picking = true">{{ $t("tips.field.add") }}</button>
  </fieldset>
</template>

<style scoped>
.tips-field { display: grid; gap: var(--s-3); margin: 0; padding: 0; border: 0; min-width: 0; }
legend { padding: 0; margin-bottom: var(--s-1); font-size: 13px; font-weight: 500; color: var(--text-2); }
.tips-field__hint { margin: 0; font-size: 12px; line-height: 1.7; color: var(--text-3); }

.tips-row { display: grid; gap: var(--s-2); padding: var(--s-3); border: 1px solid var(--line-strong); border-radius: var(--r-md); background: var(--surface); min-width: 0; }
.tips-row__head { display: flex; align-items: center; gap: var(--s-2); min-width: 0; }
.tips-row__head strong { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tips-row__icon { width: 28px; height: 28px; }
.tips-row__open, .tips-row__remove { flex: none; padding: 4px 6px; border: 0; background: none; font: inherit; font-size: 13px; color: var(--text-2); cursor: pointer; }
.tips-row__open:hover { color: var(--accent-text); }
.tips-row__remove:hover { color: var(--danger); }
.tips-row__caution { margin: 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--gold-soft); font-size: 12px; line-height: 1.6; color: var(--warning-text); }
.tips-row__label { font-size: 12px; font-weight: 500; color: var(--text-2); }
input { width: 100%; min-width: 0; padding: var(--s-3); border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--surface-2); color: var(--text); font: inherit; font-size: 14px; }
input[aria-invalid="true"] { border-color: var(--danger); }
.tips-row__msg { margin: 0; font-size: 12px; line-height: 1.6; color: var(--text-3); overflow-wrap: anywhere; }
.tips-row__msg--ok { color: var(--success); }
.tips-row__msg--bad { color: var(--danger); }
.tips-row__signup { justify-self: start; font-size: 12.5px; color: var(--accent-text); }
.tips-row__signup::after { content: " ↗"; }

.tips-pick { display: grid; gap: var(--s-2); }
.tips-pick__title { margin: 0; font-size: 12px; font-weight: 600; color: var(--text-2); }
.tips-pick ul { display: grid; margin: 0; padding: 0; list-style: none; border: 1px solid var(--line-strong); border-radius: var(--r-md); overflow: hidden; background: var(--surface); }
.tips-pick li + li { box-shadow: 0 -1px 0 var(--line); }
.tips-pick__item { display: flex; align-items: center; gap: var(--s-3); width: 100%; padding: var(--s-3); border: 0; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.tips-pick__item:hover:not(:disabled) { background: var(--surface-2); }
.tips-pick__item:disabled { cursor: default; opacity: 0.55; }
.tips-pick__icon { width: 32px; height: 32px; }
.tips-pick__text { flex: 1; min-width: 0; display: grid; gap: 2px; }
.tips-pick__text strong { font-size: 14px; font-weight: 600; }
.tips-pick__text span { font-size: 12px; line-height: 1.5; color: var(--text-3); }
.tips-pick__taken { flex: none; font-size: 12px; color: var(--text-3); }
.tips-field__add, .tips-field__ghost { justify-self: start; min-height: 36px; padding: 0 var(--s-4); border-radius: var(--r-pill); background: transparent; color: var(--text-2); font: inherit; font-size: 13px; cursor: pointer; }
.tips-field__add { border: 1px dashed var(--line-strong); }
.tips-field__add:hover { color: var(--text); border-color: var(--text-3); }
.tips-field__ghost { border: 0; }
.tips-field__ghost:hover { color: var(--text); }
</style>
