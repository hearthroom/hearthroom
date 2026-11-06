<script setup lang="ts">
/**
 * 對話頁的卡片資訊面板（任務 2026-11-06-play-info-panel；規格 docs studio tasks/2026-11-04-play-info-panel-design/ui.md）。
 * 由舞台頁首的卡片資訊入口打開（lib/play-social.ts），三個分頁：資訊（預設）、評論、榜單。
 *
 * - 疊在畫布上（body 上的一層），不卸載、不縮放畫布與沙盒 iframe，所以開關不會讓遊玩畫面重載。
 * - 窗格 ≥ 760：右側浮動面板，沒有遮罩、不鎖畫布（邊看邊聊），上緣在頁首下緣，頁首那顆入口按了就收。
 *   窗格 < 760：底部面板，34% 遮罩，✕、點遮罩、往下拖把手或標題列、Esc 都能一下關掉。
 * - 第一次打開才掛（資料請求也在那時才發）；之後關掉只藏起來：分頁、捲動位置、評論草稿都留著，
 *   再打開時卡片資料靜默更新一次。
 * - 面板裡沒有會換掉這一頁的連結：換頁會卸載沙盒。標籤與原作是不可點的 chip，只有「在卡片頁開啟」與
 *   「回報卡片問題」兩個連結，都開新分頁。
 * - 不推瀏覽器歷史：Android 返回鍵照舊離開遊玩頁（跟原本的評論單一樣）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import CommentPanel from "@/components/CommentPanel.vue";
import PlayInfoDetails from "@/components/PlayInfoDetails.vue";
import PlayInfoRankings from "@/components/PlayInfoRankings.vue";
import { fetchCard } from "@/lib/api";
import { wrapTab } from "@/lib/focus-trap";
import { contentLang } from "@/lib/i18n";
import { playSocial, type PlayInfoTab } from "@/lib/play-social";
import type { CommunityCard } from "@/lib/types";

const { t, locale } = useI18n();

/** 第一次打開才掛；換卡（或卡被收回）時拆掉，下一張卡重新從第一次打開算 */
const mounted = ref(false);
const cardKey = computed(() => playSocial.card?.cardId ?? "");
/** 面板畫的那份卡：開卡時讀到的那份先畫，重開時背景換成剛讀到的 */
const card = shallowRef<CommunityCard | null>(playSocial.card?.card ?? null);
const commentCount = ref<number | null>(null);
watch(cardKey, () => { mounted.value = false; card.value = playSocial.card?.card ?? null; commentCount.value = null; });
let opens = 0;
async function refreshCard() {
  const key = cardKey.value;
  const id = String(card.value?.num ?? key);
  try {
    const fresh = await fetchCard(id, contentLang(locale.value));
    if (key === cardKey.value && fresh) card.value = fresh;
  } catch { /* 留著手上那份 */ }
}

const commentsEnabled = computed(() => playSocial.detail?.comments !== false);
const tabs = computed<PlayInfoTab[]>(() => commentsEnabled.value ? ["info", "comments", "rankings"] : ["info", "rankings"]);
// 作者關了評論、而上次停在評論：回到資訊
watch(tabs, (list) => { if (!list.includes(playSocial.tab)) playSocial.tab = "info"; });
const tabLabel = (tab: PlayInfoTab) => t(tab === "info" ? "play.info.tab.info" : tab === "comments" ? "card.tab.comments" : "play.info.tab.rankings");

// ── 版面：桌機側欄或手機底部面板（遮罩是固定全頁的一層，用視窗寬就是容器寬） ──
const wide = typeof matchMedia === "function" ? matchMedia("(min-width: 760px)") : null;
const desktop = ref(!!wide?.matches);
const onWide = () => { desktop.value = !!wide?.matches; };
onMounted(() => wide?.addEventListener?.("change", onWide));
onBeforeUnmount(() => wide?.removeEventListener?.("change", onWide));
/** 桌機面板的上緣：舞台頁首的下緣（沙盒卡的頁首在 iframe 裡量不到，用標準頁首的高度） */
const top = ref(56);
function measureTop() {
  const header = document.querySelector<HTMLElement>('.ms-stage [data-lt="header"], [data-lt="header"]');
  const bottom = header?.getBoundingClientRect().bottom ?? 0;
  top.value = bottom > 0 ? Math.round(bottom) : 56;
}

