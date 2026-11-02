<script setup lang="ts">
/**
 * 主頁資料頭：封面、頭像、名字、徽章、簡介，右邊放積分卡（slot）。
 *
 * 編輯不開彈窗：按「編輯資料」就在原位把名字、簡介換成輸入框，封面上出現場景選擇，
 * 選了頭像就在資料區原地裁切。取消／保存就放在原本「編輯資料」那一排，保存要有修改才能按；
 * 頂部那組捲出視窗而且有修改時，視窗底部才浮出同一組（玩家回報 2026-11-01：大螢幕上只有底部那組，離表單太遠看不到）。
 * 封面往下淡出成封面同色系的淺色（白天）或深色（深色模式），不往白底淡——那樣中段會是髒灰色。
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import AccountIcon from '@/components/AccountIcon.vue';
import CommunityAvatar from '@/components/CommunityAvatar.vue';
import CommunityName from '@/components/CommunityName.vue';
import CommunityIcon from '@/components/CommunityIcon.vue';
import TipLinksField, { type TipRow } from '@/components/TipLinksField.vue';
import WornBadges from '@/components/WornBadges.vue';
import AvatarCropper from './AvatarCropper.vue';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { headerOverlaysKey } from '@/lib/site-links';
import { confirmDialog } from '@/lib/confirm';
import { updateSiteProfile } from '@/lib/api';
import { isAnimatedImage } from '@/lib/avatar-crop';
import { clearAppearanceCache } from '@/lib/community-appearance';
import { compact, dateOnly } from '@/lib/format';
import type { CommunityView } from '@/lib/community';
import type { Author } from '@/lib/types';
import { PROFILE_COVERS, profileCover, profileCoverUrl } from '../../../../shared/profile-covers';
import { AVATAR_MAX_BYTES, AVATAR_MAX_MB } from '../../../../shared/avatar';
import { parseTipLink, resolveTipInput } from '../../../../shared/tip-links';
import type { BadgeCollection } from '../../../../shared/community-badges';

const props = defineProps<{ community: CommunityView | null; badges: BadgeCollection | null; author: Author | null; startEditing?: boolean }>();
const emit = defineEmits<{ saved: []; tab: [name: string] }>();
const session = useSession();
const headerOverlays = inject(headerOverlaysKey, undefined);
const { t, locale } = useI18n();
const { lp } = useLocalePath();

const profile = computed(() => session.profile);
const handle = computed(() => profile.value?.handle ?? '');
const linked = computed(() => !!props.community?.enabled && !!props.community.link && props.community.link.state !== 'cleanup');
const level = computed(() => (linked.value ? props.community?.level ?? null : null));
const appearance = computed(() => props.community?.appearance?.effective ?? null);

// ---- 封面 --------------------------------------------------------------------
const editing = ref(false);
const draftCover = ref('');
const coverId = computed(() => (editing.value ? draftCover.value : profile.value?.cover ?? '') || '');
const cover = computed(() => profileCover(coverId.value));

// ---- 數據（預設關，設定頁或這裡都能開） ------------------------------------------
const stats = computed(() => [
  { key: 'works', value: props.author?.cardCount ?? 0, icon: 'cards' as const, tab: 'works' },
  { key: 'chats', value: props.author?.talkTotal ?? 0, icon: 'chat' as const, tab: '' },
  { key: 'followers', value: profile.value?.followers ?? 0, icon: 'heart' as const, tab: '' },
  { key: 'following', value: profile.value?.following ?? 0, icon: 'users' as const, tab: 'following' },
]);

// ---- 分享 ------------------------------------------------------------------------
const shared = ref(false);
async function share() {
  const url = new URL(lp(`/authors/${handle.value}`), location.origin).toString();
  try {
    if (navigator.share) { await navigator.share({ title: session.displayName, url }); return; }
    await navigator.clipboard.writeText(url);
    shared.value = true; setTimeout(() => { shared.value = false; }, 1800);
  } catch { /* 使用者取消分享或拿不到剪貼簿：不用提示 */ }
}
const copied = ref(false);
async function copyHandle() {
  try { await navigator.clipboard.writeText(handle.value); copied.value = true; setTimeout(() => { copied.value = false; }, 1800); } catch { /* 字就在畫面上 */ }
}

