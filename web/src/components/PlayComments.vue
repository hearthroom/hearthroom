<script setup lang="ts">
/**
 * 對話頁的評論區：從底部拉起的一張單，裡面是卡片頁同一個評論元件。
 * 由舞台頁首的評論鍵打開（lib/play-social.ts）；聊天畫面留在底下，關掉就回到原本那一句。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import CommentPanel from "@/components/CommentPanel.vue";
import { playSocial } from "@/lib/play-social";

const sheet = ref<HTMLElement | null>(null);
const overlay = ref<HTMLElement | null>(null);
let restore: HTMLElement | null = null;

/*
 * 評論單上的滑動不交給底下的聊天頁。
 * overscroll-behavior 只在「那一層真的捲得動」時才擋得住：評論少、清單捲不動時，手勢會一路傳到
 * 底下，玩家在評論區滑，動的卻是聊天畫面。所以改成：手指底下有東西還能往這個方向捲，就讓它捲；
 * 沒有（清單到底、內容太短、按在標題或暗底上），這一下整個吃掉。
 */
function scrollsToward(from: EventTarget | null, dx: number, dy: number): boolean {
  const root = overlay.value;
  const vertical = Math.abs(dy) >= Math.abs(dx);
  for (let el = from instanceof Element ? from : null; el && el !== root; el = el.parentElement) {
    const style = getComputedStyle(el);
    const overflow = vertical ? style.overflowY : style.overflowX;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    const pos = vertical ? el.scrollTop : el.scrollLeft;
    const max = vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
    const delta = vertical ? dy : dx;
    if (max > 0 && (delta > 0 ? pos < max - 1 : pos > 0)) return true;
  }
  return false;
}
let lastTouch: { x: number; y: number } | null = null;
function onTouchStart(e: TouchEvent) {
  const t = e.touches[0];
  lastTouch = t ? { x: t.clientX, y: t.clientY } : null;
}
function onTouchMove(e: TouchEvent) {
  const t = e.touches[0];
  // 兩指（縮放）不管；只處理一指滑動
  if (!t || e.touches.length > 1) return;
  const prev = lastTouch ?? { x: t.clientX, y: t.clientY };
  lastTouch = { x: t.clientX, y: t.clientY };
  // 手指往上滑＝內容往下捲，所以方向反過來算
  if (!scrollsToward(e.target, prev.x - t.clientX, prev.y - t.clientY) && e.cancelable) e.preventDefault();
}
function onWheel(e: WheelEvent) {
  if (!scrollsToward(e.target, e.deltaX, e.deltaY) && e.cancelable) e.preventDefault();
}
// 瀏覽器預設把觸控與滾輪監聽當成被動的（不能取消），這裡要能取消，所以自己掛。
watch(overlay, (el, old) => {
  old?.removeEventListener("touchstart", onTouchStart);
  old?.removeEventListener("touchmove", onTouchMove);
  old?.removeEventListener("wheel", onWheel);
  el?.addEventListener("touchstart", onTouchStart, { passive: true });
  el?.addEventListener("touchmove", onTouchMove, { passive: false });
  el?.addEventListener("wheel", onWheel, { passive: false });
});

function close() { playSocial.commentsOpen = false; }

watch(() => playSocial.commentsOpen, async (open) => {
  if (!open) { restore?.focus?.(); restore = null; return; }
  restore = document.activeElement as HTMLElement | null;
  await nextTick();
  sheet.value?.querySelector<HTMLElement>("[data-close]")?.focus();
});

function onKey(e: KeyboardEvent) {
  if (!playSocial.commentsOpen || e.key !== "Escape") return;
  // 評論元件自己的確認框開著時，Esc 先交給它
  if (document.querySelector(".dlg-backdrop")) return;
  e.preventDefault();
  close();
}
onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <div v-if="playSocial.commentsOpen && playSocial.card" ref="overlay" class="play-comments" @click.self="close">
      <section ref="sheet" class="play-comments__sheet panel" role="dialog" aria-modal="true" aria-labelledby="play-comments-title">
        <header class="play-comments__head">
          <h2 id="play-comments-title" class="play-comments__title">{{ $t("card.tab.comments") }}</h2>
          <button type="button" class="play-comments__close" data-close :aria-label="$t('dialog.close')" @click="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div class="play-comments__body">
          <CommentPanel :key="playSocial.card.cardId" :card-id="playSocial.card.cardId" :role-id="playSocial.card.roleId" />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
/* 100：蓋過對話畫布，但讓評論元件叫出來的確認框（110）在它上面。 */
.play-comments {
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: flex-end; justify-content: center;
  background: rgba(16, 16, 24, 0.45);
  overscroll-behavior: contain;
  animation: fade var(--dur) var(--ease);
}
.play-comments__sheet {
  width: min(640px, 100%);
  max-height: min(80dvh, 720px);
  display: flex; flex-direction: column;
  border-radius: 24px 24px 0 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
  animation: sheet-up var(--dur-slow) var(--ease);
}
.play-comments__head {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--s-3) var(--s-3) var(--s-2) var(--s-5);
}
.play-comments__title { font-size: 16px; font-weight: 600; }
.play-comments__close {
  display: grid; place-items: center;
  width: 44px; height: 44px; border: 0; border-radius: 9999px;
  background: transparent; color: var(--text-2); cursor: pointer;
}
.play-comments__close svg { width: 20px; height: 20px; }
.play-comments__close:hover { background: var(--surface-2); }
.play-comments__body { overflow-y: auto; overscroll-behavior: contain; padding: 0 var(--s-5) var(--s-5); }
@keyframes sheet-up { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .play-comments, .play-comments__sheet { animation: none; } }
</style>
