<script setup lang="ts">
/**
 * 引導的一格：框住要介紹的東西，旁邊一個泡泡（標題、一句說明、上一步／下一步）。
 * 首次引導（CoachTour）與新手七日每天的引導（NewcomerTour）共用同一個長相。
 * 框起來的地方照樣能點，遮罩不擋操作。rect 是 null（框不到）時泡泡貼在頁首底下。
 */
import { computed } from "vue";
import { isNight } from "@/lib/mascot-home";

/**
 * action：框不到時只有一顆按鈕（例如「打開一張卡」「知道了」），取代上一步／下一步。
 * frame=false：rect 只拿來決定泡泡放在它上面或下面，不加遮罩、不框（ui.md §15.8、art.md §12）。
 */
const props = withDefaults(defineProps<{ rect: DOMRect | null; title: string; body: string; mascot: boolean; first: boolean; last: boolean; action?: string; frame?: boolean; clearBelow?: DOMRect | null }>(), { action: undefined, frame: true, clearBelow: null });
/** 導覽的蘇綺衣服跟時段走，和桌寵、簽到頁一致：晚上換寢物語 */
const mascotSrc = isNight(new Date()) ? "/mascot/home/pose-bedtime.webp" : "/mascot/suki-wave.webp";
const emit = defineEmits<{ prev: []; next: []; close: [] }>();

const PAD = 8;
/** 用 transform 移動：只動合成層，不必每格重畫那片 9999px 的遮罩陰影 */
const hole = computed(() => props.frame && props.rect && {
  transform: `translate(${props.rect.left - PAD}px, ${props.rect.top - PAD}px)`,
  width: `${props.rect.width + PAD * 2}px`, height: `${props.rect.height + PAD * 2}px`,
});
/** 框在上半部就把說明放在框的下面，反之放上面；框不到就放在頁首底下，不蓋住頁面底部的按鈕。 */
const bubbleStyle = computed(() => {
  const r = props.rect;
  if (!r) return { top: `calc(64px + env(safe-area-inset-top))` };
  // 不框的時候 rect 是剛按的按鈕：泡泡優先放在它下面，不蓋住按鈕上方那段它在講的內容
  const below = props.frame ? r.top + r.height / 2 < window.innerHeight / 2 : r.bottom + 200 < window.innerHeight;
  // 放在下方時，若目標正下方還有要讓開的東西（clearBelow），從它底下開始；放不下就維持原位
  const under = Math.max(r.bottom + PAD + 12, props.clearBelow ? props.clearBelow.bottom + 12 : 0);
  return below ? { top: `${under <= window.innerHeight - 200 ? under : Math.min(r.bottom + PAD + 12, window.innerHeight - 200)}px` } : { bottom: `${Math.min(window.innerHeight - r.top + PAD + 12, window.innerHeight - 200)}px` };
});
</script>

<template>
  <div class="coach" aria-live="polite">
    <div v-if="hole" class="coach__hole" :style="hole" />
    <section class="coach__bubble panel" :class="{ 'coach__bubble--mascot': mascot }" :style="bubbleStyle" role="dialog" aria-labelledby="coach-title">
      <!-- 蘇綺站在泡泡左邊，泡泡的尖角指向她，像她在說這段話 -->
      <img v-if="mascot" class="coach__mascot" :src="mascotSrc" alt="" decoding="async" />
      <button type="button" class="coach__close" :aria-label="$t('tour.skip')" @click="emit('close')">×</button>
      <h2 id="coach-title" class="coach__title">{{ title }}</h2>
      <p class="coach__body">{{ body }}</p>
      <div class="coach__actions">
        <button v-if="action" type="button" class="btn btn--primary" @click="emit('next')">{{ action }}</button>
        <template v-else>
          <button v-if="!first" type="button" class="btn btn--ghost" @click="emit('prev')">{{ $t("tour.prev") }}</button>
          <button type="button" class="btn btn--primary" @click="emit('next')">{{ $t(last ? "tour.done" : "tour.next") }}</button>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 層級：在舞台（最高 100）之上，在年齡聲明與確認框之下（那兩個開著時引導先收起來） */
.coach { position: fixed; inset: 0; z-index: 101; pointer-events: none; }
.coach__hole {
  position: fixed; top: 0; left: 0; border-radius: var(--r-md);
  box-shadow: 0 0 0 9999px rgba(16, 16, 24, 0.55), 0 0 0 3px var(--accent);
  will-change: transform;
}
.coach__bubble {
  position: fixed; left: 50%; transform: translateX(-50%);
  width: min(380px, calc(100% - 2 * var(--s-4)));
  padding: var(--s-4); display: grid; gap: var(--s-2);
  pointer-events: auto; box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
}
.coach__close {
  position: absolute; top: var(--s-2); right: var(--s-2);
  width: 32px; height: 32px; border: 0; border-radius: var(--r-pill);
  background: transparent; color: var(--text-3); font-size: 20px; line-height: 1; cursor: pointer;
}
.coach__title { margin: 0; padding-right: var(--s-6); font-size: 16px; font-weight: 600; line-height: 1.4; }
.coach__body { margin: 0; font-size: 14px; line-height: 1.6; color: var(--text-2); }
.coach__actions { display: flex; justify-content: flex-end; gap: var(--s-2); margin-top: var(--s-1); }
/*
 * 看板娘說話：她坐在泡泡左邊、泡泡裡面，字往右讓出她的位置。
 * 以前站在泡泡外，會蓋到旁邊頁面的字（卡片頁的分級說明、評論標題），PM 2026-10-19 改成一律在泡泡裡。
 */
.coach__bubble--mascot {
  --mascot-w: 84px;
  width: min(440px, calc(100% - 2 * var(--s-4)));
  padding-left: calc(var(--s-4) + var(--mascot-w) + var(--s-3));
  min-height: calc(var(--mascot-w) * 1.2 + 2 * var(--s-4));
}
.coach__mascot {
  position: absolute; left: var(--s-3); top: var(--s-4);
  width: var(--mascot-w); height: auto; max-height: calc(var(--mascot-w) * 1.4); object-fit: contain; pointer-events: none;
}
.coach__bubble--mascot .coach__actions { margin-left: calc(-1 * (var(--mascot-w) + var(--s-3))); }
@media (max-width: 640px) {
  .coach__bubble--mascot { --mascot-w: 56px; padding-left: calc(var(--s-4) + var(--mascot-w) + var(--s-2)); }
  .coach__bubble--mascot .coach__actions { margin-left: calc(-1 * (var(--mascot-w) + var(--s-2))); }
}
:lang(ko) .coach__title, :lang(ko) .coach__body { word-break: keep-all; }
</style>