// ── 開與關 ──
const overlay = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const panes = ref<Partial<Record<PlayInfoTab, HTMLElement | null>>>({});
const scrollMemo: Partial<Record<PlayInfoTab, number>> = {};
let restore: HTMLElement | null = null;

function close() { playSocial.open = false; }
function remember(tab: PlayInfoTab) {
  const pane = panes.value[tab];
  if (pane) scrollMemo[tab] = pane.scrollTop;
}
async function recall(tab: PlayInfoTab) {
  await nextTick();
  const pane = panes.value[tab];
  if (pane) pane.scrollTop = scrollMemo[tab] ?? 0;
}

watch(() => playSocial.open, async (open) => {
  if (!open) {
    remember(playSocial.tab);
    drag.value = 0;
    // 焦點還在面板裡才還給入口；桌機上玩家可能已經點回輸入列在打字，不把他拉走
    if (focusInPanel() && restore?.isConnected) restore.focus?.();
    restore = null;
    return;
  }
  if (!playSocial.card) { playSocial.open = false; return; }
  restore = document.activeElement as HTMLElement | null;
  measureTop();
  if (!mounted.value) mounted.value = true;
  else if (opens > 0) void refreshCard();
  opens++;
  await recall(playSocial.tab);
  // 焦點進面板本身（不是分頁鍵）：觸控打開不會亮焦點框，讀屏先念面板名，Tab 下一步就是分頁
  panel.value?.focus({ preventScroll: true });
});
watch(cardKey, () => { opens = 0; });

async function select(tab: PlayInfoTab, focus = false) {
  if (tab === playSocial.tab) return;
  remember(playSocial.tab);
  playSocial.tab = tab;
  await recall(tab);
  if (focus) panel.value?.querySelector<HTMLElement>(`#pip-tab-${tab}`)?.focus();
}
function onTabKey(e: KeyboardEvent) {
  const list = tabs.value;
  const at = list.indexOf(playSocial.tab);
  const next = e.key === "ArrowRight" ? list[(at + 1) % list.length]
    : e.key === "ArrowLeft" ? list[(at - 1 + list.length) % list.length]
    : e.key === "Home" ? list[0] : e.key === "End" ? list[list.length - 1] : null;
  if (!next) return;
  e.preventDefault();
  void select(next, true);
}

/**
 * 面板裡叫出來的對話框（榮譽、完整榜、評論的確認與檢舉）開著時，Esc 與 Tab 先交給它。
 * 舞台的彈層（canvas-popup）關著時內容仍帶 aria-modal，只是外層 hidden／inert，那些不算。
 */
function nestedDialogOpen(): boolean {
  if (document.querySelector(".modal-backdrop, .spend-backdrop, .dlg-backdrop")) return true;
  return [...document.querySelectorAll('[aria-modal="true"]')]
    .some((el) => el !== panel.value && !el.closest('[hidden], [inert], [aria-hidden="true"]'));
}
/** 焦點在面板裡，或點了面板裡的純文字而落回 body（沒有別的地方拿著焦點） */
function focusInPanel(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !!panel.value?.contains(active);
}
function onKey(e: KeyboardEvent) {
  if (!playSocial.open || e.defaultPrevented || e.isComposing || nestedDialogOpen()) return;
  // 桌機不是 modal：焦點在畫布（例如輸入列）時 Esc 是畫布的事
  if (desktop.value && !focusInPanel()) return;
  if (e.key === "Escape") { e.preventDefault(); close(); return; }
  // 手機是 modal：焦點圈在面板裡；桌機不是 modal，Tab 照常走出去
  if (!desktop.value) wrapTab(e, panel.value);
}
onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));

// ── 手機：往下拖把手或標題列關閉（超過 80px 放手即關） ──
const drag = ref(0);
let dragFrom: number | null = null;
function dragStart(e: PointerEvent) {
  if (desktop.value || (e.target as Element | null)?.closest("button")) return;
  dragFrom = e.clientY;
  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
}
function dragMove(e: PointerEvent) {
  if (dragFrom === null) return;
  drag.value = Math.max(0, e.clientY - dragFrom);
}
function dragEnd() {
  if (dragFrom === null) return;
  dragFrom = null;
  if (drag.value > 80) close();
  else drag.value = 0;
}