// ---- 編輯 ------------------------------------------------------------------------
const name = ref(''), bio = ref(''), tips = ref<TipRow[]>([]);
const file = ref<File | null>(null), removeAvatar = ref(false), cropping = ref<File | null>(null), animatedNote = ref(false);
const busy = ref(false), error = ref('');
let objectUrl = '';
const preview = ref('');
const picker = ref<HTMLInputElement | null>(null);
function setPreview(next: File | null) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = next ? URL.createObjectURL(next) : '';
  preview.value = objectUrl;
}
onBeforeUnmount(() => setPreview(null));

const tipsOf = (links: string[] | undefined) => (links ?? []).flatMap((url) => { const p = parseTipLink(url); return p.ok ? [{ platform: p.link.platform, value: url }] : []; });
const nameField = ref<HTMLInputElement | null>(null), bioField = ref<HTMLTextAreaElement | null>(null);
/**
 * 進入編輯。點下去的那顆鈕會被取消／保存換掉，焦點要有落點：預設落在昵称；
 * 從「寫一句簡介」進來落在簡介；從相機進來不搶焦點（接著要開選檔，手機上不該先彈鍵盤）。
 */
function begin(focus: 'name' | 'bio' | 'none' = 'name') {
  if (editing.value || busy.value) return;
  name.value = session.displayName; bio.value = profile.value?.bio ?? ''; tips.value = tipsOf(profile.value?.tipLinks);
  draftCover.value = profile.value?.cover ?? ''; file.value = null; removeAvatar.value = false; cropping.value = null; animatedNote.value = false;
  setPreview(null); error.value = ''; editing.value = true;
  if (focus !== 'none') void nextTick(() => (focus === 'bio' ? bioField : nameField).value?.focus());
}
function discard() { if (busy.value) return; setPreview(null); cropping.value = null; editing.value = false; error.value = ''; }
/** 頂部與底部的「取消」：有修改先問一次，沒修改直接退出 */
async function cancel() {
  if (busy.value) return;
  if (pending.value && !(await confirmDialog({ message: t('profile.discardAsk'), confirmText: t('profile.discardConfirm'), cancelText: t('profile.keepEditing'), danger: true }))) return;
  discard();
}
watch(() => props.startEditing, (on) => { if (on && !editing.value && profile.value) begin(); }, { immediate: true });
// 只在資料第一次讀到時自動進入編輯（從設定頁 ?edit=1 進來）。保存也會換掉 profile，
// 那時網址參數還沒清掉，若照樣進入就會存完又跳回編輯。
watch(profile, (p, old) => { if (p && !old && props.startEditing && !editing.value) begin(); });

const dirty = computed(() => editing.value && (
  name.value !== session.displayName || bio.value !== (profile.value?.bio ?? '') || draftCover.value !== (profile.value?.cover ?? '') ||
  !!file.value || removeAvatar.value || JSON.stringify(tips.value.map((r) => r.value)) !== JSON.stringify(tipsOf(profile.value?.tipLinks).map((r) => r.value))
));
/** 選了圖還在裁切也算有東西沒存：離開、取消都要問 */
const pending = computed(() => dirty.value || !!cropping.value);
const canSave = computed(() => dirty.value && !busy.value && !!name.value.trim() && !cropping.value);

// ---- 底部浮條：頂部那組看得到就不出現，免得畫面上同時有兩顆保存 ----------------------
const editActions = ref<HTMLElement | null>(null);
const actionsInView = ref(true);
let observer: IntersectionObserver | null = null;
watch(editActions, (node) => {
  observer?.disconnect(); observer = null; actionsInView.value = true;
  if (!node || typeof IntersectionObserver === 'undefined') return;
  // 頁首是 sticky 的，被它蓋住也算看不到
  const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 0;
  observer = new IntersectionObserver(([entry]) => { actionsInView.value = !!entry?.isIntersecting && entry.intersectionRatio > 0.95; }, { rootMargin: `-${header}px 0px 0px 0px`, threshold: [0, 0.95, 1] });
  observer.observe(node);
});
onBeforeUnmount(() => observer?.disconnect());
const showBar = computed(() => editing.value && pending.value && !actionsInView.value);

