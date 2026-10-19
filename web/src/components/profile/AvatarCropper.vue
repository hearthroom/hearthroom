<script setup lang="ts">
/**
 * 原地裁切頭像：選完圖就在主頁資料區裡拖、縮放，不再疊一層彈窗（owner 2026-10-19）。
 * 只處理靜態圖；動圖由呼叫端直接沿用原檔（見 lib/avatar-crop.ts）。
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import AccountIcon from '@/components/AccountIcon.vue';
import { clampPan, cropAvatar, type CropFrame } from '@/lib/avatar-crop';

const props = defineProps<{ file: File }>();
const emit = defineEmits<{ apply: [file: File]; cancel: []; repick: [] }>();

const VIEWPORT = 240;
const url = URL.createObjectURL(props.file);
onBeforeUnmount(() => URL.revokeObjectURL(url));
const natural = ref<{ width: number; height: number } | null>(null);
const zoom = ref(1), x = ref(0), y = ref(0), busy = ref(false), failed = ref(false);

const frame = computed<CropFrame | null>(() => natural.value && { ...natural.value, viewport: VIEWPORT, zoom: zoom.value, x: x.value, y: y.value });
/** 同一個取景框畫在不同尺寸上：大框、主頁頭像、留言、頁首 */
function placed(size: number) {
  const f = frame.value;
  if (!f) return {};
  const scale = (VIEWPORT / Math.min(f.width, f.height)) * f.zoom * (size / VIEWPORT);
  const w = f.width * scale, h = f.height * scale, k = size / VIEWPORT;
  return { width: `${w}px`, height: `${h}px`, left: `${size / 2 - w / 2 + f.x * k}px`, top: `${size / 2 - h / 2 + f.y * k}px` };
}
function loaded(e: Event) {
  const img = e.target as HTMLImageElement;
  natural.value = { width: img.naturalWidth, height: img.naturalHeight };
}
function settle() { if (frame.value) ({ x: x.value, y: y.value } = clampPan(frame.value)); }
function setZoom(e: Event) { zoom.value = Number((e.target as HTMLInputElement).value) / 100; settle(); }
let drag: { px: number; py: number; x: number; y: number } | null = null;
function down(e: PointerEvent) { drag = { px: e.clientX, py: e.clientY, x: x.value, y: y.value }; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }
function move(e: PointerEvent) { if (!drag) return; x.value = drag.x + e.clientX - drag.px; y.value = drag.y + e.clientY - drag.py; settle(); }
function up() { drag = null; }
/** 鍵盤也能挪：方向鍵把圖片往那個方向推 8px，加號減號縮放 */
function key(e: KeyboardEvent) {
  const step = 8;
  if (e.key === 'ArrowLeft') x.value -= step; else if (e.key === 'ArrowRight') x.value += step;
  else if (e.key === 'ArrowUp') y.value -= step; else if (e.key === 'ArrowDown') y.value += step;
  else if (e.key === '+' || e.key === '=') zoom.value = Math.min(3, zoom.value + 0.1);
  else if (e.key === '-') zoom.value = Math.max(1, zoom.value - 0.1);
  else return;
  e.preventDefault(); settle();
}
function reset() { zoom.value = 1; x.value = 0; y.value = 0; }
async function apply() {
  if (!frame.value || busy.value) return;
  busy.value = true; failed.value = false;
  try { emit('apply', await cropAvatar(props.file, frame.value)); }
  catch { failed.value = true; }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="cropper" :aria-label="$t('profile.crop.title')" role="group">
    <div class="cropper__stage" tabindex="0" :aria-label="$t('profile.crop.hint')" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @keydown="key">
      <img :src="url" alt="" draggable="false" :style="placed(VIEWPORT)" @load="loaded" />
      <span class="cropper__mask" aria-hidden="true" />
    </div>
    <div class="cropper__side">
      <div class="cropper__head"><strong>{{ $t('profile.crop.title') }}</strong><span>{{ $t('profile.crop.hint') }}</span></div>
      <label class="cropper__zoom">
        <span>{{ $t('profile.crop.zoom') }}<b>{{ Math.round(zoom * 100) }}%</b></span>
        <input type="range" min="100" max="300" step="1" :value="Math.round(zoom * 100)" @input="setZoom" />
      </label>
      <div class="cropper__previews" :aria-label="$t('profile.crop.preview')">
        <span v-for="size in [64, 40, 28]" :key="size" class="cropper__preview" :style="{ width: size + 'px', height: size + 'px' }"><img :src="url" alt="" :style="placed(size)" /></span>
      </div>
      <p v-if="failed" class="notice notice--error" role="alert">{{ $t('profile.crop.failed') }}</p>
      <div class="cropper__actions">
        <button type="button" class="btn btn--primary" :disabled="!frame || busy" @click="apply"><AccountIcon name="check" />{{ $t('profile.crop.apply') }}</button>
        <button type="button" class="btn" @click="reset">{{ $t('profile.crop.reset') }}</button>
        <button type="button" class="btn btn--ghost" @click="emit('repick')">{{ $t('profile.crop.repick') }}</button>
        <button type="button" class="btn btn--ghost" @click="emit('cancel')">{{ $t('linked.cancel') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cropper { display: flex; flex-wrap: wrap; gap: var(--s-5); align-items: flex-start; }
.cropper__stage { position: relative; flex: none; width: 240px; height: 240px; border-radius: var(--r-md); overflow: hidden; background: #0d0d12; cursor: grab; touch-action: none; user-select: none; }
.cropper__stage:active { cursor: grabbing; }
.cropper__stage img { position: absolute; max-width: none; pointer-events: none; }
.cropper__mask { position: absolute; inset: 0; border-radius: var(--r-pill); box-shadow: 0 0 0 999px rgba(10, 10, 16, 0.58); outline: 2px solid rgba(255, 255, 255, 0.9); outline-offset: -2px; pointer-events: none; }
.cropper__side { flex: 1 1 260px; min-width: 0; display: grid; gap: var(--s-4); }
.cropper__head { display: grid; gap: 4px; }
.cropper__head strong { font-size: 16px; }
.cropper__head span { font-size: 13px; line-height: 1.6; color: var(--text-2); }
.cropper__zoom { display: grid; gap: 6px; font-size: 13px; color: var(--text-2); }
.cropper__zoom span { display: flex; justify-content: space-between; }
.cropper__zoom b { font-weight: 500; font-variant-numeric: tabular-nums; }
.cropper__zoom input { width: 100%; accent-color: var(--accent-btn); }
.cropper__previews { display: flex; align-items: flex-end; gap: var(--s-3); }
.cropper__preview { position: relative; flex: none; overflow: hidden; border-radius: var(--r-pill); background: var(--surface-2); box-shadow: 0 0 0 1px var(--line); }
.cropper__preview img { position: absolute; max-width: none; }
.cropper__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
</style>