/*
 * 面板上的滑動不交給底下的聊天頁（沿用原本評論單的做法）。
 * overscroll-behavior 只在「那一層真的捲得動」時才擋得住：內容短、捲不動時手勢會一路傳到底下。
 * 所以改成：手指底下有東西還能往這個方向捲，就讓它捲；沒有（到底、太短、按在標題或遮罩上），這一下整個吃掉。
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
  const touch = e.touches[0];
  lastTouch = touch ? { x: touch.clientX, y: touch.clientY } : null;
}
function onTouchMove(e: TouchEvent) {
  const touch = e.touches[0];
  if (!touch || e.touches.length > 1 || dragFrom !== null) return;
  const prev = lastTouch ?? { x: touch.clientX, y: touch.clientY };
  lastTouch = { x: touch.clientX, y: touch.clientY };
  if (!scrollsToward(e.target, prev.x - touch.clientX, prev.y - touch.clientY) && e.cancelable) e.preventDefault();
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

// ── 手機軟鍵盤（寫評論時）：面板跟著可見範圍，不被鍵盤頂出畫面 ──
const keyboard = ref(0);
const visible = ref(0);
function onViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  keyboard.value = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  visible.value = Math.round(vv.height);
}
watch(() => playSocial.open && !desktop.value, (on) => {
  const vv = window.visualViewport;
  if (!vv) return;
  if (on) { vv.addEventListener("resize", onViewport); vv.addEventListener("scroll", onViewport); onViewport(); }
  else { vv.removeEventListener("resize", onViewport); vv.removeEventListener("scroll", onViewport); keyboard.value = 0; }
});
onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener("resize", onViewport);
  window.visualViewport?.removeEventListener("scroll", onViewport);
});
const overlayStyle = computed(() => desktop.value
  ? { "--pip-top": `${top.value}px` }
  : { "--pip-keyboard": `${keyboard.value}px`, ...(keyboard.value ? { "--pip-visible": `${visible.value}px` } : {}) });
</script>

<template>
  <Teleport to="body">
    <Transition :name="desktop ? 'pip-side' : 'pip-sheet'">
      <div
        v-if="mounted && playSocial.card"
        v-show="playSocial.open"
        ref="overlay"
        class="pip"
        :class="desktop ? 'pip--side' : 'pip--sheet'"
        :style="overlayStyle"
        @click.self="!desktop && close()"
      >
        <section
          ref="panel"
          class="pip__panel panel"
          role="dialog"
          :aria-modal="desktop ? 'false' : 'true'"
          :aria-label="t('card.info')"
          tabindex="-1"
          :style="drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined"
        >
          <div v-if="!desktop" class="pip__handle" aria-hidden="true" @pointerdown="dragStart" @pointermove="dragMove" @pointerup="dragEnd" @pointercancel="dragEnd" />
          <header class="pip__head" @pointerdown="dragStart" @pointermove="dragMove" @pointerup="dragEnd" @pointercancel="dragEnd">
            <div class="seg pip__tabs" role="tablist" :aria-label="t('card.info')" @keydown="onTabKey">
              <button
                v-for="tab in tabs"
                :id="`pip-tab-${tab}`"
                :key="tab"
                type="button"
                role="tab"
                class="seg__item pip__tab"
                :class="{ 'seg__item--on': playSocial.tab === tab }"
                :aria-selected="playSocial.tab === tab ? 'true' : 'false'"
                :aria-controls="`pip-pane-${tab}`"
                :tabindex="playSocial.tab === tab ? 0 : -1"
                @click="select(tab)"
              >
                <span class="pip__tab-text">{{ tabLabel(tab) }}</span><span v-if="tab === 'comments' && commentCount" class="pip__count">{{ commentCount }}</span>
              </button>
            </div>
            <button type="button" class="pip__close" data-close :aria-label="t('dialog.close')" @click="close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </header>
          <div :ref="(el) => { panes.info = el as HTMLElement | null }" id="pip-pane-info" v-show="playSocial.tab === 'info'" class="pip__pane" role="tabpanel" aria-labelledby="pip-tab-info">
            <PlayInfoDetails v-if="card" :key="cardKey" :card="card" :readme="playSocial.detail?.readme ?? ''" />
          </div>
          <div v-if="commentsEnabled" :ref="(el) => { panes.comments = el as HTMLElement | null }" id="pip-pane-comments" v-show="playSocial.tab === 'comments'" class="pip__pane" role="tabpanel" aria-labelledby="pip-tab-comments">
            <CommentPanel :key="cardKey" :card-id="playSocial.card.cardId" :role-id="playSocial.card.roleId" @count="commentCount = $event" />
          </div>
          <div :ref="(el) => { panes.rankings = el as HTMLElement | null }" id="pip-pane-rankings" v-show="playSocial.tab === 'rankings'" class="pip__pane" role="tabpanel" aria-labelledby="pip-tab-rankings">
            <PlayInfoRankings v-if="card" :key="cardKey" :card="card" />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 100：蓋過對話畫布（同原本的評論單）。面板裡叫出來的榮譽對話框 105、確認框 110 在它之上；
   完整知音榜（.spend-backdrop）也是 100，靠 Teleport 晚掛在 body 後面疊在上面。 */