const errorBox = ref<HTMLElement | null>(null);
watch(error, (message) => { if (message) void nextTick(() => errorBox.value?.scrollIntoView?.({ block: 'nearest' })); });

// 與站內編輯頁一致：切分區／離開先確認，重新整理與關閉分頁用瀏覽器提示。
async function mayLeave() {
  if (busy.value) return false;
  if (!pending.value) return true;
  if (!(await confirmDialog({ message: t('blog.admin.unsaved'), confirmText: t('dialog.leave'), danger: true }))) return false;
  discard();
  return true;
}
onBeforeRouteLeave(mayLeave);
// 同頁換分區、翻頁只改網址參數，編輯區還在，不用問
onBeforeRouteUpdate((to, from) => (to.path === from.path ? true : mayLeave()));
function guardClose(event: BeforeUnloadEvent) {
  if (pending.value || busy.value) { event.preventDefault(); event.returnValue = ''; }
}
onMounted(() => window.addEventListener('beforeunload', guardClose));
onBeforeUnmount(() => window.removeEventListener('beforeunload', guardClose));

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/apng'];
async function selectAvatar(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = input.files?.[0];
  input.value = '';
  if (!selected) return;
  error.value = ''; animatedNote.value = false;
  if (!TYPES.includes(selected.type) || selected.size > AVATAR_MAX_BYTES) { error.value = t('community.avatarInvalid', { maxMB: AVATAR_MAX_MB }); return; }
  if (await isAnimatedImage(selected)) {
    // 動圖不裁：畫進 canvas 會只剩第一格。照原檔上傳，顯示時從中間裁成圓形。
    file.value = selected; removeAvatar.value = false; setPreview(selected); animatedNote.value = true; return;
  }
  cropping.value = selected;
}
function applyCrop(cropped: File) { file.value = cropped; removeAvatar.value = false; setPreview(cropped); cropping.value = null; }
function remove() { file.value = null; setPreview(null); removeAvatar.value = true; animatedNote.value = false; }
const avatarSrc = computed(() => (editing.value ? (preview.value || (removeAvatar.value ? '' : session.avatarUrl)) : session.avatarUrl));
const hasAvatar = computed(() => !!avatarSrc.value);

async function save() {
  if (!canSave.value) return;
  // 認不得的打賞連結先在這裡擋：伺服器整包拒收，作者只會看到一句籠統的失敗
  const resolved = tips.value.filter((r) => r.value.trim()).map((r) => resolveTipInput(r.platform, r.value));
  if (resolved.some((r) => !r.ok)) { error.value = t('tips.field.fix'); return; }
  busy.value = true; error.value = '';
  try {
    const token = await session.accessToken();
    if (!token) throw new Error('expired');
    session.profile = await updateSiteProfile(token, {
      displayName: name.value, bio: bio.value, tipLinks: resolved.map((r) => (r.ok ? r.link.url : '')),
      cover: draftCover.value, avatar: file.value, removeAvatar: removeAvatar.value,
    });
    clearAppearanceCache(handle.value);
    setPreview(null); editing.value = false; emit('saved');
  } catch { error.value = t('community.failed'); }
  finally { busy.value = false; }
}
defineExpose({ begin });
</script>

