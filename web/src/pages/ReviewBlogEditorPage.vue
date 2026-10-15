<script setup lang="ts">
/**
 * 部落格文章編輯器：左邊 Markdown、右邊即時預覽（跟文章頁同一個 renderDoc），手機上改成「編輯／預覽」切換。
 *
 * 存檔帶上次讀到的版本號；別人先存過（blog_version_conflict）就停下來給兩條路——載入最新版本或複製我的內容——
 * 不自動覆蓋任何一邊。發布、撤下、置頂、留言開關都會讓版本號前進，所以每個回應都拿來更新版本號，
 * 下一次存檔才不會被自己的狀態變更擋成衝突；但只更新狀態，不動編輯中的內容。狀態變更的回應若帶著別人存的內容
 * （版本號跳了不只一號、或內容不同），不拿它當存檔基準，改走衝突那條路，免得下一次存檔蓋掉別人的修改。
 *
 * 操作編號：同一件事（同一份內容的存檔、同一個狀態變更、同一版還原）送失敗再按，沿用上一次的編號，
 * 服務端靠它認出重送；成功後丟掉。內容改過就是另一件事，換新的。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { RouterLink, onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  columnName, createPreview, displayStatus, fetchAdminColumns, fetchAdminPost, fetchRevision, fetchRevisions, imageUrlOf, POST_LOCALES,
  restoreRevision, savePost, setPostState, uploadBlogImage, type AdminPost, type BlogColumn, type PostInput, type Revision, type StateChange,
} from '@/lib/blog';
import { ApiError } from '@/lib/api';
import { fetchCampaigns, localized, type Campaign } from '@/lib/campaign';
import { confirmDialog } from '@/lib/confirm';
import { dateTime } from '@/lib/format';
import { LOCALES, pageTitle } from '@/lib/i18n';
import { renderDoc } from '@/lib/markdown-toc';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';

const { t } = useI18n();
const session = useSession();
const route = useRoute();
const router = useRouter();
const { lp, locale } = useLocalePath();

/** 表單上的樣子：可空的欄位用空字串，送出時才換成 null。 */
type Draft = { columnId: string; slug: string; locale: string; title: string; excerpt: string; bodyMd: string; coverKey: string | null; shareTitle: string; shareDescription: string; shareCoverKey: string | null; campaignId: string };
const empty = (): Draft => ({ columnId: '', slug: '', locale: String(locale.value), title: '', excerpt: '', bodyMd: '', coverKey: null, shareTitle: '', shareDescription: '', shareCoverKey: null, campaignId: '' });
const fromPost = (p: AdminPost): Draft => ({
  columnId: p.columnId, slug: p.slug, locale: p.locale, title: p.title, excerpt: p.excerpt, bodyMd: p.bodyMd, coverKey: p.coverKey,
  shareTitle: p.shareTitle ?? '', shareDescription: p.shareDescription ?? '', shareCoverKey: p.shareCoverKey, campaignId: p.campaignId ?? '',
});
const toInput = (d: Draft): PostInput => ({
  columnId: d.columnId, slug: d.slug.trim(), locale: d.locale, title: d.title, excerpt: d.excerpt, bodyMd: d.bodyMd, coverKey: d.coverKey,
  shareTitle: d.shareTitle.trim() || null, shareDescription: d.shareDescription.trim() || null, shareCoverKey: d.shareCoverKey, campaignId: d.campaignId.trim() || null,
});

