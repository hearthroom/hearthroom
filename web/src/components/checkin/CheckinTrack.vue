<script setup lang="ts">
/**
 * 七日軌道（ui.md §3.4）：今天最搶眼、已簽退成淡底；漏簽不畫叉。
 * 第 3、7 天下面多一個小禮盒，是「好箱子」的提示，不靠字。節點不可點。
 */
import { useI18n } from "vue-i18n";
import type { TrackNode } from "@/lib/checkin";
import { boxKindOf, boxThumb } from "@/lib/checkin-art";

defineProps<{ nodes: TrackNode[] }>();
const { t } = useI18n();

const ARIA: Record<TrackNode["state"], string> = {
  done: "checkin.track.aria.done",
  makeup: "checkin.track.aria.makeup",
  today: "checkin.track.aria.today",
  todayDone: "checkin.track.aria.todayDone",
  future: "checkin.track.aria.future",
  repairable: "checkin.track.aria.repairable",
};
const aria = (n: TrackNode) => {
  const key = ARIA[n.state];
  const better = n.better && n.state !== "makeup" && n.state !== "repairable";
  return t(better ? `${key}.better` : key, { n: n.n });
};
</script>

<template>
  <ol class="track" :aria-label="t('checkin.track.aria.list')">
    <template v-for="(node, i) in nodes" :key="node.n">
      <li v-if="i > 0" class="track__link" :class="{ 'track__link--on': node.state === 'done' || node.state === 'todayDone' || node.state === 'today' || node.state === 'makeup' || node.state === 'repairable' }" aria-hidden="true" />
      <li class="track__node" :class="[`track__node--${node.state}`, { 'track__node--big': node.better }]" :aria-label="aria(node)">
        <span class="track__dot">
          <svg v-if="node.state === 'done' || node.state === 'todayDone' || node.state === 'makeup'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
          <span v-else aria-hidden="true">{{ node.n }}</span>
        </span>
        <span v-if="node.state === 'repairable'" class="track__tag" aria-hidden="true">{{ t("checkin.track.repairable") }}</span>
        <img v-else-if="node.better" class="track__gift" :class="{ 'track__gift--big': node.n === nodes.length }" :src="boxThumb(boxKindOf(node.chest))" alt="" aria-hidden="true" />
      </li>
    </template>
  </ol>
</template>

<style scoped>
.track { list-style:none; margin:0; padding:0; display:flex; align-items:flex-start; }
.track__node { flex:none; display:grid; justify-items:center; gap:4px; width:40px; }
.track__node--big { width:44px; }
/* 大小圓的圓心對齊同一條線：小圓往下 2px，連接線在圓心高度（美術總監最終 r1 L1） */
.track__node:not(.track__node--big) { margin-top:2px; }
.track__link { flex:1 1 0; min-width:2px; height:2px; margin:21px 1px 0; background:var(--line-strong); border-radius:2px; }
.track__link--on { background:var(--accent); }
.track__dot {
  display:flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:var(--r-pill);
  background:var(--surface-2); color:var(--text-2); font-size:14px; font-weight:600; font-variant-numeric:tabular-nums;
  /* 還沒到的格：邊線讓圓在深色卡上也看得見，數字用第二階字色（美術總監最終 r1 M2） */
  box-shadow:inset 0 0 0 1px var(--line-strong);
}
.track__node--big .track__dot { width:44px; height:44px; }
.track__dot svg { width:16px; height:16px; }
.track__node--done .track__dot { background:var(--accent-tint); color:var(--accent-text); }
.track__node--today .track__dot, .track__node--todayDone .track__dot {
  background:var(--accent-btn); color:var(--on-accent); box-shadow:0 0 0 4px var(--accent-soft); transform:scale(1.12);
  animation:track-ping 600ms var(--ease) 1;
}
.track__node--makeup .track__dot, .track__node--repairable .track__dot { background:transparent; color:var(--accent-text); outline:2px dashed var(--accent); outline-offset:-2px; }
.track__tag { font-size:12px; line-height:1; color:var(--accent-text); white-space:nowrap; }
/* 好箱子的提示用實際的箱子縮圖（美工四種箱子；第 7 天比第 3 天大，美術總監 §17） */
.track__gift { width:auto; height:18px; }
.track__gift--big { height:22px; }
@keyframes track-ping { from { box-shadow:0 0 0 0 var(--accent-soft); } to { box-shadow:0 0 0 4px var(--accent-soft); } }
@media (min-width: 761px) {
  .track__node { width:48px; } .track__node--big { width:52px; }
  .track__dot { width:48px; height:48px; font-size:15px; } .track__node--big .track__dot { width:52px; height:52px; }
  .track__link { margin-top:25px; }
}
/* 窄手機：圓縮一階，連接線至少 4px，七個圓不擠在一起（美術總監最終 r2 L5） */
@media (max-width: 400px) {
  .track__node { width:34px; } .track__node--big { width:38px; }
  .track__dot { width:34px; height:34px; font-size:13px; } .track__node--big .track__dot { width:38px; height:38px; }
  .track__link { min-width:4px; margin-top:18px; }
}
@media (max-width: 359px) {
  .track__node { width:30px; } .track__node--big { width:34px; }
  .track__dot { width:30px; height:30px; font-size:12px; } .track__node--big .track__dot { width:34px; height:34px; }
  .track__link { margin-top:16px; }
}
</style>