<template>
  <section class="hero panel" :class="{ 'hero--editing': editing }" :style="{ '--hue': cover.hue }" :aria-label="$t('me.title')">
    <div class="hero__cover">
      <img class="hero__cover-img" :src="profileCoverUrl(coverId)" alt="" />
      <img class="hero__cover-img hero__cover-blur" :src="profileCoverUrl(coverId)" alt="" aria-hidden="true" />
      <span class="hero__haze" aria-hidden="true" />
      <div v-if="editing" class="hero__covers" role="radiogroup" :aria-label="$t('profile.coverLabel')">
        <button v-for="(c, i) in PROFILE_COVERS" :key="c.id" type="button" role="radio" class="hero__cover-pick" :class="{ 'hero__cover-pick--on': cover.id === c.id }" :data-cover="c.id" :aria-checked="cover.id === c.id" :aria-label="`${$t('profile.coverLabel')} ${i + 1}`" @click="draftCover = c.id"><img :src="profileCoverUrl(c.id)" alt="" /></button>
      </div>
      <button v-else type="button" class="hero__cover-edit" @click="begin()"><AccountIcon name="camera" />{{ $t('profile.changeCover') }}</button>
    </div>

    <div class="hero__body">
      <div class="hero__top">
        <div class="hero__avatar">
          <img v-if="editing && preview" :src="preview" alt="" class="hero__face" />
          <span v-else-if="editing && !hasAvatar" class="hero__face hero__face--empty" aria-hidden="true">{{ [...(name || session.displayName || '?')][0] }}</span>
          <CommunityAvatar v-else :src="session.avatarUrl" :name="session.displayName" :appearance="appearance" class="hero__face" />
          <button type="button" class="hero__camera" :aria-label="$t('profile.changeAvatar')" @click="editing ? picker?.click() : (begin('none'), picker?.click())"><AccountIcon name="camera" /></button>
          <input ref="picker" type="file" class="sr-only" accept="image/jpeg,image/png,image/webp,image/gif,image/apng,.apng" :aria-label="$t('community.chooseAvatar')" @change="selectAvatar" />
        </div>
        <div v-if="editing" ref="editActions" class="hero__actions hero__actions--editing">
          <span v-if="pending" class="hero__unsaved"><span class="savebar__dot" aria-hidden="true" />{{ $t('profile.unsaved') }}</span>
          <button type="button" class="btn" :disabled="busy" @click="cancel">{{ $t('dialog.cancel') }}</button>
          <button type="button" class="btn btn--primary" :disabled="!canSave" @click="save">{{ busy ? $t('community.saving') : $t('profile.save') }}</button>
        </div>
        <div v-else class="hero__actions">
          <button type="button" class="btn" @click="begin()"><AccountIcon name="edit" />{{ $t('profile.editProfile') }}</button>
          <button type="button" class="btn hero__share" :aria-label="shared ? $t('profile.shareCopied') : $t('profile.share')" @click="share"><AccountIcon :name="shared ? 'check' : 'share'" /><span class="hero__btn-text">{{ shared ? $t('profile.shareCopied') : $t('profile.share') }}</span></button>
          <RouterLink v-if="handle" :to="lp(`/authors/${handle}`)" class="btn btn--icon" :aria-label="$t('profile.preview')" :title="$t('profile.preview')"><AccountIcon name="eye" /></RouterLink>
          <RouterLink :to="lp('/settings')" class="btn btn--icon" :aria-label="$t('nav.settings')" :title="$t('nav.settings')"><AccountIcon name="settings" /></RouterLink>
        </div>
      </div>

      <div class="hero__main">
        <AvatarCropper v-if="cropping" :file="cropping" class="hero__info" @apply="applyCrop" @cancel="cropping = null" @repick="picker?.click()" />

        <div v-else-if="editing" class="hero__info hero__form">
          <label class="field"><span class="field__label">{{ $t('community.name') }} · {{ [...name].length }}/60</span><input ref="nameField" v-model="name" class="field__input field__input--name" maxlength="60" required autocomplete="nickname" :disabled="busy" /></label>
          <p class="hero__locked"><AccountIcon name="lock" />@{{ handle }} · {{ $t('profile.idLocked') }}</p>
          <label class="field"><span class="field__label">{{ $t('community.bio') }} · {{ [...bio].length }}/500</span><textarea ref="bioField" v-model="bio" class="field__input" rows="3" maxlength="500" :placeholder="$t('community.bioHint')" :disabled="busy" /></label>
          <TipLinksField v-model="tips" :disabled="busy" compact />
          <div class="hero__edit-links">
            <button v-if="hasAvatar" type="button" class="btn btn--ghost btn--sm" :disabled="busy" @click="remove">{{ $t('community.removeAvatar') }}</button>
            <RouterLink :to="lp('/me/community')" class="hero__link">{{ $t('profile.appearanceLink') }} <AccountIcon name="arrow" /></RouterLink>
          </div>
          <p v-if="animatedNote" class="subtle">{{ $t('profile.crop.animated') }}</p>
          <p class="subtle">{{ $t('profile.publicHint') }}</p>
        </div>

        <div v-else class="hero__info">
          <div class="hero__name-row">
            <h1 class="hero__name display"><CommunityName :name="session.displayName" :appearance="appearance" /></h1>
            <span v-if="level !== null" class="hero__level"><CommunityIcon name="spark" />{{ $t('community.level', { level }) }}</span>
          </div>
          <div class="hero__meta">
            <button v-if="handle" type="button" class="hero__handle" :aria-label="copied ? $t('me.copied') : $t('me.copy')" @click="copyHandle">@<span class="me__handle">{{ handle }}</span><AccountIcon :name="copied ? 'check' : 'copy'" /></button>
            <span v-if="profile" class="hero__since"><AccountIcon name="calendar" />{{ $t('me.since', { date: dateOnly(Math.floor(profile.memberSince / 1000)) }) }}</span>
            <RouterLink v-if="linked" :to="lp('/me/community')" class="hero__discord"><CommunityIcon name="discord" />{{ $t('profile.discordLinked') }}</RouterLink>
          </div>
          <p v-if="profile?.bio" class="hero__bio">{{ profile.bio }}</p>
          <button v-else type="button" class="hero__add-bio" @click="begin('bio')"><AccountIcon name="plus" />{{ $t('profile.addBio') }}</button>
          <WornBadges v-if="handle" class="hero__badges" :handle="handle" own :collection="badges" />
        </div>

        <slot name="aside" />
      </div>

      <div v-if="!editing && profile?.showStats" class="hero__stats" role="list" :aria-label="$t('profile.statsLabel')">
        <component :is="s.tab ? 'button' : 'div'" v-for="s in stats" :key="s.key" role="listitem" class="hero__stat" :type="s.tab ? 'button' : undefined" @click="s.tab && emit('tab', s.tab)">
          <span class="hero__stat-label"><AccountIcon :name="s.icon" />{{ $t('profile.stat.' + s.key) }}</span>
          <strong>{{ compact(s.value) }}</strong>
        </component>
      </div>
      <p v-if="error" ref="errorBox" class="notice notice--error hero__error" role="alert">{{ error }}</p>
    </div>

    <Teleport to="body">
      <Transition name="savebar">
        <div v-if="showBar" class="savebar" :inert="(headerOverlays?.size ?? 0) > 0" role="region" :aria-label="$t('profile.editing')">
          <span class="savebar__state"><span class="savebar__dot" aria-hidden="true" />{{ $t('profile.unsaved') }}</span>
          <button type="button" class="btn savebar__discard" :disabled="busy" @click="cancel">{{ $t('dialog.cancel') }}</button>
          <button type="button" class="btn btn--primary" :disabled="!canSave" @click="save">{{ busy ? $t('community.saving') : $t('profile.save') }}</button>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.hero {
  --cover-h: 196px;
  --hero-top: hsl(var(--hue) 44% 89%);
  --hero-mid: hsl(var(--hue) 40% 95%);
  position: relative; overflow: hidden;
  background: linear-gradient(180deg, var(--hero-top) 0, var(--hero-top) var(--cover-h), var(--hero-mid) calc(var(--cover-h) + 120px), var(--surface) 100%);
}
:root[data-mode="dark"] .hero { --hero-top: hsl(var(--hue) 24% 19%); --hero-mid: hsl(var(--hue) 18% 15%); }
.hero--editing { box-shadow: 0 0 0 2px var(--accent), var(--shadow-md); }
.hero__cover { position: relative; height: var(--cover-h); overflow: hidden; }
.hero__cover-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: right 40%; }
.hero__cover-blur { filter: blur(18px) saturate(1.7) brightness(1.7); transform: scale(1.06); -webkit-mask-image: linear-gradient(180deg, transparent 35%, #000 85%); mask-image: linear-gradient(180deg, transparent 35%, #000 85%); }
:root[data-mode="dark"] .hero__cover-blur { filter: blur(18px) saturate(1.2) brightness(0.85); }
.hero__haze { position: absolute; inset: 0; background: linear-gradient(180deg, transparent 0, transparent 38%, color-mix(in srgb, var(--hero-top) 50%, transparent) 66%, color-mix(in srgb, var(--hero-top) 88%, transparent) 86%, var(--hero-top) 100%); }
.hero__cover-edit, .hero__covers { position: absolute; top: var(--s-4); right: var(--s-4); }
.hero__cover-edit { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 0; border-radius: var(--r-pill); background: rgba(16, 16, 24, 0.5); color: #fff; font: inherit; font-size: 13px; cursor: pointer; backdrop-filter: blur(10px); }
.hero__cover-edit svg { width: 16px; height: 16px; }
.hero__covers { left: var(--s-4); display: flex; gap: 6px; padding: 6px; overflow-x: auto; border-radius: var(--r-md); background: rgba(16, 16, 24, 0.45); backdrop-filter: blur(10px); scrollbar-width: none; }
.hero__cover-pick { flex: none; width: 76px; height: 38px; padding: 0; border: 0; border-radius: var(--r-sm); overflow: hidden; cursor: pointer; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25); }
.hero__cover-pick img { width: 100%; height: 100%; object-fit: cover; object-position: right center; }
.hero__cover-pick--on { box-shadow: 0 0 0 2px #fff; }

.hero__body { position: relative; padding: 0 var(--s-6) var(--s-6); }
.hero__top { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--s-4); margin-top: -84px; }
.hero__avatar { position: relative; width: 128px; height: 128px; flex: none; padding: 5px; border-radius: var(--r-pill); background: var(--hero-top); box-shadow: 0 8px 24px -10px rgba(0, 0, 0, 0.45); }
.hero__face { width: 118px !important; height: 118px !important; border-radius: var(--r-pill); object-fit: cover; font-size: 40px; }
.hero__face--empty { display: grid; place-items: center; background: var(--accent-tint); color: var(--accent-text); font-weight: 650; }
.hero__camera { position: absolute; right: 4px; bottom: 6px; display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: var(--r-pill); background: var(--text); color: var(--surface); cursor: pointer; box-shadow: 0 0 0 3px var(--hero-top); }
.hero__camera svg { width: 17px; height: 17px; }
.hero__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--s-2); padding-bottom: 6px; }
.hero__actions .btn:not(.btn--primary) { background: color-mix(in srgb, var(--surface) 72%, transparent); }