.pip { position: fixed; inset: 0; z-index: 100; }
.pip__panel {
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
}
.pip__panel:focus { outline: none; }
.pip__head { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-2) var(--s-2) var(--s-2) var(--s-4); flex: none; }
.pip__tabs { flex: 1; min-width: 0; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
.pip__tab { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 0; padding: 0 6px; }
.pip__tab-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pip__count { flex: none; font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.pip__close {
  display: grid; place-items: center; flex: none;
  width: var(--h-lg); height: var(--h-lg); border: 0; border-radius: var(--r-pill);
  background: transparent; color: var(--text-2); cursor: pointer;
}
.pip__close svg { width: 20px; height: 20px; }
.pip__close:hover { background: var(--surface-2); color: var(--text); }
.pip__pane { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: var(--s-2) var(--s-4) var(--s-5); }

/* 桌機：右側浮動面板，沒有遮罩，畫布照樣能點能捲 */
.pip--side { pointer-events: none; }
.pip--side .pip__panel {
  position: absolute; pointer-events: auto;
  top: var(--pip-top, 56px); right: var(--s-3); bottom: var(--s-3);
  width: min(400px, calc(100% - 2 * var(--s-3)));
  border-radius: var(--r-lg);
}

/* 手機：底部面板，34% 遮罩；聊天畫面上緣與頁首仍看得到 */
.pip--sheet {
  display: flex; align-items: flex-end; justify-content: center;
  background: rgba(16, 16, 24, 0.34);
  overscroll-behavior: contain;
  padding-bottom: var(--pip-keyboard, 0px);
}
.pip--sheet .pip__panel {
  width: min(640px, 100%);
  height: min(64%, 640px, calc(var(--pip-visible, 100dvh) - var(--s-6)));
  border-radius: 24px 24px 0 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  transition: transform var(--dur) var(--ease);
}
.pip__handle { flex: none; display: grid; place-items: center; height: 20px; touch-action: none; cursor: grab; }
.pip__handle::before { content: ""; width: 36px; height: 4px; border-radius: var(--r-pill); background: var(--line-strong); }
.pip--sheet .pip__head { touch-action: none; padding-top: 0; }

/* 動態：手機上滑 360／下滑 160；桌機右移 24px＋淡入 360／淡出 160。全域 reduced-motion 由 base.css 關掉 */
.pip-sheet-enter-active, .pip-side-enter-active { transition: opacity var(--dur-slow) var(--ease); }
.pip-sheet-leave-active, .pip-side-leave-active { transition: opacity var(--dur) var(--ease); }
.pip-sheet-enter-from, .pip-sheet-leave-to { opacity: 0; }
.pip-sheet-enter-active .pip__panel { transition: transform var(--dur-slow) var(--ease); }
.pip-sheet-leave-active .pip__panel { transition: transform var(--dur) var(--ease); }
.pip-sheet-enter-from .pip__panel, .pip-sheet-leave-to .pip__panel { transform: translateY(100%); }
.pip-side-enter-active .pip__panel { transition: transform var(--dur-slow) var(--ease), opacity var(--dur-slow) var(--ease); }
.pip-side-leave-active .pip__panel { transition: transform var(--dur) var(--ease), opacity var(--dur) var(--ease); }
.pip-side-enter-from .pip__panel, .pip-side-leave-to .pip__panel { transform: translateX(24px); opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .pip-sheet-enter-active, .pip-sheet-leave-active, .pip-side-enter-active, .pip-side-leave-active,
  .pip-sheet-enter-active .pip__panel, .pip-sheet-leave-active .pip__panel,
  .pip-side-enter-active .pip__panel, .pip-side-leave-active .pip__panel { transition: none; }
}
.pip__tab:lang(ko) { word-break: keep-all; }
</style>