const post = ref<AdminPost | null>(null);
const draft = reactive<Draft>(empty());
/** 最後一次跟服務端對齊時的內容；跟它不一樣就是有沒存的修改 */
const saved = ref(JSON.stringify(draft));
const dirty = computed(() => JSON.stringify(draft) !== saved.value);
const columns = ref<BlogColumn[]>([]);
/** 「關聯活動」選單的選項；讀不到不擋編輯，已存的關聯照樣留著 */
const campaigns = ref<Campaign[]>([]);
const campaignLabel = (c: Campaign) => t('blog.admin.campaignOption', { title: localized(c.title, String(locale.value)) || c.slug, status: t(`campaign.status.${c.status}`) });
const revisions = ref<Revision[]>([]);
const opened = ref<(Revision & { bodyMd: string }) | null>(null);
const loading = ref(true);
const saving = ref(false);
/** 還在上傳的圖片數：有的話不能存，不然佔位文字會被存進去 */
const uploading = ref(0);
const busy = ref(false);
const conflict = ref(false);
const error = ref('');
const done = ref('');
const pane = ref<'edit' | 'preview'>('edit');
const slugTouched = ref(false);
const schedule = ref('');
const previewUrl = ref('');
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const source = ref<HTMLTextAreaElement | null>(null);

const rendered = computed(() => renderDoc(draft.bodyMd).html);
const openedHtml = computed(() => (opened.value ? renderDoc(opened.value.bodyMd).html : ''));
const status = computed(() => (post.value ? displayStatus(post.value) : 'draft'));
const localeLabel = (code: string) => LOCALES.find((l) => l.code === code)?.label ?? code;
const message = (e: unknown, fallback = 'moderation.error.retry') => (e instanceof Error ? e.message : t(fallback));

const ops = new Map<string, string>();
const opFor = (key: string) => { let id = ops.get(key); if (!id) { id = crypto.randomUUID(); ops.set(key, id); } return id; };

async function token() {
  const value = await session.accessToken();
  if (!value) throw new Error(t('auth.expired'));
  return value;
}

/** 把服務端的版本放進編輯器（丟掉本地內容）。 */
function apply(p: AdminPost) {
  ops.clear();
  post.value = p;
  Object.assign(draft, fromPost(p));
  saved.value = JSON.stringify(draft);
  conflict.value = false;
  schedule.value = p.status === 'published' && p.publishAt && p.publishAt > Date.now() ? toLocalInput(p.publishAt) : '';
}
function toLocalInput(ms: number) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

async function load() {
  loading.value = true; error.value = ''; previewUrl.value = ''; opened.value = null;
  try {
    const access = await token();
    const id = route.params.id && route.params.id !== 'new' ? String(route.params.id) : '';
    const [cols, p, revs, camps] = await Promise.all([
      fetchAdminColumns(access), id ? fetchAdminPost(access, id) : null, id ? fetchRevisions(access, id) : null, fetchCampaigns(access).catch(() => null),
    ]);
    columns.value = cols.items;
    campaigns.value = camps?.items ?? [];
    revisions.value = revs?.items ?? [];
    if (p) apply(p);
    else {
      post.value = null;
      Object.assign(draft, empty(), { columnId: cols.items[0]?.id ?? '' });
      saved.value = JSON.stringify(draft);
      slugTouched.value = false;
    }
  } catch (e) { error.value = message(e, 'state.loadFailed'); } finally { loading.value = false; }
}
async function loadRevisions() {
  if (!post.value) return;
  try { revisions.value = (await fetchRevisions(await token(), post.value.id)).items; } catch { /* 側欄讀不到不擋編輯 */ }
}

