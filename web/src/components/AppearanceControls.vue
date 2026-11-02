<script setup lang="ts">
/**
 * 深淺色與主題的選擇器本體：頁首的外觀彈層與使用者設定的「外觀與語言」共用這一份（settings-ia），
 * 兩邊讀寫同一個 useAppearance，在設定裡改了頁首立刻跟著變。
 * roomy：設定頁用，觸控目標放大到 44 高。badge：接在「外觀」標籤後面的標記（設定頁放「此裝置」）。
 */
import { useId } from "vue";
import { MODES, THEMES, useAppearance } from "@/lib/appearance";
import { track } from "@/lib/track";

defineProps<{ roomy?: boolean }>();
const { mode, theme, resolvedMode, setMode, setTheme } = useAppearance();
const modeLabel = useId();
const themeLabel = useId();
</script>

<template>
  <div class="ap-controls" :class="{ 'ap-controls--roomy': roomy }">
    <p :id="modeLabel" class="ap__label">{{ $t("appearance.title") }}<slot name="badge" /></p>
    <div class="seg ap__modes" role="radiogroup" :aria-labelledby="modeLabel">
      <button v-for="m in MODES" :key="m" type="button" class="seg__item" :class="{ 'seg__item--on': mode === m }" role="radio" :aria-checked="mode === m" @click="setMode(m); track('appearance', { detail: 'mode', subject: m })">
        {{ $t(`appearance.mode.${m}`) }}
      </button>
    </div>

    <p :id="themeLabel" class="ap__label">{{ $t("appearance.theme") }}</p>
    <div class="ap__themes" role="radiogroup" :aria-labelledby="themeLabel">
      <button
        v-for="t in THEMES"
        :key="t.id"
        type="button"
        class="ap__swatch"
        :class="{ 'is-on': theme === t.id }"
        :style="{ '--sw': resolvedMode === 'dark' ? t.swatchDark : t.swatch }"
        :data-theme-id="t.id"
        role="radio"
        :aria-checked="theme === t.id"
        @click="setTheme(t.id); track('appearance', { detail: 'theme', subject: t.id })"
      >
        <span class="ap__dot" aria-hidden="true" />
        <span class="ap__name">{{ $t(`appearance.theme.${t.id}`) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ap__label { display: flex; align-items: center; gap: var(--s-2); margin: 0 0 6px; padding: 0 2px; font-size: 11.5px; font-weight: 600; color: var(--text-3); }
.ap__modes + .ap__label { margin-top: 14px; }
.ap__modes { display: flex; width: 100%; }
.ap__modes .seg__item { flex: 1; padding: 0 6px; }

.ap__themes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.ap__swatch {
  display: grid; justify-items: center; gap: 5px;
  padding: 8px 4px 6px;
  background: transparent; border: 0; border-radius: var(--r-sm);
  font-size: 11px; color: var(--text-2); cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.ap__swatch:hover { background: var(--surface-2); color: var(--text); }
.ap__swatch.is-on { color: var(--text); font-weight: 600; }
.ap__dot {
  width: 22px; height: 22px; border-radius: var(--r-pill);
  background: var(--sw);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.25);
  transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.ap__swatch:hover .ap__dot { transform: scale(1.08); }
/* 選中的那顆：外圈一道跟底色同色的縫，再一圈自己的顏色 */
.ap__swatch.is-on .ap__dot { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--sw); }
.ap__name { max-width: 100%; text-align: center; line-height: 1.2; overflow-wrap: anywhere; }

/* 觸控目標放大：手機的頁首彈層，以及設定頁（任何寬度都是 44 高的點擊區） */
@media (max-width: 480px) {
  .ap__modes .seg__item { height: 40px; }
  .ap__swatch { padding: 10px 4px 8px; font-size: 12px; }
  .ap__dot { width: 28px; height: 28px; }
}
.ap-controls--roomy .ap__label { font-size: 12px; font-weight: 500; }
.ap-controls--roomy .ap__modes .seg__item { height: 40px; }
.ap-controls--roomy .ap__swatch { min-height: 44px; padding: 10px 4px 8px; font-size: 12px; }
.ap-controls--roomy .ap__dot { width: 28px; height: 28px; }
</style>
