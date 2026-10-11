<script setup lang="ts">
/**
 * 個人資料表單裡的打賞連結：作者貼網址，平台由網址自動認出來，不用先選下拉選單。
 * 伺服器會再驗一次（shared/tip-links.ts）；這裡只負責即時告訴作者這條認不認得。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import TipPlatformIcon from "./TipPlatformIcon.vue";
import { TIP_LINKS_MAX, TIP_PLATFORMS, parseTipLink, tipPlatform } from "../../../shared/tip-links";

const props = defineProps<{ modelValue: string[]; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [string[]] }>();
const { t, locale } = useI18n();

/** 中日文用頓號，其他語言用逗號 */
const supported = computed(() => TIP_PLATFORMS.map((p) => p.name).join(/^(zh|ja)/.test(locale.value) ? "、" : ", "));
const rows = computed(() => props.modelValue.map((value) => {
  if (!value.trim()) return { value, parsed: null };
  return { value, parsed: parseTipLink(value) };
}));

function message(parsed: ReturnType<typeof parseTipLink>) {
  if (parsed.ok) {
    const platform = tipPlatform(parsed.link.platform);
    return platform.caution ? t("tips.field.caution", { platform: platform.name }) : t("tips.field.ok", { platform: platform.name, handle: parsed.link.handle });
  }
  if (parsed.reason === "shortener") return t("tips.field.shortener");
  if (parsed.reason === "not_profile") return t("tips.field.notProfile", { platform: tipPlatform(parsed.platform!).name });
  if (parsed.reason === "unsupported") return t("tips.field.unsupported", { platforms: supported.value });
  return t("tips.field.invalid");
}
const tone = (parsed: ReturnType<typeof parseTipLink>) => (!parsed.ok ? "bad" : tipPlatform(parsed.link.platform).caution ? "caution" : "ok");

function set(i: number, value: string) {
  const next = [...props.modelValue];
  next[i] = value;
  emit("update:modelValue", next);
}
function remove(i: number) {
  emit("update:modelValue", props.modelValue.filter((_, j) => j !== i));
}
function add() {
  if (props.modelValue.length < TIP_LINKS_MAX) emit("update:modelValue", [...props.modelValue, ""]);
}
</script>

<template>
  <fieldset class="tips-field" :disabled="disabled">
    <legend>{{ $t("tips.field.title") }}</legend>
    <p class="tips-field__hint">{{ $t("tips.field.hint", { n: TIP_LINKS_MAX }) }}</p>
    <ul class="tips-field__brands" :aria-label="$t('tips.field.supported')">
      <li v-for="p in TIP_PLATFORMS" :key="p.id" :title="p.name"><TipPlatformIcon :platform="p.id" /><span class="sr-only">{{ p.name }}</span></li>
    </ul>
    <div v-for="(row, i) in rows" :key="i" class="tips-field__row">
      <TipPlatformIcon v-if="row.parsed?.ok" :platform="row.parsed.link.platform" class="tips-field__icon" />
      <span v-else class="tips-field__icon tips-field__icon--empty" aria-hidden="true" />
      <input
        :id="`tip-link-${i}`" :value="row.value" type="text" inputmode="url" autocomplete="off" spellcheck="false"
        :placeholder="$t('tips.field.placeholder')" :aria-label="$t('tips.field.label', { n: i + 1 })"
        :aria-invalid="row.parsed && !row.parsed.ok ? 'true' : undefined" :aria-describedby="row.parsed ? `tip-link-${i}-msg` : undefined"
        @input="set(i, ($event.target as HTMLInputElement).value)"
      />
      <button type="button" class="tips-field__remove" :aria-label="$t('tips.field.remove')" :title="$t('tips.field.remove')" @click="remove(i)">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
      </button>
      <p v-if="row.parsed" :id="`tip-link-${i}-msg`" class="tips-field__msg" :class="`tips-field__msg--${tone(row.parsed)}`">{{ message(row.parsed) }}</p>
    </div>
    <button v-if="modelValue.length < TIP_LINKS_MAX" type="button" class="tips-field__add" @click="add">{{ $t("tips.field.add") }}</button>
  </fieldset>
</template>

<style scoped>
.tips-field { display: grid; gap: var(--s-2); margin: 0; padding: 0; border: 0; min-width: 0; }
legend { padding: 0; margin-bottom: var(--s-1); font-size: 13px; font-weight: 500; color: var(--text-2); }
.tips-field__hint { margin: 0; font-size: 12px; line-height: 1.7; color: var(--text-3); }
.tips-field__brands { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 var(--s-1); padding: 0; list-style: none; }
.tips-field__brands :deep(.tip-icon) { width: 22px; height: 22px; }
.tips-field__row { display: grid; grid-template-columns: 28px minmax(0, 1fr) 36px; gap: var(--s-2); align-items: center; }
.tips-field__icon { width: 28px; height: 28px; }
.tips-field__icon--empty { border-radius: var(--r-pill); border: 1px dashed var(--line-strong); }
input { width: 100%; min-width: 0; padding: var(--s-3); border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--surface-2); color: var(--text); font: inherit; font-size: 14px; }
input[aria-invalid="true"] { border-color: var(--danger); }
.tips-field__remove { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: var(--r-sm); background: transparent; color: var(--text-3); cursor: pointer; }
.tips-field__remove:hover { background: var(--surface-2); color: var(--text); }
.tips-field__remove svg { width: 16px; height: 16px; }
.tips-field__msg { grid-column: 2 / 4; margin: -2px 0 var(--s-1); font-size: 12px; line-height: 1.6; }
.tips-field__msg--ok { color: var(--success); }
.tips-field__msg--caution { color: var(--warning-text); }
.tips-field__msg--bad { color: var(--danger); }
.tips-field__add { justify-self: start; min-height: 36px; padding: 0 var(--s-4); border: 1px dashed var(--line-strong); border-radius: var(--r-pill); background: transparent; color: var(--text-2); font: inherit; font-size: 13px; cursor: pointer; }
.tips-field__add:hover { color: var(--text); border-color: var(--text-3); }
</style>
