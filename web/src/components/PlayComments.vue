<script setup lang="ts">
/**
 * 對話頁的評論區：從底部拉起的一張單，裡面是卡片頁同一個評論元件。
 * 由舞台頁首的評論鍵打開（lib/play-social.ts）；聊天畫面留在底下，關掉就回到原本那一句。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import CommentPanel from "@/components/CommentPanel.vue";
import { playSocial } from "@/lib/play-social";

const sheet = ref<HTMLElement | null>(null);
let restore: HTMLElement | null = null;

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
    <div v-if="playSocial.commentsOpen && playSocial.card" class="play-comments" @click.self="close">
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
