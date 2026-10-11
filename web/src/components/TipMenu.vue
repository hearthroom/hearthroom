<script setup lang="ts">
/**
 * 打賞作者：一顆按鈕，按下去列出作者綁的打賞頁，每一條在新分頁打開那個平台。
 * 錢在那個平台付，本站不經手（shared/tip-links.ts）。
 *
 * 卡片頁有兩個入口共用這一個元件（owner 2026-10-11 拍板 A＋C）：
 *   pill   署名旁的小膠囊，第一屏就看得到
 *   block  作者區塊上的整寬按鈕
 *
 * 面板錨在按鈕上、非模態，跟分享面板同一套（ShareMenu）：手機上也不改成貼底的 fixed——
 * 卡片頁外層有動畫用的 transform，fixed 會以它為準而停在半空中。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import TipPlatformIcon from "./TipPlatformIcon.vue";
import { tipPlatform, type TipLink } from "../../../shared/tip-links";
import { track } from "@/lib/track";

defineProps<{ tips: TipLink[]; variant: "pill" | "block" }>();

const open = ref(false);
const up = ref(false);
const maxH = ref(0);
/** 面板靠按鈕左緣對齊；按鈕離右邊太近時往左挪回畫面裡 */
const shift = ref(0);
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);

function place() {
  const box = root.value?.getBoundingClientRect();
  if (!box) return;
  const el = panel.value;
  const wanted = el ? el.scrollHeight : 220;
  const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 0;
  const below = innerHeight - box.bottom - 12;
  const above = box.top - headerH - 12;
  up.value = below < wanted && above > below;
  maxH.value = Math.max(0, up.value ? above : below);
  const panelW = el ? el.offsetWidth : 280;
  shift.value = Math.max(0, box.left + panelW - (document.documentElement.clientWidth - 12));
}

function toggle() {
  open.value = !open.value;
  if (!open.value) return;
  track("tip_open");
  place();
  void nextTick(() => {
    place();
    panel.value?.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
  });
}
function close(focusBack = false) {
  open.value = false;
  if (focusBack) root.value?.querySelector<HTMLElement>("button")?.focus();
}
function picked(tip: TipLink) {
  track("tip_click", { subject: tip.platform });
  close();
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) close();
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) close(true);
}
onMounted(() => { document.addEventListener("click", onDocClick); document.addEventListener("keydown", onKey); });
onBeforeUnmount(() => { document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onKey); });
</script>

<template>
  <div ref="root" class="tip" :class="`tip--${variant}`">
    <button type="button" class="tip__btn" :class="variant === 'block' ? 'btn tip__btn--block' : 'tip__btn--pill'" :aria-expanded="open" @click="toggle">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16.5s-6-3.7-6-8.4A3.4 3.4 0 0 1 10 6a3.4 3.4 0 0 1 6 2.1c0 4.7-6 8.4-6 8.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
      {{ variant === "block" ? $t("tips.tipAuthor") : $t("tips.tip") }}
    </button>

    <div v-if="open" ref="panel" class="tip__panel panel" :class="{ 'tip__panel--up': up }" :style="{ '--tip-max': maxH + 'px', '--tip-shift': shift + 'px' }" role="group" :aria-label="$t('tips.title')">
      <p class="tip__title">{{ $t("tips.title") }}</p>
      <a v-for="tip in tips" :key="tip.url" class="tip__item" :href="tip.url" target="_blank" rel="noopener noreferrer nofollow" @click="picked(tip)">
        <TipPlatformIcon :platform="tip.platform" class="tip__icon" />
        <span class="tip__text"><strong>{{ tipPlatform(tip.platform).name }}</strong><span>{{ tip.handle }}</span></span>
        <svg class="tip__out" viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4h8v8M16 4l-8.5 8.5M14 12v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </a>
      <p class="tip__note">{{ $t("tips.note") }}</p>
    </div>
  </div>
</template>

<style scoped>
.tip { position: relative; min-width: 0; }
.tip--block { width: 100%; }
.tip__btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; font: inherit; cursor: pointer; }
.tip__btn svg { width: 15px; height: 15px; flex: none; }
.tip__btn--pill {
  height: 26px; padding: 0 10px; border-radius: var(--r-pill);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  background: var(--accent-tint); color: var(--accent-text);
  font-size: 12.5px; font-weight: 650;
  transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.tip__btn--pill:hover { border-color: var(--accent); }
.tip__btn--block {
  width: 100%; color: var(--accent-text); background: var(--accent-tint);
  border-color: color-mix(in srgb, var(--accent) 30%, transparent); font-weight: 650;
}
.tip__btn--block:hover { border-color: var(--accent); }

.tip__panel {
  position: absolute; top: calc(100% + 8px); left: calc(0px - var(--tip-shift, 0px)); z-index: 40;
  width: 280px; padding: 8px; display: grid; gap: 2px;
  max-height: var(--tip-max, none); overflow-y: auto; overscroll-behavior: contain;
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
  transform-origin: top left; animation: pop var(--dur) var(--ease);
}
.tip--block .tip__panel { width: 100%; min-width: 260px; }
.tip__panel--up { top: auto; bottom: calc(100% + 8px); transform-origin: bottom left; animation-name: pop-up; }
.tip__title { margin: 4px 8px 6px; font-size: 13px; font-weight: 650; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tip__item {
  display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: var(--r-sm);
  color: var(--text); text-decoration: none; transition: background var(--dur) var(--ease);
}
.tip__item:hover, .tip__item:focus-visible { background: var(--surface-2); }
.tip__icon { width: 32px; height: 32px; }
.tip__text { flex: 1; min-width: 0; display: grid; }
.tip__text strong { font-size: 14px; font-weight: 600; }
.tip__text span { font-size: 12.5px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 會開新分頁要先說：按下去才發現跳走是最惹人的一種驚嚇 */
.tip__out { width: 14px; height: 14px; flex: none; color: var(--text-3); }
.tip__note { margin: 6px 8px 4px; padding-top: 8px; box-shadow: 0 -1px 0 var(--line); font-size: 12px; line-height: 1.6; color: var(--text-3); }

@keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes pop-up { from { opacity: 0; transform: translateY(4px) scale(0.98); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .tip__panel { animation: none; } }
@media (max-width: 480px) {
  .tip__panel { width: min(300px, calc(100vw - 32px)); }
  .tip__item { padding: 10px 8px; }
}
</style>