.hero__actions--editing { align-items: center; }
.hero__actions--editing .btn { min-height: var(--h-lg); }
.hero__unsaved { display: inline-flex; align-items: center; gap: 8px; margin-right: var(--s-1); font-size: 13px; color: var(--text-3); white-space: nowrap; }

.hero__main { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--s-5) var(--s-6); margin-top: var(--s-4); }
.hero__info { flex: 1 1 440px; min-width: 0; display: grid; gap: 10px; }
.hero__name-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.hero__name { margin: 0; font-size: 30px; letter-spacing: -0.025em; overflow-wrap: anywhere; }
.hero__level { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 9px; border-radius: var(--r-pill); background: var(--accent-tint); color: var(--accent-text); font-size: 12px; font-weight: 650; }
.hero__level svg { width: 13px; height: 13px; }
.hero__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px var(--s-4); font-size: 14px; color: var(--text-3); }
.hero__meta svg { width: 15px; height: 15px; }
.hero__handle { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0; border: 0; background: none; font: inherit; color: var(--text-2); cursor: pointer; }
.hero__since, .hero__discord { display: inline-flex; align-items: center; gap: 6px; }
.hero__discord { color: #5865f2; }
:root[data-mode="dark"] .hero__discord { color: #b9beff; }
.hero__bio { margin: 0; font-size: 15px; line-height: 1.75; color: var(--text-2); white-space: pre-wrap; overflow-wrap: anywhere; }
.hero__add-bio { display: inline-flex; align-items: center; gap: 8px; width: fit-content; max-width: 100%; padding: 8px 14px; border: 1px dashed var(--line-strong); border-radius: var(--r-sm); background: none; font: inherit; font-size: 14px; color: var(--text-3); cursor: pointer; text-align: start; }
.hero__add-bio svg { width: 15px; height: 15px; flex: none; }


.hero__stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: var(--s-5); border-radius: var(--r-md); box-shadow: 0 0 0 1px var(--line); overflow: hidden; }
.hero__stat { display: grid; gap: 6px; padding: var(--s-4) var(--s-5); border: 0; background: none; font: inherit; color: inherit; text-align: start; }
.hero__stat + .hero__stat { box-shadow: inset 1px 0 0 var(--line); }
button.hero__stat { cursor: pointer; }
button.hero__stat:hover { background: var(--surface-2); }
.hero__stat-label { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; color: var(--text-2); white-space: nowrap; }
.hero__stat-label svg { width: 16px; height: 16px; color: var(--text-3); }
.hero__stat strong { font-size: 24px; font-weight: 750; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }

.hero__form { gap: var(--s-3); }
.field { display: grid; gap: 4px; }
.field__label { font-size: 12px; color: var(--text-3); }
.field__input { width: 100%; padding: 8px 12px; border: 0; border-radius: var(--r-sm); background: color-mix(in srgb, var(--surface) 80%, transparent); box-shadow: inset 0 0 0 1px var(--line-strong); font: inherit; font-size: 15px; line-height: 1.7; color: var(--text); resize: vertical; }
.field__input:focus { outline: none; box-shadow: inset 0 0 0 2px var(--accent); }
.field__input--name { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.3; }
.hero__locked { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; color: var(--text-3); }
.hero__locked svg { width: 13px; height: 13px; }
.hero__edit-links { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); }
.hero__link { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--accent-text); }
.hero__link svg { width: 14px; height: 14px; }
.hero__error { margin-top: var(--s-4); }

