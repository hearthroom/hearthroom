<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { MODES, THEMES, useAppearance } from "@/lib/appearance";

const { mode, theme, resolvedMode, setMode, setTheme } = useAppearance();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);

function toggle() {
  open.value = !open.value;
  if (open.value) void nextTick(() => panel.value?.querySelector<HTMLElement>("[aria-checked='true']")?.focus());
}
function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) { open.value = false; root.value?.querySelector<HTMLElement>("button")?.focus(); }
}
onMounted(() => { document.addEventListener("click", onDocClick); document.addEventListener("keydown", onKey); });
onBeforeUnmount(() => { document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onKey); });
</script>

<template>
  <div ref="root" class="ap">
    <!-- 圖示畫的是現在生效的那一種：白天是太陽、晚上是月亮 -->
    <button class="ap__btn" :aria-label="$t('appearance.title')" aria-haspopup="true" :aria-expanded="open" @click="toggle">
      <svg v-if="resolvedMode === 'dark'" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      </svg>
      <svg v-else viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>

    <!-- 非模態的設定面板：Tab 走得出去、點外面就收，不裝成對話框 -->
    <div v-if="open" ref="panel" class="ap__panel panel" role="group" :aria-label="$t('appearance.title')">
      <p id="ap-mode-label" class="ap__label">{{ $t("appearance.title") }}</p>
      <div class="seg ap__modes" role="radiogroup" aria-labelledby="ap-mode-label">
        <button v-for="m in MODES" :key="m" class="seg__item" :class="{ 'seg__item--on': mode === m }" role="radio" :aria-checked="mode === m" @click="setMode(m)">
          {{ $t(`appearance.mode.${m}`) }}
        </button>
      </div>

      <p id="ap-theme-label" class="ap__label">{{ $t("appearance.theme") }}</p>
      <div class="ap__themes" role="radiogroup" aria-labelledby="ap-theme-label">
        <button
          v-for="t in THEMES"
          :key="t.id"
          class="ap__swatch"
          :class="{ 'is-on': theme === t.id }"
          :style="{ '--sw': resolvedMode === 'dark' ? t.swatchDark : t.swatch }"
          role="radio"
          :aria-checked="theme === t.id"
          @click="setTheme(t.id)"
        >
          <span class="ap__dot" aria-hidden="true" />
          <span class="ap__name">{{ $t(`appearance.theme.${t.id}`) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ap { position: relative; }
.ap__btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px;
  background: transparent; border: 0; border-radius: var(--r-pill);
  color: var(--text-2); cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.ap__btn:hover, .ap__btn[aria-expanded="true"] { background: var(--surface-2); color: var(--text); }
.ap__btn svg { width: 18px; height: 18px; }

.ap__panel {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 40;
  width: 264px; padding: 12px;
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
  animation: pop var(--dur) var(--ease);
}
.ap__label { margin: 0 0 6px; padding: 0 2px; font-size: 11.5px; font-weight: 600; color: var(--text-3); }
.ap__label + .ap__label, .ap__modes + .ap__label { margin-top: 14px; }
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

@keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }

/* 手機：錨在圖示右緣會被左邊切掉；改成貼著頁首橫跨整寬 */
@media (max-width: 860px) {
  .ap__panel { position: fixed; top: 60px; right: 12px; left: 12px; width: auto; }
}
/* 觸控目標放大 */
@media (max-width: 480px) {
  .ap__panel { padding: 14px; }
  .ap__modes .seg__item { height: 40px; }
  .ap__swatch { padding: 10px 4px 8px; font-size: 12px; }
  .ap__dot { width: 28px; height: 28px; }
}
</style>
