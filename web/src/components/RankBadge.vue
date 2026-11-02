<script setup lang="ts">
/**
 * 榜單徽章：期別＝外形＋顏色（日＝橘圓、週＝藍盾、月＝紫六角），榜別＝填色反差（清水＝描邊款、綜合＝實心款），
 * 裡面只有一個期別字與名次數字。底形、色號、字的位置照美工定稿（docs studio 任務 2026-11-02-badges-v2 的
 * icons/rank-badges.mjs，viewBox 32×36）；字由這裡疊上去，所以隨語系換。
 * 這是唯一的固定彩色圖示：長在封面圖上，主題色靠不住，色弱與灰階靠外形分。
 * 尺寸由外層用 CSS 給高度（寬度照 32:36 跟著算），這裡不寫死。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { HONOR_COLORS, honorName, type Honor } from "@/lib/honors";

const props = defineProps<{ honor: Honor; /** 旁邊已經寫了完整名稱時，徽章本身不再念一次 */ decorative?: boolean }>();
const { t } = useI18n();
const color = computed(() => HONOR_COLORS[props.honor.window]);
const clean = computed(() => props.honor.zone === "clean");
const label = computed(() => honorName(t, props.honor));
const band = computed(() => String(props.honor.band));
</script>

<template>
  <svg
    class="rank-badge"
    :data-window="honor.window"
    :data-zone="honor.zone"
    viewBox="0 0 32 36"
    :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : label"
    :aria-hidden="decorative ? 'true' : undefined"
    focusable="false"
  >
    <title v-if="!decorative">{{ label }}</title>
    <g :fill="clean ? '#fff' : color" :stroke="clean ? color : '#fff'" :stroke-width="clean ? 2.8 : 1.6" stroke-linejoin="round">
      <circle v-if="honor.window === 'day'" cx="16" cy="18" r="15" />
      <path v-else-if="honor.window === 'week'" d="M16 2 29 6.5V18c0 9-6.5 14.5-13 16.5C9.5 32.5 3 27 3 18V6.5Z" />
      <path v-else d="M16 2l13.5 7.5v17L16 34 2.5 26.5v-17Z" />
    </g>
    <g :fill="clean ? color : '#fff'" text-anchor="middle" font-weight="800">
      <text x="16" y="17.6" font-size="11">{{ t(`honor.short.${honor.window}`) }}</text>
      <text x="16" y="27.1" :font-size="band.length > 1 ? 8 : 8.8">{{ band }}</text>
    </g>
  </svg>
</template>

<style scoped>
.rank-badge { display: block; flex: none; height: var(--rank-badge-h, 26px); width: calc(var(--rank-badge-h, 26px) * 32 / 36); overflow: visible; }
.rank-badge text { font-family: var(--font); }
</style>