.savebar { position: fixed; left: 50%; bottom: max(20px, env(safe-area-inset-bottom)); z-index: 20; display: flex; align-items: center; gap: var(--s-3); max-width: calc(100vw - 32px); padding: 8px 8px 8px 18px; border-radius: var(--r-pill); background: var(--text); color: var(--surface); box-shadow: 0 18px 40px -12px rgba(0, 0, 0, 0.5); transform: translateX(-50%); }
.savebar .btn { min-height: var(--h-lg); flex: none; }
.savebar__state { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.savebar__dot { width: 8px; height: 8px; flex: none; border-radius: var(--r-pill); background: var(--accent); }
.savebar-enter-active, .savebar-leave-active { transition: opacity var(--dur) var(--ease), translate var(--dur) var(--ease); }
.savebar-enter-from, .savebar-leave-to { opacity: 0; translate: 0 8px; }
@media (prefers-reduced-motion: reduce) { .savebar-enter-from, .savebar-leave-to { translate: none; } }
.savebar__discard { background: transparent; color: var(--surface); border-color: color-mix(in srgb, var(--surface) 30%, transparent); }
.savebar__discard:hover { background: color-mix(in srgb, var(--surface) 12%, transparent); }

@media (max-width: 700px) {
  .hero { --cover-h: 128px; }
  .hero__body { padding: 0 var(--s-4) var(--s-5); }
  .hero__top { margin-top: -52px; }
  .hero__avatar { width: 92px; height: 92px; padding: 4px; }
  .hero__face { width: 84px !important; height: 84px !important; font-size: 30px; }
  .hero__camera { width: 30px; height: 30px; right: 0; bottom: 2px; }
  .hero__actions { flex-wrap: nowrap; }
  .hero__actions .btn:not(.btn--icon) { padding: 0 12px; }
  .hero__actions .btn--icon { display: none; }
  /* 窄螢幕分享只留圖示，編輯資料跟它排同一列，不疊到封面上 */
  .hero__share { width: var(--h-md); padding: 0 !important; }
  .hero__share .hero__btn-text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .hero__name { font-size: 24px; }
  .hero__info { flex-basis: 100%; }
  /* 徽章整排橫向滑動：展示中的幾枚跟徽章牆入口排在同一條，不互相蓋住 */
  .hero__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hero__stat:nth-child(3) { box-shadow: inset 0 1px 0 var(--line); }
  .hero__stat:nth-child(4) { box-shadow: inset 1px 1px 0 var(--line); }
  .hero__unsaved { display: none; }
  .savebar { left: 16px; right: 16px; transform: none; max-width: none; }
  .savebar__state { flex: 1; min-width: 0; font-size: 12px; white-space: normal; }
}
</style>
