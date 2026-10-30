<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import { isExternalNotice, isPinnedNotice, noticeDetail, noticeText, noticeUpdateNote, useNotifications } from "@/lib/notifications";
import { useLocalePath } from "@/lib/use-locale";
import type { CommunityNotice } from "@/lib/community";
import NewMark from "@/components/NewMark.vue";
import AccountIcon from "@/components/AccountIcon.vue";

// 頁首的通知入口。未讀數由 App.vue 的輪詢餵進 store；清單在打開浮層時才抓，
// 點一則就標已讀並跳到它指的地方。完整清單仍在 /me/community。
const store = useNotifications();
const { t } = useI18n();
const { lp, locale } = useLocalePath();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);

function toggle() {
  open.value = !open.value;
  if (open.value) void store.load(locale.value);
}
function pick(n: CommunityNotice) { void store.read(n); open.value = false; }
/** An off-site notice (HarperHarbor console) leaves in the same tab after the read mark; a new-tab click just marks it read. */
function pickExternal(n: CommunityNotice, e: MouseEvent) {
  open.value = false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) { void store.read(n); return; }
  e.preventDefault();
  void store.follow(n);
}
function onDocClick(e: MouseEvent) { if (root.value && !root.value.contains(e.target as Node)) open.value = false; }
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) { open.value = false; root.value?.querySelector<HTMLElement>("button")?.focus(); }
}
onMounted(() => { document.addEventListener("click", onDocClick); document.addEventListener("keydown", onKey); });
onBeforeUnmount(() => { document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onKey); });
const when = (n: CommunityNotice) => new Date(n.created_at).toLocaleDateString(locale.value);
</script>

<template>
  <div ref="root" class="bell">
    <button class="bell__btn" :aria-label="store.unread ? t('community.unreadCount', { count: store.unread }) : t('nav.notifications')" aria-haspopup="dialog" :aria-expanded="open" @click="toggle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 9a6 6 0 0 1 12 0v4l2 3H4l2-3Z" /><path d="M10 19a2 2 0 0 0 4 0" />
      </svg>
      <span v-if="store.unread" class="bell__count" aria-hidden="true">{{ store.unread > 99 ? "99+" : store.unread }}</span>
      <NewMark k="header.bell" dot />
    </button>

    <div v-if="open" ref="panel" class="bell__panel panel" role="dialog" :aria-label="t('nav.notifications')">
      <div class="bell__head">
        <strong>{{ t("nav.notifications") }}</strong>
        <button v-if="store.unread" type="button" class="bell__action" @click="store.readAll()">{{ t("notifications.readAll") }}</button>
      </div>
      <p v-if="store.busy && !store.loaded" class="bell__empty subtle">{{ t("state.loading") }}</p>
      <p v-else-if="!store.items.length" class="bell__empty subtle">{{ t("notifications.empty") }}</p>
      <ul v-else class="bell__list">
        <li v-for="n in store.items.slice(0, 20)" :key="n.id">
          <a v-if="isExternalNotice(n)" :href="n.path" rel="noopener" class="bell__item bell__item--platform" :class="{ 'bell__item--unread': !n.read_at, 'bell__item--pinned': isPinnedNotice(n) }" @click="pickExternal(n, $event)">
            <span class="bell__text">{{ noticeText(n) }}<AccountIcon name="external" class="bell__out" /></span>
            <span v-if="noticeDetail(n)?.body" class="bell__note">{{ noticeDetail(n)!.body }}</span>
            <span v-if="noticeDetail(n)?.cta" class="bell__cta">{{ noticeDetail(n)!.cta }}</span>
            <small class="bell__when">{{ when(n) }}</small>
          </a>
          <RouterLink v-else :to="lp(n.path)" class="bell__item" :class="{ 'bell__item--unread': !n.read_at }" @click="pick(n)">
            <span class="bell__text">{{ noticeText(n) }}</span>
            <span v-if="noticeUpdateNote(n)" class="bell__note">{{ noticeUpdateNote(n) }}</span>
            <small class="bell__when">{{ when(n) }}</small>
          </RouterLink>
          <RouterLink v-if="noticeUpdateNote(n)" :to="lp('/me/notifications#notice-'+encodeURIComponent(n.id))" class="bell__log link" @click="open=false">{{ t('cardUpdate.notice.showUpdateLog') }}</RouterLink>
        </li>
      </ul>
      <RouterLink :to="lp('/me/notifications')" class="bell__all" @click="open = false">{{ t("notifications.viewAll") }}</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.bell__note { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; color:var(--text-2); }
.bell__log { display:inline-flex; align-items:center; min-height:var(--h-lg); margin-inline:var(--s-3); font-size:13px; }
.bell { position: relative; display: inline-flex; }
.bell__btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px;
  background: transparent; border: 0; border-radius: var(--r-pill);
  color: var(--text-2); cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.bell__btn:hover, .bell__btn[aria-expanded="true"] { background: var(--surface-2); color: var(--text); }
.bell__btn svg { width: 18px; height: 18px; }
.bell__count {
  position: absolute; top: 2px; right: 0;
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: var(--r-pill); background: var(--danger); color: var(--on-danger);
  font-size: 10px; font-weight: 700; line-height: 1;
}
.bell__panel {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 40;
  width: min(360px, calc(100vw - 32px)); padding: 6px;
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
  animation: fade var(--dur) var(--ease);
}
.bell__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); padding: 8px 10px; font-size: 13.5px; }
.bell__action { background: none; border: 0; padding: 0; color: var(--accent-text); font-size: 12.5px; cursor: pointer; }
.bell__action:hover { text-decoration: underline; }
.bell__empty { margin: 0; padding: 12px 10px 16px; font-size: 13px; }
.bell__list { list-style: none; margin: 0; padding: 0; max-height: 60vh; overflow-y: auto; }
.bell__item { display: grid; gap: 2px; padding: 8px 10px; border-radius: var(--r-sm); color: var(--text); font-size: 13.5px; }
.bell__item:hover { background: var(--surface-2); }
.bell__item--unread { background: var(--accent-tint); }
.bell__item--unread:hover { background: var(--surface-2); }
.bell__text { overflow-wrap: anywhere; }
/* HarperHarbor 帳號通知：標題加粗、行尾離站箭頭；未讀時置頂並在未讀底上疊 3px 警示色條（inset 陰影，不推動內距）。 */
.bell__item--platform .bell__text { font-weight: 600; }
.bell__out { display: inline-block; width: 14px; height: 14px; margin-inline-start: var(--s-1); vertical-align: -2px; color: var(--text-2); }
.bell__cta { color: var(--accent-text); font-size: 13px; }
.bell__item--pinned { box-shadow: inset 3px 0 0 var(--warning-text); }
.bell__when { color: var(--text-2); font-size: 11.5px; }
.bell__all { display: block; margin-top: 4px; padding: 8px 10px; border-top: 1px solid var(--line); font-size: 13px; color: var(--accent-text); }
@keyframes fade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
/* 手機排版（與 App.vue 的頁首斷點相同）：鈴鐺不在最右邊，貼著它對齊會伸出左緣；改成固定在頁首下方、左右各留邊。 */
@media (max-width: 860px) {
  .bell__panel { position: fixed; top: calc(var(--header-h) + env(safe-area-inset-top, 0px) + 4px); left: var(--s-3); right: var(--s-3); width: auto; }
  .bell__list { max-height: calc(100vh - var(--header-h) - 160px); }
}
.bell__log { color:var(--accent-text); }
</style>
