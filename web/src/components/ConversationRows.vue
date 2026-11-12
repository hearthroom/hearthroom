<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLocalePath } from '@/lib/use-locale';
import { displayName } from '@/lib/display-name';
import { platformPath } from '@/lib/connection-ui';
import { hueFrom, relativeTime } from '@/lib/format';
import type { ConversationSummary } from '@/lib/library';
import AccountIcon from './AccountIcon.vue';
import CoverImg from './CoverImg.vue';

const props = defineProps<{ chats: ConversationSummary[]; managing: boolean; selected: string[]; locked: boolean; errors: Record<string, 'busy'|'error'> }>();
const emit = defineEmits<{ 'update:selected': [ids: string[]]; remove: [chat: ConversationSummary] }>();
const { t } = useI18n(), { locale, lp } = useLocalePath();
const root = ref<HTMLElement>(), anchor = ref(-1), focusIndex = ref(0), opened = ref('');
const swipe = ref<{ id: string; x: number } | null>(null);
const drag = ref<{ start: number; end: number; on: boolean; before: string[]; x: number; y: number } | null>(null);
let gesture: { pointer: number; startX: number; startY: number; base: number; horizontal: boolean; id: string } | null = null;
let suppressUntil = 0, frame = 0;
const selectedSet = computed(() => new Set(props.selected));
const title = (c: ConversationSummary) => c.conversationTitle || displayName(c.roleName, locale.value) || t('library.untitled');
const time = (c: ConversationSummary) => { const n = Date.parse(c.lastChatTime || c.createTime || ''); return Number.isFinite(n) ? relativeTime(n) : ''; };
function toggle(index: number, extend = false) {
  if (props.locked) return;
  const next = new Set(props.selected);
  if (extend && anchor.value >= 0) {
    const on = next.has(props.chats[anchor.value]?.conversationId);
    for (let i = Math.min(anchor.value, index); i <= Math.max(anchor.value, index); i++) {
      const id = props.chats[i].conversationId; if (on) next.add(id); else next.delete(id);
    }
  } else {
    const id = props.chats[index].conversationId; if (next.has(id)) next.delete(id); else next.add(id);
    anchor.value = index;
  }
  focusIndex.value = index; emit('update:selected', [...next]);
}
function click(event: MouseEvent, index: number) {
  if (props.locked || Date.now() < suppressUntil) { event.preventDefault(); return; }
  if (props.managing) { event.preventDefault(); toggle(index, event.shiftKey); }
  else if (opened.value) { event.preventDefault(); opened.value = ''; }
}
function context(event: MouseEvent, index: number) {
  // macOS sends Control-click as contextmenu; keep the documented additive selection.
  if (props.managing && event.ctrlKey && !props.locked) { event.preventDefault(); toggle(index, event.shiftKey); }
}
function key(event: KeyboardEvent, index: number) {
  if (!props.managing || props.locked) return;
  if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggle(index, event.shiftKey); }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); const to = Math.max(0, Math.min(props.chats.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    if (event.shiftKey) { if (anchor.value < 0) anchor.value = index; toggle(to, true); }
    focusIndex.value = to; root.value?.querySelector<HTMLElement>(`[data-index="${to}"] .conversation`)?.focus();
  }
}
function paint(end: number) {
  const d = drag.value; if (!d) return;
  d.end = end; const next = new Set(d.before);
  for (let i = Math.min(d.start, end); i <= Math.max(d.start, end); i++) {
    const id = props.chats[i].conversationId; if (d.on) next.add(id); else next.delete(id);
  }
  emit('update:selected', [...next]);
}
function fingerTop(index: number) {
  const rect = root.value?.querySelector(`[data-index="${index}"] .conversation__select`)?.getBoundingClientRect();
  return rect && drag.value ? `${Math.max(8, Math.min(rect.height - 8, drag.value.y - rect.top))}px` : '50%';
}
function visibleBounds() {
  const page = root.value?.closest('.library');
  const toolbar = page?.querySelector('.library__toolbar')?.getBoundingClientRect();
  const bottom = page?.querySelector('.library__bottom')?.getBoundingClientRect();
  return { top: Math.max(0, toolbar?.bottom ?? 0), bottom: bottom?.height ? bottom.top : innerHeight };
}
function hit(x: number, y: number) {
  const bounds = visibleBounds();
  // The fixed action bar covers content; sample its last visible row while scrolling.
  const row = document.elementFromPoint(x, Math.max(bounds.top + 1, Math.min(bounds.bottom - 1, y)))?.closest<HTMLElement>('[data-index]');
  if (row && root.value?.contains(row)) paint(Number(row.dataset.index));
}
function autoScroll() {
  const d = drag.value; if (!d) return;
  const bounds = visibleBounds(), edgeTop = bounds.top + 56, edgeBottom = bounds.bottom - 56;
  const speed = d.y < edgeTop ? -Math.min(16, (edgeTop - d.y) / 3) : d.y > edgeBottom ? Math.min(16, (d.y - edgeBottom) / 3) : 0;
  if (speed) { window.scrollBy(0, speed); hit(d.x, d.y); }
  frame = requestAnimationFrame(autoScroll);
}
function down(e: PointerEvent, index: number) {
  if (props.locked || e.pointerType !== 'touch') return;
  const id = props.chats[index].conversationId;
  if (props.managing) {
    if (!(e.target as HTMLElement).closest('.conversation__select')) return;
    e.preventDefault(); anchor.value = index;
    drag.value = { start: index, end: index, on: !selectedSet.value.has(id), before: [...props.selected], x: e.clientX, y: e.clientY };
    paint(index); frame = requestAnimationFrame(autoScroll);
  } else {
    const base = opened.value === id ? -88 : 0; opened.value = '';
    gesture = { pointer: e.pointerId, startX: e.clientX, startY: e.clientY, base, horizontal: false, id };
  }
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
}
function move(e: PointerEvent) {
  if (drag.value) { e.preventDefault(); drag.value.x = e.clientX; drag.value.y = e.clientY; hit(e.clientX, e.clientY); return; }
  if (!gesture || gesture.pointer !== e.pointerId) return;
  const dx = e.clientX - gesture.startX, dy = e.clientY - gesture.startY;
  if (!gesture.horizontal && Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { gesture = null; return; }
  if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) gesture.horizontal = true;
  if (gesture.horizontal) {
    e.preventDefault(); const x = gesture.base + dx;
    swipe.value = { id: gesture.id, x: Math.max(-108, Math.min(0, x < -88 ? -88 + (x + 88) / 4 : x)) };
  }
}
function up(e?: PointerEvent) {
  if (drag.value) { suppressUntil = Date.now() + 400; drag.value = null; cancelAnimationFrame(frame); }
  if (gesture?.horizontal) {
    suppressUntil = Date.now() + 400;
    const dx = (e?.clientX ?? gesture.startX) - gesture.startX;
    opened.value = gesture.base + dx <= -24 ? gesture.id : '';
  }
  gesture = null; swipe.value = null;
}
function cancel() { up(); opened.value = ''; }
function outside(e: PointerEvent) { if (!root.value?.contains(e.target as Node)) opened.value = ''; }
function scrolled() { if (!drag.value && !gesture?.horizontal) opened.value = ''; }
watch(() => [props.managing, props.chats.map(c => c.conversationId).join('|')], () => { cancel(); anchor.value = -1; focusIndex.value = 0; });
watch(() => props.locked, locked => { if (locked) cancel(); });
onMounted(() => { document.addEventListener('pointerdown', outside); window.addEventListener('scroll', scrolled, true); });
onBeforeUnmount(() => { cancel(); document.removeEventListener('pointerdown', outside); window.removeEventListener('scroll', scrolled, true); });
</script>
<template>
  <div ref="root" class="library__rows" :class="{'library__rows--manage':managing}" :role="managing?'listbox':undefined" :aria-multiselectable="managing?true:undefined" :aria-label="t('library.conversations')">
    <TransitionGroup name="conversation-row">
    <div v-for="(chat,index) in chats" :key="chat.conversationId" class="conversation-wrap" :data-index="index">
      <button v-if="!managing" class="conversation__delete" :inert="opened!==chat.conversationId&&swipe?.id!==chat.conversationId" :tabindex="opened===chat.conversationId?0:-1" :disabled="locked" @click="opened='';emit('remove',chat)"><AccountIcon name="trash" />{{ t('library.manage.rowDelete') }}</button>
      <component :is="managing?'div':'a'" class="conversation panel" :class="{'conversation--closed':chat.canGenerate===false,'conversation--selected':selectedSet.has(chat.conversationId),'conversation--anchor':managing&&anchor===index,'conversation--dragging':drag&&index>=Math.min(drag.start,drag.end)&&index<=Math.max(drag.start,drag.end)}"
        :role="managing?'option':undefined" :aria-selected="managing?selectedSet.has(chat.conversationId):undefined" :aria-label="managing?`${title(chat)}${chat.conversationTitle?', '+displayName(chat.roleName,locale):''}`:undefined"
        :tabindex="managing?(focusIndex===index?0:-1):undefined" :href="managing?undefined:platformPath(lp(`/play/${encodeURIComponent(chat.cardNumber??chat.conversationRoleId)}?resume=${encodeURIComponent(chat.conversationId)}`),chat.provider)"
        :style="!managing?{transform:`translateX(${swipe?.id===chat.conversationId?swipe.x:opened===chat.conversationId?-88:0}px)`}:undefined"
        @click="click($event,index)" @contextmenu="context($event,index)" @keydown="key($event,index)" @pointerdown="down($event,index)" @pointermove="move" @pointerup="up" @pointercancel="cancel">
        <span v-if="managing" class="conversation__select" aria-hidden="true"><span class="conversation__check"><svg v-if="selectedSet.has(chat.conversationId)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 4 4 10-10" /></svg></span><span v-if="drag?.end===index" class="conversation__finger" :style="{top:fingerTop(index)}" /></span>
        <CoverImg v-if="chat.roleAvatar" class="conversation__avatar" :src="chat.roleAvatar" loading="lazy" /><span v-else class="conversation__avatar mono" :style="{'--h':hueFrom(chat.roleName)}"><AccountIcon name="cards" /></span>
        <div class="conversation__body"><div class="conversation__heading"><h2>{{ title(chat) }}</h2><span v-if="chat.reason==='author_private'" class="chip">{{ t('library.historyClosed') }}</span><time v-if="time(chat)" :datetime="chat.lastChatTime||chat.createTime">{{ time(chat) }}</time></div><p v-if="chat.conversationTitle" class="conversation__role muted">{{ displayName(chat.roleName,locale) }}</p><p class="conversation__preview muted">{{ t(chat.canGenerate===false?'library.historyHint':'library.resumeHint') }}</p><p v-if="errors[chat.conversationId]" class="conversation__error">{{ t(errors[chat.conversationId]==='busy'?'library.manage.rowBusy':'library.manage.rowFailed') }}</p></div>
        <span v-if="!managing" class="conversation__continue">{{ t(chat.canGenerate===false?'library.viewHistory':'library.resume') }} <AccountIcon name="arrow" /></span>
      </component>
    </div>
    </TransitionGroup>
  </div>
