<script setup lang="ts">
/**
 * 對話頁的載入畫面：從進頁第一幀蓋到舞台畫出東西（PlayPage 決定什麼時候收）。
 *
 * 舞台載入時是深色底，這一層也固定深色，收掉時不會先閃一下亮的。封面是卡片頁剛看過的那張，
 * 多半已在瀏覽器快取裡，第一幀就有；沒有就先留一個同尺寸的框，封面到了再淡入，版面不跳。
 *
 * 效能：會動的只有 transform 與 opacity（交給合成器，不重排不重繪）；背景的模糊是靜態的，只畫一次。
 * 系統設了「減少動態效果」就全部停掉。
 */
import { onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{ name?: string; art?: string; backdrop?: string }>();

/** 等太久就換一句話：首次載入舞台與卡片資源要多一點時間，讓人知道不是當掉了 */
const SLOW_AFTER_MS = 6000;
const slow = ref(false);
const timer = setTimeout(() => { slow.value = true; }, SLOW_AFTER_MS);
onBeforeUnmount(() => clearTimeout(timer));

const artLoaded = ref(false);
watch(() => props.art, () => { artLoaded.value = false; });
</script>

<template>
  <div class="play-cover" role="status" aria-live="polite">
    <div v-if="backdrop || art" class="play-cover__bg" :style="{ backgroundImage: `url(&quot;${backdrop || art}&quot;)` }" aria-hidden="true"></div>
    <div class="play-cover__scrim" aria-hidden="true"></div>
    <div class="play-cover__body">
      <div class="play-cover__frame">
        <span class="play-cover__halo" aria-hidden="true"></span>
        <div class="play-cover__art">
          <img v-if="art" :src="art" alt="" decoding="async" :class="{ 'is-loaded': artLoaded }" @load="artLoaded = true" />
          <span class="play-cover__sheen" aria-hidden="true"></span>
        </div>
      </div>
      <p v-if="name" class="play-cover__name">{{ name }}</p>
      <span class="play-cover__bar" aria-hidden="true"><span></span></span>
      <p class="play-cover__hint">{{ slow ? $t("play.loadingSlow") : $t("play.entering") }}</p>
    </div>
  </div>
</template>

<style scoped>
/* 104：蓋過舞台裡最高的 100／101（面板、uni 遮罩），讓出遊客登入框（105）與確認框（110）——
   載入途中跳出的確認不能被這一層壓住（confirm-dialog-stacking.test.ts） */
.play-cover {
  position: fixed; inset: 0; z-index: 104;
  display: grid; place-items: center;
  overflow: hidden; contain: strict;
  background: #101013; color: #fff;
}
.play-cover__bg {
  position: absolute; inset: -48px;
  background: center / cover no-repeat;
  filter: blur(36px) saturate(1.15);
  opacity: 0.5;
}
.play-cover__scrim {
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse at 50% 42%, rgba(16, 16, 19, 0.2), rgba(16, 16, 19, 0.85) 70%),
    linear-gradient(180deg, rgba(16, 16, 19, 0.35), rgba(16, 16, 19, 0.75));
}
.play-cover__body {
  position: relative;
  display: grid; justify-items: center; gap: var(--s-4, 16px);
  padding: var(--s-6, 24px);
  text-align: center;
}
.play-cover__frame { position: relative; width: clamp(112px, 30vw, 152px); aspect-ratio: 3 / 4; }
/* 光暈用漸層而不是 blur 濾鏡：濾鏡在會動的元素上每一幀都要重算 */
.play-cover__halo {
  position: absolute; inset: -22%;
  border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--accent, #ef4f6f) 55%, transparent), transparent);
  animation: play-cover-breathe 2.4s ease-in-out infinite;
}
.play-cover__art {
  position: absolute; inset: 0;
  overflow: hidden; border-radius: 16px;
  background: linear-gradient(160deg, #26262d, #17171b);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}
.play-cover__art img {
  width: 100%; height: 100%; object-fit: cover; display: block;
  opacity: 0; transition: opacity 250ms ease-out;
}
.play-cover__art img.is-loaded { opacity: 1; }
.play-cover__sheen {
  position: absolute; inset: 0;
  background: linear-gradient(105deg, transparent 35%, rgba(255, 255, 255, 0.22) 50%, transparent 65%);
  transform: translateX(-100%);
  animation: play-cover-sheen 2.4s ease-in-out infinite;
}
.play-cover__name {
  margin: var(--s-2, 8px) 0 0; max-width: min(80vw, 420px);
  font-size: 17px; font-weight: 600; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  text-shadow: 0 1px 12px rgba(0, 0, 0, 0.5);
  text-wrap: balance;
}
.play-cover__bar {
  position: relative; width: 160px; height: 3px;
  overflow: hidden; border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
}
.play-cover__bar > span {
  position: absolute; inset: 0; width: 40%;
  border-radius: inherit; background: var(--accent, #ef4f6f);
  transform: translateX(-100%);
  animation: play-cover-bar 1.4s cubic-bezier(0.65, 0, 0.35, 1) infinite;
}
.play-cover__hint { margin: 0; font-size: 13px; color: rgba(255, 255, 255, 0.72); }

@keyframes play-cover-breathe { 0%, 100% { opacity: 0.45; transform: scale(0.94); } 50% { opacity: 0.85; transform: scale(1.04); } }
@keyframes play-cover-sheen { 0% { transform: translateX(-100%); } 60%, 100% { transform: translateX(100%); } }
@keyframes play-cover-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }

@media (prefers-reduced-motion: reduce) {
  .play-cover__halo, .play-cover__sheen, .play-cover__bar > span { animation: none; }
  .play-cover__halo { opacity: 0.6; }
  .play-cover__sheen { display: none; }
  .play-cover__bar > span { width: 100%; transform: none; opacity: 0.6; }
}
</style>
