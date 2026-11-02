<script setup lang="ts">
/**
 * 徽章標籤：小徽章（榜單徽章或線條圖示）＋完整名稱＋次數。作者名字旁、卡片頁、詳情層共用。
 * 兩條榜用同一種中性底，清水與綜合只靠前面的徽章（描邊款／實心款）與名稱分辨。
 * 拿過兩次以上時，標籤後面多疊一到兩層（最多三層的樣子），次數永遠寫成字，不隨次數加層。
 */
import { computed } from "vue";
import type { BadgeIcon } from "../../../shared/community-badges";
import { timesLabel, type Honor } from "@/lib/honors";
import CommunityIcon from "./CommunityIcon.vue";
import RankBadge from "./RankBadge.vue";

const props = withDefaults(defineProps<{ text: string; honor?: Honor | null; icon?: BadgeIcon; count?: number; size?: "md" | "lg"; as?: "span" | "button" }>(), { honor: null, icon: "award", count: 1, size: "md", as: "span" });
const times = computed(() => timesLabel(props.count));
const layers = computed(() => Math.min(Math.max(props.count, 1), 3) - 1);
</script>

<template>
  <component :is="as" :type="as === 'button' ? 'button' : undefined" class="badge-label" :class="[`badge-label--${size}`, honor && 'badge-label--honor']" :data-layers="layers || undefined">
    <RankBadge v-if="honor" :honor="honor" decorative />
    <CommunityIcon v-else :name="icon" />
    <span class="badge-label__text">{{ text }}</span>
    <span v-if="times" class="badge-label__times">{{ times }}</span>
  </component>
</template>

<style scoped>
.badge-label {
  position: relative; display: inline-flex; align-items: center; gap: 5px; flex: none;
  height: 28px; max-width: 100%; padding: 0 10px 0 7px;
  border: 0; border-radius: var(--r-pill); background: var(--surface-2); color: var(--text-2);
  box-shadow: inset 0 0 0 1px var(--line-strong);
  font: inherit; font-size: 12.5px; font-weight: 600; line-height: 1; white-space: nowrap;
  --rank-badge-h: 22px;
}
.badge-label--honor { padding-left: 5px; }
button.badge-label { cursor: pointer; transition: background var(--dur) var(--ease); }
button.badge-label:hover { background: var(--surface); }
.badge-label > svg:not(.rank-badge) { width: 16px; height: 16px; color: var(--accent-text); }
.badge-label__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
.badge-label__times { flex: none; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-2); }
.badge-label--lg { height: 34px; gap: 6px; padding: 0 13px 0 9px; font-size: 14px; --rank-badge-h: 30px; }
.badge-label--lg.badge-label--honor { padding-left: 6px; }
.badge-label--lg > svg:not(.rank-badge) { width: 19px; height: 19px; }
/* 疊層畫在本體後面：外陰影往右上偏，只露出右上一小段邊 */
.badge-label[data-layers="1"] { box-shadow: inset 0 0 0 1px var(--line-strong), 4px -4px 0 0 var(--surface-2), 4px -4px 0 1px var(--line-strong); }
.badge-label[data-layers="2"] { box-shadow: inset 0 0 0 1px var(--line-strong), 4px -4px 0 0 var(--surface-2), 4px -4px 0 1px var(--line-strong), 8px -8px 0 0 var(--surface-2), 8px -8px 0 1px var(--line); }
</style>