</template>
<style scoped>
.library__rows { display:grid; gap:var(--s-3); }
.conversation-wrap { position:relative; min-width:0; border-radius:var(--r-lg); overflow:hidden; }
.conversation-row-leave-active { max-height:240px; transition:max-height var(--dur) var(--ease),opacity var(--dur) var(--ease); }
.conversation-row-leave-to { max-height:0; opacity:0; }
.conversation { position:relative; display:flex; align-items:center; gap:var(--s-4); padding:var(--s-4); min-width:0; touch-action:pan-y; transition:transform var(--dur) var(--ease),background var(--dur) var(--ease),border-color var(--dur) var(--ease); }
.conversation:hover { border-color:var(--border-strong); }
.conversation--closed .conversation__avatar { filter:grayscale(1); opacity:.7; }
.conversation__avatar { width:72px; height:80px; border-radius:var(--r-sm); object-fit:cover; flex:none; display:grid; place-items:center; }
.conversation__body { flex:1; min-width:0; }
.conversation__heading { display:flex; align-items:baseline; justify-content:space-between; gap:var(--s-3); }
.conversation h2 { font-size:1rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.conversation time { color:var(--text-3); font-size:13px; white-space:nowrap; }
.conversation__role { font-size:13px; margin-top:var(--s-1); }
.conversation__preview { margin-top:var(--s-2); overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; font-size:14px; overflow-wrap:anywhere; }
.conversation__continue { display:flex; align-items:center; gap:var(--s-2); color:var(--accent-text); font-size:14px; flex:none; }
.conversation__delete { position:absolute; right:0; top:0; bottom:0; width:88px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:var(--s-2); color:var(--danger); background:color-mix(in srgb,var(--danger) 14%,var(--surface)); border:1px solid var(--border); border-radius:var(--r-lg); font:inherit; cursor:pointer; }
.conversation__delete[inert] { visibility:hidden; }
.library__rows--manage { user-select:none; }
.library__rows--manage .conversation { cursor:pointer; gap:var(--s-3); }
.conversation--selected,.conversation--selected:hover { border-color:var(--accent); background:var(--accent-tint); }
.conversation--anchor { outline:2px solid var(--accent); outline-offset:-3px; }
.conversation__select { width:44px; min-height:80px; margin-block:calc(-1 * var(--s-4)); margin-left:calc(-1 * var(--s-4)); flex:none; display:grid; place-items:center; touch-action:none; align-self:stretch; position:relative; }
.conversation__check { display:grid; place-items:center; width:22px; height:22px; border:1.5px solid var(--border-strong); border-radius:var(--r-pill); position:relative; z-index:1; }
.conversation--selected .conversation__check { background:var(--accent-btn); border-color:var(--accent-btn); color:var(--on-accent); }
.conversation__check svg { width:18px; height:18px; }
.conversation--dragging .conversation__select::before { content:''; position:absolute; inset:var(--s-1) var(--s-2); border:1px solid var(--accent); background:var(--accent-soft); border-radius:var(--r-pill); }
.conversation__finger { position:absolute; left:50%; width:8px; height:8px; border-radius:var(--r-pill); background:var(--accent-text); transform:translate(-50%,-50%); z-index:2; }
.conversation__error { margin-top:var(--s-2); font-size:13px; color:var(--danger); overflow-wrap:anywhere; }
@media(max-width:700px) { .conversation__continue { display:none; } .conversation__heading { display:block; } .conversation time { display:block; margin-top:var(--s-1); } .conversation__avatar { width:56px; height:72px; } .library__rows--manage .conversation { gap:var(--s-2); } }
@media(prefers-reduced-motion:reduce) { .conversation,.conversation-row-leave-active { transition:none; } }
</style>
