<script setup lang="ts">
/**
 * 編輯頁的「試玩」（ui.md §3.6）：桌機是貼在右邊的側面板，手機是底部 sheet。
 * 選要從哪個開場開始，「開始試玩」開新分頁到對話頁，只套用這個擴充的已存草稿。
 *
 * 「開始試玩」是真的 <a target=_blank>，不是按下後再 window.open：中間只要隔一個 await，
 * 瀏覽器就把它當成彈出視窗擋掉。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { wrapTab } from "@/lib/focus-trap";

export interface TrialOption { key: string; label: string }
const props = defineProps<{ options: TrialOption[]; href: (key: string) => string; stale: boolean }>();
const emit = defineEmits<{ close: []; started: [] }>();

const picked = ref(props.options[0]?.key ?? "base");
const box = ref<HTMLElement | null>(null);
let restore: HTMLElement | null = null;
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); emit("close"); return; }
  wrapTab(e, box.value);
}
onMounted(async () => {
  restore = document.activeElement as HTMLElement | null;
  document.addEventListener("keydown", onKey);
  await nextTick();
  box.value?.querySelector<HTMLElement>("input:checked")?.focus();
});
onBeforeUnmount(() => { document.removeEventListener("keydown", onKey); restore?.focus?.(); });
</script>

<template>
  <Teleport to="body">
    <div class="trial-scrim" @click.self="emit('close')">
      <section ref="box" class="panel trial" role="dialog" aria-modal="true" aria-labelledby="ws-trial-title">
        <header class="trial__head">
          <h2 id="ws-trial-title">{{ $t("workshop.test.title") }}</h2>
          <button type="button" class="btn btn--ghost btn--icon btn--sm" :aria-label="$t('dialog.close')" @click="emit('close')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <p class="muted ws-text">{{ $t("workshop.test.desc") }}</p>
        <p v-if="stale" class="notice ws-text" role="status">{{ $t("editor.test.stale") }}</p>
        <div class="trial__picks" role="radiogroup" :aria-labelledby="'ws-trial-title'">
          <label v-for="o in options" :key="o.key" class="trial__pick" :class="{ 'trial__pick--on': picked === o.key }">
            <input v-model="picked" type="radio" name="ws-trial-opening" :value="o.key" :data-trial-option="o.key" />
            <span class="ws-text">{{ o.label }}</span>
          </label>
        </div>
        <footer class="trial__foot">
          <a class="btn btn--primary" :href="props.href(picked)" target="_blank" rel="noopener" data-trial-start @click="emit('started')">
            {{ $t("workshop.test.start") }}
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6.5 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-3" /><path d="M9.5 2.5h4v4M13.5 2.5l-6 6" />
            </svg>
          </a>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
/* 桌機：不蓋住整頁，只在右側浮一塊；底下表單仍看得到 */
.trial-scrim { position: fixed; inset: 0; z-index: 60; background: color-mix(in srgb, #000 18%, transparent); }
.trial {
  position: absolute; top: 76px; right: var(--s-4); bottom: var(--s-4); width: min(400px, calc(100% - 2 * var(--s-4)));
  display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto; align-content: start; gap: var(--s-3);
  padding: var(--s-4); overflow: auto;
}
.trial__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.trial__head h2 { margin: 0; font-size: 17px; }
.trial .muted, .trial .notice { margin: 0; }
.trial__picks { display: grid; gap: var(--s-2); align-content: start; }
.trial__pick {
  display: flex; align-items: center; gap: var(--s-3); min-height: var(--h-lg); padding: var(--s-2) var(--s-3);
  border-radius: var(--r-md); box-shadow: inset 0 0 0 1px var(--line); cursor: pointer; font-size: 14px;
}
.trial__pick span { min-width: 0; overflow-wrap: anywhere; }
.trial__pick input { flex: none; accent-color: var(--accent); width: 16px; height: 16px; margin: 0; }
.trial__pick--on { background: var(--accent-tint); box-shadow: inset 0 0 0 1px var(--accent); }
.trial__foot { display: flex; justify-content: flex-end; }
@media (max-width: 480px) {
  .trial {
    top: auto; left: 0; right: 0; bottom: 0; width: 100%; max-height: 68dvh;
    border-radius: 24px 24px 0 0; padding-bottom: calc(var(--s-4) + env(safe-area-inset-bottom));
  }
  .trial__foot .btn { width: 100%; min-height: var(--h-lg); }
}
</style>