/** 新文章的網址代號從標題建議：英數字留下、其餘變連字號；全是中日韓文字就用日期。改過一次就不再跟著標題走。 */
function suggestSlug(title: string) {
  const s = title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return s || `post-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
}
watch(() => draft.title, (title) => { if (!post.value && !slugTouched.value) draft.slug = title.trim() ? suggestSlug(title) : ''; });

/** 回應帶著別人存的內容時，只收狀態、版本號留在原處並標成衝突：下一次存檔會被擋下，不會蓋掉別人的修改。 */
function holdBase(prev: AdminPost, res: AdminPost) {
  const { status, publishAt, firstPublishedAt, pinned, commentsClosed, pinnedCommentId } = res;
  post.value = { ...prev, status, publishAt, firstPublishedAt, pinned, commentsClosed, pinnedCommentId };
  conflict.value = true;
}

async function save() {
  if (saving.value || busy.value || uploading.value) return;
  const input = toInput(draft);
  const sent = JSON.stringify(draft);
  const key = `save:${JSON.stringify(input)}`;
  saving.value = true; error.value = ''; done.value = '';
  try {
    const p = post.value;
    const res = await savePost(await token(), input, opFor(key), p?.id, p?.version);
    ops.delete(key);
    // 重送被認成同一次時，回來的可能是別人較新的版本；存檔途中我又打了字的話，不拿它當基準（見 holdBase）
    if (res.version !== (p?.version ?? 0) + 1 && JSON.stringify(draft) !== sent) holdBase(p ?? { ...res, version: 0 }, res);
    else {
      post.value = res;
      saved.value = JSON.stringify(fromPost(res));
      // 存檔途中又打了字：留著，那些仍是沒存的修改
      if (JSON.stringify(draft) === sent) Object.assign(draft, fromPost(res));
      done.value = t('blog.admin.saved');
    }
    if (!p) await router.replace(lp(`/review/blog/${res.id}`));
    void loadRevisions();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'blog_version_conflict') conflict.value = true;
    else error.value = message(e);
  } finally { saving.value = false; }
}
async function loadLatest() {
  if (!post.value) return;
  busy.value = true; error.value = '';
  try {
    const access = await token();
    const [p, revs] = await Promise.all([fetchAdminPost(access, post.value.id), fetchRevisions(access, post.value.id)]);
    apply(p); revisions.value = revs.items;
  } catch (e) { error.value = message(e, 'state.loadFailed'); } finally { busy.value = false; }
}
async function copy(text: string, ok: string) {
  try { await navigator.clipboard.writeText(text); done.value = t(ok); } catch { error.value = t('blog.admin.copyFailed'); }
}

// ---- 狀態變更：每一種一顆鍵、一個確認對話框 ----

const scheduleAt = computed(() => {
  const ms = schedule.value ? new Date(schedule.value).getTime() : NaN;
  return Number.isFinite(ms) && ms > Date.now() ? ms : null;
});
async function change(c: StateChange, title: string, msg: string, danger = false) {
  if (!post.value || busy.value) return;
  if (!(await confirmDialog({ title, message: msg, confirmText: title, danger }))) return;
  const key = `state:${JSON.stringify(c)}`;
  busy.value = true; error.value = ''; done.value = '';
  try {
    const prev = post.value;
    const res = await setPostState(await token(), prev.id, c, opFor(key));
    ops.delete(key);
    // 只收狀態與版本號：編輯中的內容不動。中間有人存過內容的話，版本號留在原處、標成衝突，
    // 下一次存檔就會被擋下來，交給「載入最新版本／複製我的內容」
    const moved = res.version !== prev.version + 1 || JSON.stringify(fromPost(res)) !== JSON.stringify(fromPost(prev));
    if (moved) holdBase(prev, res);
    else post.value = res;
    done.value = t('blog.admin.saved');
  } catch (e) { error.value = message(e); } finally { busy.value = false; }
}
const publish = () => {
  const at = scheduleAt.value;
  return at
    ? change({ status: 'published', publishAt: at }, t('blog.admin.schedule'), t('blog.admin.scheduleConfirm', { date: `${dateTime(at)} (${zone})` }))
    : change({ status: 'published' }, t('blog.admin.publish'), t('blog.admin.publishConfirm'));
};
const unpublish = () => change({ status: 'unpublished' }, t('blog.admin.unpublish'), t('blog.admin.unpublishConfirm'), true);
const pin = (on: boolean) => change({ pinned: on }, t(on ? 'blog.admin.pin' : 'blog.admin.unpin'), t(on ? 'blog.admin.pinConfirm' : 'blog.admin.unpinConfirm'));
const comments = (close: boolean) => change({ commentsClosed: close }, t(close ? 'blog.admin.closeComments' : 'blog.admin.openComments'), t(close ? 'blog.admin.closeCommentsConfirm' : 'blog.admin.openCommentsConfirm'), close);

async function makePreview() {
  if (!post.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    const res = await createPreview(await token(), post.value.id);
    previewUrl.value = `${location.origin}${lp(res.url)}`;
  } catch (e) { error.value = message(e); } finally { busy.value = false; }
}

// ---- 修訂紀錄 ----

async function openRevision(r: Revision) {
  if (!post.value) return;
  try { opened.value = await fetchRevision(await token(), post.value.id, r.id); } catch (e) { error.value = message(e, 'state.loadFailed'); }
}
async function restore() {
  const r = opened.value;
  if (!post.value || !r || busy.value) return;
  if (!(await confirmDialog({ title: t('blog.admin.restore'), message: t('blog.admin.restoreConfirm'), confirmText: t('blog.admin.restore'), danger: true }))) return;
  const key = `restore:${r.id}`;
  busy.value = true; error.value = ''; done.value = '';
  try {
    const res = await restoreRevision(await token(), post.value.id, r.id, opFor(key));
    ops.delete(key);
    apply(res);
    opened.value = null;
    done.value = t('blog.admin.saved');
    void loadRevisions();
  } catch (e) { error.value = message(e); } finally { busy.value = false; }
}

// ---- 圖片：拖放或貼上就上傳，先在游標處放一段佔位文字，傳好換成圖片語法，失敗就拿掉 ----

let uploads = 0;
async function insertImages(files: File[]) {
  const el = source.value;
  let at = el ? el.selectionStart : draft.bodyMd.length;
  // 第二張起的佔位文字自帶前面那個換行：失敗時連換行一起拿掉
  const marks = files.map((file, i) => ({ file, mark: `${i ? '\n' : ''}![${t('blog.admin.uploading')}](#upload-${++uploads})` }));
  const text = marks.map((m) => m.mark).join('');
  draft.bodyMd = draft.bodyMd.slice(0, at) + text + draft.bodyMd.slice(el ? el.selectionEnd : at);
  at += text.length;
  await nextTick();
  el?.setSelectionRange(at, at);
  uploading.value += marks.length;
  const access = await token().catch(() => '');
  await Promise.all(marks.map(async ({ file, mark }) => {
    try {
      if (!access) throw new Error();
      const { url } = await uploadBlogImage(access, file);
      draft.bodyMd = draft.bodyMd.replace(mark, () => `${mark.startsWith('\n') ? '\n' : ''}![](${url})`);
    } catch {
      draft.bodyMd = draft.bodyMd.replace(mark, '');
      error.value = t('blog.admin.uploadFailed');
    } finally { uploading.value--; }
  }));
}
const images = (list: FileList | File[] | undefined | null) => [...(list ?? [])].filter((f) => f.type.startsWith('image/'));
function onPaste(e: ClipboardEvent) {
  const files = images(e.clipboardData?.files);
  if (!files.length) return;
  e.preventDefault();
  void insertImages(files);
}
function onDrop(e: DragEvent) {
  const files = images(e.dataTransfer?.files);
  if (!files.length) return;
  e.preventDefault();
  void insertImages(files);
}
async function uploadCover(e: Event, field: 'coverKey' | 'shareCoverKey') {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  busy.value = true; error.value = '';
  try { draft[field] = (await uploadBlogImage(await token(), file)).key; } catch { error.value = t('blog.admin.uploadFailed'); } finally { busy.value = false; }
}

// ---- 離開前提醒：站內換頁與關分頁都攔 ----

const ask = async () => !dirty.value || (await confirmDialog({ message: t('blog.admin.unsaved'), confirmText: t('dialog.leave'), danger: true }));
onBeforeRouteLeave(ask);
// 同一條記錄換到另一篇（或回到新文章）也要問；第一次存好換成自己的網址不問
onBeforeRouteUpdate((to) => (to.params.id === post.value?.id ? true : ask()));
const guard = (e: BeforeUnloadEvent) => { if (dirty.value) { e.preventDefault(); e.returnValue = ''; } };
onMounted(() => { document.title = pageTitle(t('moderation.tab.blog')); window.addEventListener('beforeunload', guard); void load(); });
onBeforeUnmount(() => window.removeEventListener('beforeunload', guard));
// 新文章第一次存好會換到它自己的網址：那一篇已經在編輯器裡，不必重讀
watch(() => route.params.id, (id) => { if (/\/review\/blog\/[^/]+$/.test(route.path) && (!id || id !== post.value?.id)) void load(); });
</script>

<template>
  <section class="bed" :aria-label="t('moderation.tab.blog')" :aria-busy="loading">
    <div class="bed-bar">
      <RouterLink class="btn btn--sm btn--ghost" :to="lp('/review/blog')">{{ t('blog.admin.back') }}</RouterLink>
      <span class="chip bed-status">{{ t(`blog.admin.status.${status}`) }}</span>
      <span v-if="post?.publishAt" class="subtle bed-when">{{ t('blog.admin.publishedAt', { date: dateTime(post.publishAt) }) }}</span>
    </div>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <p v-if="done && !error" class="notice" role="status">{{ done }}</p>
    <div v-if="conflict" class="notice notice--error bed-conflict" role="alert" data-conflict>
      <span>{{ t('blog.admin.conflict') }}</span>
      <span class="bed-conflict__actions">
        <button type="button" class="btn btn--sm" data-action="load-latest" :disabled="busy" @click="loadLatest">{{ t('blog.admin.loadLatest') }}</button>
        <button type="button" class="btn btn--sm" data-action="copy-mine" @click="copy(draft.bodyMd, 'blog.admin.copied')">{{ t('blog.admin.copyMine') }}</button>
      </span>
    </div>
    <p v-if="!loading && !columns.length" class="notice">{{ t('blog.admin.needColumn') }}</p>

    <template v-if="loading">
      <div class="ghost bed-ghost--title" />
      <div class="ghost bed-ghost--body" />
    </template>
    <template v-else>
      <input v-model="draft.title" class="input bed-title" maxlength="120" :placeholder="t('blog.admin.postTitle')" :aria-label="t('blog.admin.postTitle')" />

      <div class="bed-actions">
        <button type="button" class="btn btn--primary" data-action="save" :disabled="saving || busy || uploading > 0 || !columns.length || !draft.title.trim()" @click="save">{{ t('blog.admin.save') }}</button>
        <template v-if="post">
          <button v-if="post.status === 'published'" type="button" class="btn" data-action="unpublish" :disabled="busy || saving" @click="unpublish">{{ t('blog.admin.unpublish') }}</button>
          <button v-else type="button" class="btn" data-action="publish" :disabled="busy || saving || dirty" :title="dirty ? t('blog.admin.saveFirst') : undefined" @click="publish">{{ scheduleAt ? t('blog.admin.schedule') : t('blog.admin.publish') }}</button>
          <button type="button" class="btn" data-action="pin" :disabled="busy || saving" @click="pin(!post.pinned)">{{ post.pinned ? t('blog.admin.unpin') : t('blog.admin.pin') }}</button>
          <button type="button" class="btn" data-action="comments" :disabled="busy || saving" @click="comments(!post.commentsClosed)">{{ post.commentsClosed ? t('blog.admin.openComments') : t('blog.admin.closeComments') }}</button>
        </template>
      </div>
      <p v-if="post && dirty && post.status !== 'published'" class="subtle bed-hint">{{ t('blog.admin.saveFirst') }}</p>

      <div class="seg bed-pane">
        <button type="button" class="seg__item" :class="{ 'seg__item--on': pane === 'edit' }" :aria-pressed="pane === 'edit'" @click="pane = 'edit'">{{ t('blog.admin.edit') }}</button>
        <button type="button" class="seg__item" :class="{ 'seg__item--on': pane === 'preview' }" :aria-pressed="pane === 'preview'" @click="pane = 'preview'">{{ t('blog.admin.preview') }}</button>
      </div>
      <div class="bed-split" :class="`bed-split--${pane}`">
        <textarea ref="source" v-model="draft.bodyMd" class="input bed-source" data-source spellcheck="false" maxlength="60000" :aria-label="t('blog.admin.body')"
                  @paste="onPaste" @drop="onDrop" @dragover.prevent />
        <!-- renderDoc 不吃 HTML（html:false），跟文章頁同一份渲染 -->
        <article class="panel bed-preview" :aria-label="t('blog.admin.preview')" v-html="rendered" />
      </div>

      <div class="bed-lower">
        <form class="panel bed-settings" @submit.prevent="save">
          <h2>{{ t('blog.admin.settings') }}</h2>
          <label class="field">
            <span>{{ t('blog.admin.columns') }}</span>
            <select v-model="draft.columnId" class="input">
              <option v-for="c in columns" :key="c.id" :value="c.id">{{ columnName(c, String(locale)) }}{{ c.enabled ? '' : ` (${t('blog.admin.hidden')})` }}</option>
            </select>
          </label>
          <label class="field">
            <span>{{ t('blog.admin.slug') }}</span>
            <input v-model="draft.slug" class="input" maxlength="80" pattern="[a-z0-9][a-z0-9\-]*" autocapitalize="off" spellcheck="false" @input="slugTouched = true" />
            <span class="subtle">{{ t('blog.admin.slugHint') }}</span>
          </label>
          <label class="field">
            <span>{{ t('blog.admin.locale') }}</span>
            <select v-model="draft.locale" class="input">
              <option v-for="l in POST_LOCALES" :key="l" :value="l">{{ localeLabel(l) }}</option>
            </select>
          </label>
          <label class="field">
            <span>{{ t('blog.admin.excerpt') }}</span>
            <textarea v-model="draft.excerpt" class="input" rows="3" maxlength="300" />
          </label>
          <div class="field">
            <span class="bed-label">{{ t('blog.admin.cover') }}</span>
            <img v-if="draft.coverKey" class="bed-cover" :src="imageUrlOf(draft.coverKey)!" alt="" />
            <span class="bed-row">
              <label class="btn btn--sm">{{ t('blog.admin.upload') }}<input type="file" accept="image/*" class="bed-file" :disabled="busy" @change="uploadCover($event, 'coverKey')" /></label>
              <button v-if="draft.coverKey" type="button" class="btn btn--sm btn--ghost" @click="draft.coverKey = null">{{ t('blog.admin.removeImage') }}</button>
            </span>
          </div>
          <fieldset class="bed-group">
            <legend>{{ t('blog.admin.share') }}</legend>
            <label class="field">
              <span>{{ t('blog.admin.shareTitle') }}</span>
              <input v-model="draft.shareTitle" class="input" maxlength="120" :placeholder="draft.title" />
            </label>
            <label class="field">
              <span>{{ t('blog.admin.shareDescription') }}</span>
              <textarea v-model="draft.shareDescription" class="input" rows="2" maxlength="300" :placeholder="draft.excerpt" />
            </label>
            <div class="field">
              <span class="bed-label">{{ t('blog.admin.shareCover') }}</span>
              <img v-if="draft.shareCoverKey" class="bed-cover" :src="imageUrlOf(draft.shareCoverKey)!" alt="" />
              <span class="bed-row">
                <label class="btn btn--sm">{{ t('blog.admin.upload') }}<input type="file" accept="image/*" class="bed-file" :disabled="busy" @change="uploadCover($event, 'shareCoverKey')" /></label>
                <button v-if="draft.shareCoverKey" type="button" class="btn btn--sm btn--ghost" @click="draft.shareCoverKey = null">{{ t('blog.admin.removeImage') }}</button>
              </span>
            </div>
          </fieldset>
          <label class="field">
            <span>{{ t('blog.admin.campaign') }}</span>
            <select v-model="draft.campaignId" class="input" data-field="campaign">
              <option value="">{{ t('blog.admin.noCampaign') }}</option>
              <option v-for="c in campaigns" :key="c.id" :value="c.id">{{ campaignLabel(c) }}</option>
              <option v-if="draft.campaignId && !campaigns.some((c) => c.id === draft.campaignId)" :value="draft.campaignId">{{ draft.campaignId }}</option>
            </select>
          </label>
          <label v-if="post && post.status !== 'published'" class="field">
            <span>{{ t('blog.admin.scheduleAt', { zone }) }}</span>
            <input v-model="schedule" class="input" type="datetime-local" />
            <span class="subtle">{{ t('blog.admin.scheduleHint') }}</span>
          </label>
        </form>

        <aside class="bed-side">
          <section v-if="post" class="panel bed-box">
            <h2>{{ t('blog.admin.previewLink') }}</h2>
            <button type="button" class="btn btn--sm" :disabled="busy" @click="makePreview">{{ t('blog.admin.makePreview') }}</button>
            <template v-if="previewUrl">
              <code class="bed-link">{{ previewUrl }}</code>
              <button type="button" class="btn btn--sm" @click="copy(previewUrl, 'blog.copied')">{{ t('blog.copyLink') }}</button>
            </template>
          </section>
          <section v-if="post" class="panel bed-box">
            <h2>{{ t('blog.admin.revisions') }}</h2>
            <p v-if="!revisions.length" class="subtle">{{ t('blog.admin.noRevisions') }}</p>
            <ul v-else class="bed-revs">
              <li v-for="r in revisions" :key="r.id">
                <button type="button" class="bed-rev" :class="{ 'bed-rev--on': opened?.id === r.id }" :aria-pressed="opened?.id === r.id" @click="openRevision(r)">
                  <span class="bed-rev__title">{{ r.title }}</span>
                  <span class="subtle">{{ t('blog.admin.revisionBy', { name: r.editorHandle, date: dateTime(r.createdAt) }) }}</span>
                </button>
              </li>
            </ul>
            <div v-if="opened" class="bed-opened">
              <h3>{{ opened.title }}</h3>
              <article class="bed-preview bed-preview--rev" v-html="openedHtml" />
              <button type="button" class="btn btn--sm btn--danger" data-action="restore" :disabled="busy" @click="restore">{{ t('blog.admin.restore') }}</button>
            </div>
          </section>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.bed { display: grid; gap: var(--s-4); min-width: 0; }
.bed-bar { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; }
.bed-status { cursor: default; }
.bed-when { font-size: 13px; }
.bed-conflict { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; justify-content: space-between; }
.bed-conflict__actions { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.bed-ghost--title { height: 48px; }
.bed-ghost--body { height: 360px; }
.bed-title { width: 100%; height: auto; padding: var(--s-3) var(--s-4); font-size: 20px; font-weight: 600; }
.bed-actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.bed-hint { margin: calc(-1 * var(--s-2)) 0 0; font-size: 13px; }
.bed-pane { display: none; justify-self: start; }
.bed-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--s-3); min-height: 420px; }
.bed-source { width: 100%; height: auto; min-height: 420px; padding: var(--s-3) var(--s-4); resize: vertical; font: 14px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.bed-preview { padding: var(--s-4) var(--s-5); min-width: 0; overflow: auto; max-height: 720px; font-size: 15px; line-height: 1.8; overflow-wrap: anywhere; }
.bed-preview :deep(h1), .bed-preview :deep(h2) { font-size: 20px; margin: var(--s-5) 0 var(--s-3); }
.bed-preview :deep(h3) { font-size: 17px; margin: var(--s-4) 0 var(--s-2); }
.bed-preview :deep(:first-child) { margin-top: 0; }
.bed-preview :deep(p), .bed-preview :deep(ul), .bed-preview :deep(ol), .bed-preview :deep(blockquote), .bed-preview :deep(pre) { margin: 0 0 var(--s-3); }
.bed-preview :deep(ul), .bed-preview :deep(ol) { padding-left: 1.4em; }
.bed-preview :deep(a) { color: var(--accent-text); text-decoration: underline; }
.bed-preview :deep(img) { display: block; max-width: 100%; height: auto; border-radius: var(--r-md); }
.bed-preview :deep(code) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; padding: 1px 6px; border-radius: 5px; background: var(--surface-2); }
.bed-preview :deep(pre) { padding: var(--s-3); overflow-x: auto; border-radius: var(--r-sm); background: var(--surface-2); }
.bed-preview :deep(pre code) { padding: 0; background: none; }
.bed-preview :deep(blockquote) { padding: var(--s-2) var(--s-3); border-left: 3px solid var(--accent); background: var(--accent-tint); color: var(--text-2); }
.bed-lower { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 340px); gap: var(--s-4); align-items: start; }
.bed-settings { padding: var(--s-5); display: grid; min-width: 0; }
.bed-settings h2, .bed-box h2 { font-size: 17px; margin-bottom: var(--s-3); }
.bed-settings .field { margin-bottom: var(--s-4); }
.bed-settings .field > span:first-child, .bed-label { font-size: 13px; font-weight: 600; }
.bed-settings .input { width: 100%; }
.bed-settings textarea.input { height: auto; padding: 10px 12px; line-height: 1.6; resize: vertical; }
.bed-group { border: 0; margin: 0 0 var(--s-2); padding: 0; min-width: 0; }
.bed-group legend { font-size: 15px; font-weight: 600; margin-bottom: var(--s-3); }
.bed-row { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.bed-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.bed-row .btn { position: relative; cursor: pointer; }
.bed-cover { display: block; max-width: 100%; max-height: 180px; border-radius: var(--r-sm); object-fit: cover; }
.bed-side { display: grid; gap: var(--s-4); min-width: 0; }
.bed-box { padding: var(--s-4); display: grid; gap: var(--s-2); min-width: 0; }
.bed-box > .btn { justify-self: start; }
.bed-link { display: block; padding: 10px 12px; border-radius: var(--r-sm); background: var(--surface-2); font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; user-select: all; }
.bed-revs { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-1); max-height: 320px; overflow-y: auto; }
.bed-rev { display: grid; gap: 2px; width: 100%; padding: var(--s-2) var(--s-3); border: 0; border-radius: var(--r-sm); background: transparent; color: var(--text); text-align: start; font: inherit; font-size: 13px; cursor: pointer; }
.bed-rev:hover, .bed-rev--on { background: var(--surface-2); }
.bed-rev__title { font-weight: 600; overflow-wrap: anywhere; }
.bed-opened { display: grid; gap: var(--s-2); padding-top: var(--s-2); border-top: 1px solid var(--line); }
.bed-opened h3 { font-size: 15px; }
.bed-opened > .btn { justify-self: start; }
.bed-preview--rev { padding: 0; max-height: 280px; font-size: 14px; }
@media (max-width: 760px) {
  .bed-pane { display: inline-flex; }
  .bed-split { grid-template-columns: minmax(0, 1fr); min-height: 0; }
  .bed-split--edit .bed-preview, .bed-split--preview .bed-source { display: none; }
  .bed-source { min-height: 55vh; }
  .bed-preview { max-height: none; padding: var(--s-4); }
  .bed-lower { grid-template-columns: minmax(0, 1fr); }
  .bed-settings { padding: var(--s-4); }
  .bed .btn, .bed .input:not(textarea) { min-height: 44px; }
  .bed-actions .btn { flex: 1 1 auto; }
}
</style>
