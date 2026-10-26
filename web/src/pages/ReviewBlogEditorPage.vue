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
  changeTranslation,fetchTranslationGroups,type TranslationGroup,allColumns, AUTOSAVE_MS, columnName, createPreview, displayStatus, fetchAdminColumns, fetchAdminPost, fetchRevision, fetchRevisions, imageUrlOf, POST_LOCALES,
  restoreRevision, savePost, setPostState, uploadBlogImage, type AdminPost, type BlogGroup, type PostInput, type Revision, type StateChange, suggestSlug,
} from '@/lib/blog';
import MarkdownToolbar from '@/components/MarkdownToolbar.vue';
import { ApiError } from '@/lib/api';
import { applyMarkdown, type MarkdownAction } from '@/lib/markdown-edit';
import { fetchCampaigns, localized, type Campaign } from '@/lib/campaign';
import { BLOG_PINNED_LIMIT,BLOG_HOME_FRESH_DAYS,BLOG_HOME_LIMIT } from '../../../shared/blog';
import { confirmDialog,confirmForm } from '@/lib/confirm';
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
const groups = ref<BlogGroup[]>([]);
const columns = computed(() => allColumns(groups.value));
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
/** 最後一次存好的時間，以及是不是自動存的（頂部顯示「已自動儲存 · 時間」） */
const lastSaved = ref<{ at: number; auto: boolean } | null>(null);
/** 自動儲存沒存上：不跳錯誤橫幅，頂部的儲存狀態改成可以點的「沒存上，再試一次」 */
const saveFailed = ref(false);
/** 手機上右側設定欄收成底部抽屜 */
const sideOpen = ref(false);
const revOpen = ref(false);
const menu = ref<HTMLDetailsElement | null>(null);
/** 按了發布或更新而必填沒填：標出來 */
const showMissing = ref(false);
const missing = computed(() => (['columnId', 'title', 'slug'] as const).filter((f) => !String(draft[f]).trim()));
const isMissing = (f: string) => showMissing.value && (missing.value as readonly string[]).includes(f);

const rendered = computed(() => renderDoc(draft.bodyMd).html);
const openedHtml = computed(() => (opened.value ? renderDoc(opened.value.bodyMd).html : ''));
const status = computed(() => (post.value ? displayStatus(post.value) : 'draft'));
/** 已發布（含排程中）：主按鈕是「更新」，不自動儲存 */
const live = computed(() => post.value?.status === 'published');
const timeOf = (ms: number) => new Intl.DateTimeFormat(String(locale.value), { hour: '2-digit', minute: '2-digit' }).format(ms);
const saveState = computed(() => {
  if (saving.value) return t('blog.admin.saving');
  if (saveFailed.value) return t('blog.admin.saveFailedRetry');
  if (dirty.value) return t('blog.admin.unsavedShort');
  if (lastSaved.value) return t(lastSaved.value.auto ? 'blog.admin.autoSavedAt' : 'blog.admin.savedAt', { time: timeOf(lastSaved.value.at) });
  return '';
});
const localeLabel = (code: string) => LOCALES.find((l) => l.code === code)?.label ?? code;
const message = (e: unknown, fallback = 'moderation.error.retry') => (e instanceof Error ? e.message : t(fallback));

const translationSource=ref<AdminPost|null>(null);
const translationLanguage=ref('en');
const versions=computed(()=>post.value?.translations??[]);
const urlLocked=computed(()=>!!post.value&&(post.value.wasPublic===true||(post.value.status==='published'&&post.value.publishAt!==null&&post.value.publishAt<=Date.now())));
const sourceLocked=computed(()=>versions.value.length>1&&post.value?.locale===post.value?.sourceLocale);
const columnLocked=computed(()=>urlLocked.value||versions.value.length>1||!!translationSource.value);
const canDetach=computed(()=>versions.value.length>1&&post.value?.locale!==post.value?.sourceLocale);
const linkConflict=ref(false);

async function startTranslation(){
 const p=post.value;if(!p||busy.value||saving.value)return;
 const existing=versions.value.find(v=>v.locale===translationLanguage.value);
 if(existing){await router.push(lp(`/review/blog/${existing.id}`));return;}
 const original=versions.value.find(v=>v.locale===p.sourceLocale);
 await router.push({path:lp('/review/blog/new'),query:{translationOf:original?.id??p.id,language:translationLanguage.value}});
}
async function changeLink(detach=false){
 if(!post.value||busy.value||saving.value||uploading.value)return;
 busy.value=true;error.value='';linkConflict.value=false;
 try{
  if(dirty.value){busy.value=false;await save();busy.value=true;if(dirty.value||conflict.value||error.value)return;}
  const p=post.value!;let target:TranslationGroup|undefined;
  if(!detach){
   const result=await confirmForm({title:t('blog.admin.chooseTranslationOf'),message:t('blog.admin.translationOfHint'),confirmText:t('blog.admin.attachTranslation'),cancelText:t('blog.admin.keepTranslationLink'),field:{label:t('blog.admin.searchTranslationOf'),hint:t('blog.admin.translationCandidatesHint',{language:localeLabel(p.locale)}),lookup:async(query)=>{
    const res=await fetchTranslationGroups(await token(),{page:1,query,column:p.columnId,missingLocale:p.locale});
    candidates=res.items.filter(g=>g.id!==p.translationGroupId);return candidates.map(g=>({id:g.id,label:g.title,description:g.versions.map(v=>`${localeLabel(v.locale)} · ${t(`blog.admin.status.${displayStatus(v)}`)}`).join(' / ')}));
   }}});
   if(!result?.id)return;target=candidates.find(g=>g.id===result.id);if(!target)return;
  }
  const detail=detach?p.title:`${p.title} (${localeLabel(p.locale)}) → ${target!.title}\n${target!.versions.map(v=>`${localeLabel(v.locale)} · ${t(`blog.admin.status.${displayStatus(v)}`)}`).join(' / ')}`;
  if(!await confirmDialog({title:t(detach?'blog.admin.detachTranslationTitle':'blog.admin.attachTranslation'),message:t(detach?'blog.admin.detachTranslationHint':'blog.admin.translationLinkHint'),detail,confirmText:t(detach?'blog.admin.detachTranslation':'blog.admin.attachTranslation'),cancelText:t(detach?'blog.admin.keepAsTranslation':'blog.admin.keepTranslationLink'),focusCancel:true}))return;
  const input={expectedVersion:p.version,expectedGroupVersion:p.groupVersion??0,targetPostId:target?.versions.find(v=>v.locale===target?.sourceLocale)?.id??null,...(target?{expectedTargetGroupVersion:target.version}:{})};
  const key=`translation:${JSON.stringify(input)}`;
  const res=await changeTranslation(await token(),p.id,input,opFor(key));ops.delete(key);
  if(res.version!==p.version+1||JSON.stringify(fromPost(res))!==JSON.stringify(fromPost(p)))holdBase(p,res);else post.value=res;
  done.value=t(detach?'blog.admin.detachTranslation':'blog.admin.translationLinked');
 }catch(e){
  if(e instanceof ApiError&&/^blog_translation_/.test(e.code)){linkConflict.value=true;error.value=e.code==='blog_translation_locale_taken'?t('blog.admin.translationConflict',{language:localeLabel(draft.locale)}):t('blog.admin.translationGroupChanged');}
  else error.value=message(e);
 }finally{busy.value=false;}
}
let candidates:TranslationGroup[]=[];

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
  // 打開既有文章：網址代號還是標題建議的那個，就繼續跟著標題；手動改過的保持原樣
  slugTouched.value = p.slug !== suggestSlug(p.title);
}
function toLocalInput(ms: number) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

let loadGeneration=0;
async function load() {
  const gen=++loadGeneration;
  loading.value = true; error.value = ''; previewUrl.value = ''; opened.value = null;translationSource.value=null;
  try {
    const access = await token();
    const id = route.params.id && route.params.id !== 'new' ? String(route.params.id) : '';
    const [cols, p, revs, camps] = await Promise.all([
      fetchAdminColumns(access), id ? fetchAdminPost(access, id) : null, id ? fetchRevisions(access, id) : null, fetchCampaigns(access).catch(() => null),
    ]);
    if(gen!==loadGeneration)return;
    groups.value = cols.items;
    campaigns.value = camps?.items ?? [];
    revisions.value = revs?.items ?? [];
    if (p) apply(p);
    else {
      post.value = null;
      // 從列表的某個欄目點「新文章」會帶 ?column=；只認真的欄目（不是分組、也還存在）
      const q = route.query.column;
      const pre = typeof q === 'string' && allColumns(cols.items).some((c) => c.id === q) ? q : '';
      Object.assign(draft, empty(), { columnId: pre });
      saved.value = JSON.stringify(draft);
      const sourceId=typeof route.query.translationOf==='string'?route.query.translationOf:'';
      if(sourceId){
        const original=await fetchAdminPost(access,sourceId);
        if(gen!==loadGeneration)return;
        const language=typeof route.query.language==='string'&&POST_LOCALES.includes(route.query.language as typeof POST_LOCALES[number])?route.query.language:'en';
        const existing=original.translations?.find(v=>v.locale===language);
        if(existing){await router.replace(lp(`/review/blog/${existing.id}`));return;}
        translationSource.value=original;
        Object.assign(draft,fromPost(original),{locale:language,slug:`${original.slug.slice(0,65)}-${language.toLowerCase()}`});
      }
      slugTouched.value = !!translationSource.value;
    }
  } catch (e) { if(gen===loadGeneration)error.value = message(e, 'state.loadFailed'); } finally { if(gen===loadGeneration)loading.value = false; }
}
async function loadRevisions() {
  if (!post.value) return;
  try { revisions.value = (await fetchRevisions(await token(), post.value.id)).items; } catch { /* 側欄讀不到不擋編輯 */ }
}

// 網址代號跟著標題走：自動儲存早早就把新文章建起來，所以不能只看「還沒存過」；
// 改過網址代號、或文章發布過（網址已經對外）就不再跟
watch(() => draft.title, (title) => { if (!slugTouched.value && !urlLocked.value) draft.slug = title.trim() ? suggestSlug(title) : ''; });

/** 回應帶著別人存的內容時，只收狀態、版本號留在原處並標成衝突：下一次存檔會被擋下，不會蓋掉別人的修改。 */
function holdBase(prev: AdminPost, res: AdminPost) {
  const { status, publishAt, firstPublishedAt, pinned, commentsClosed, pinnedCommentId,wasPublic,translations,translationGroupId,groupVersion,sourceLocale } = res;
  post.value = { ...prev, status, publishAt, firstPublishedAt, pinned, commentsClosed, pinnedCommentId,wasPublic,translations,translationGroupId,groupVersion,sourceLocale };
  conflict.value = true;
}

/** 正在送的那次存檔：發布、更新要等它回來，用它存好的版本，不另外再送一次 */
let inflight: Promise<void> | null = null;
/** 頁面已經離開：在途的存檔回來後不再換網址、不再排下一次自動儲存 */
let alive = true;
function save(opts: { auto?: boolean } = {}): Promise<void> {
  if (saving.value || busy.value || uploading.value) return inflight ?? Promise.resolve();
  inflight = doSave(opts).finally(() => { inflight = null; });
  return inflight;
}
async function doSave(opts: { auto?: boolean }) {
  const input = {...toInput(draft),...(!post.value&&translationSource.value?{translationOfPostId:translationSource.value.id,expectedTranslationGroupVersion:translationSource.value.groupVersion}:{})};
  const sent = JSON.stringify(draft);
  const key = `save:${JSON.stringify(input)}`;
  saving.value = true; error.value = ''; done.value = '';
  try {
    const p = post.value;
    const res = await savePost(await token(), input, opFor(key), p?.id, p?.version, !!opts.auto);
    ops.delete(key);
    // 重送被認成同一次時，回來的可能是別人較新的版本；存檔途中我又打了字的話，不拿它當基準（見 holdBase）
    if (res.version !== (p?.version ?? 0) + 1 && JSON.stringify(draft) !== sent) holdBase(p ?? { ...res, version: 0 }, res);
    else {
      post.value = res;translationSource.value=null;
      saved.value = JSON.stringify(fromPost(res));
      // 存檔途中又打了字：留著，那些仍是沒存的修改
      if (JSON.stringify(draft) === sent) Object.assign(draft, fromPost(res));
    }
    lastSaved.value = { at: Date.now(), auto: !!opts.auto };
    saveFailed.value = false;
    if (!p && alive) await router.replace(lp(`/review/blog/${res.id}`));
    // 修訂抽屜開著才重讀：自動儲存很頻繁，沒在看就不必每次拉一份
    if (revOpen.value) void loadRevisions();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'blog_version_conflict') conflict.value = true;
    // 自動儲存遇到暫時的問題（斷線、服務忙）：頂部改成「沒存上，再試一次」。
    // 伺服器拒收（格式不對、網址代號撞名）重試也沒用：說原因，等內容改過再自動存
    else if (opts.auto && !(e instanceof ApiError && e.status < 500)) saveFailed.value = true;
    else {
      error.value = message(e);
      if (opts.auto) refusedDraft = sent;
    }
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
/** 必填沒填就不送：標紅、打開設定欄（手機）、焦點放到第一個缺的欄位 */
function checkReady(): boolean {
  if (!missing.value.length) return true;
  showMissing.value = true;
  sideOpen.value = true;
  void nextTick(() => document.getElementById(`bed-f-${missing.value[0]}`)?.focus());
  return false;
}
const closeMenu = () => menu.value?.removeAttribute('open');
/** 已公開或排程中的「更新」；也是 ⌘S */
async function update() {
  closeMenu();
  if (!checkReady()) return;
  if (inflight) await inflight;
  await save();
}
/** 發布（at 有值是定時）：還沒存過或有沒存的修改就先存，存成功才發布 */
async function publishAt(at: number | null) {
  closeMenu();
  if (!checkReady()) return;
  // 自動儲存正在送：等它回來；回來後還有沒存的修改（或根本還沒存過）就再存一次，存好才發布
  if (inflight) await inflight;
  if (!post.value || dirty.value) {
    await save();
    if (!post.value || dirty.value || conflict.value || error.value) return;
  }
  if (at) await change({ status: 'published', publishAt: at }, t('blog.admin.schedule'), t('blog.admin.scheduleConfirm', { date: `${dateTime(at)} (${zone})` }));
  else await change({ status: 'published' }, t('blog.admin.publish'), t('blog.admin.publishConfirm'));
}
const publish = () => publishAt(scheduleAt.value);
/** 「定時發布…」：打開設定欄並把焦點放到發布時間 */
function openSchedule() {
  closeMenu();
  sideOpen.value = true;
  void nextTick(() => document.getElementById('bed-f-schedule')?.focus());
}
const primary = () => (live.value ? update() : publish());
const primaryLabel = computed(() => (live.value ? t('blog.admin.update') : scheduleAt.value ? t('blog.admin.schedule') : t('blog.admin.publish')));
const unpublish = () => { closeMenu(); return change({ status: 'unpublished' }, t('blog.admin.unpublish'), t('blog.admin.unpublishConfirm'), true); };
const pin = (on: boolean) => change({ pinned: on }, t(on ? 'blog.admin.pin' : 'blog.admin.unpin'), on?`${t('blog.admin.translationPinHint',{pinnedLimit:BLOG_PINNED_LIMIT},BLOG_PINNED_LIMIT)} ${t('blog.admin.translationCarouselHint',{freshDays:BLOG_HOME_FRESH_DAYS,carouselLimit:BLOG_HOME_LIMIT},BLOG_HOME_FRESH_DAYS)}`:t('blog.admin.translationUnpinHint'));
const comments = (close: boolean) => change({ commentsClosed: close }, t(close ? 'blog.admin.closeComments' : 'blog.admin.openComments'), t(close ? 'blog.admin.closeCommentsConfirm' : 'blog.admin.openCommentsConfirm'), close);

async function makePreview() {
  if (!post.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    const res = await createPreview(await token(), post.value.id);
    previewUrl.value = `${location.origin}${lp(res.url)}`;
  } catch (e) { error.value = message(e); } finally { busy.value = false; }
}

// ---- 修訂紀錄（右側抽屜） ----

function openRevisions() {
  revOpen.value = true;
  void loadRevisions();
}

async function openRevision(r: Revision) {
  if (!post.value) return;
  try { opened.value = await fetchRevision(await token(), post.value.id, r.id); } catch (e) { error.value = message(e, 'state.loadFailed'); }
}
async function restore() {
  const r = opened.value;
  if (!post.value || !r || busy.value) return;
  if (!(await confirmDialog({ title: t('blog.admin.restore'), message: t(status.value === 'published' ? 'blog.admin.restoreConfirmLive' : 'blog.admin.restoreConfirm'), confirmText: t('blog.admin.restore'), danger: true }))) return;
  const key = `restore:${r.id}`;
  busy.value = true; error.value = ''; done.value = '';
  try {
    const res = await restoreRevision(await token(), post.value.id, r.id, opFor(key));
    ops.delete(key);
    apply(res);
    opened.value = null;
    revOpen.value = false;
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

// ---- 工具列與內文快捷鍵 ----

const imagePicker = ref<HTMLInputElement | null>(null);
function act(action: MarkdownAction) {
  if (action === 'image') { imagePicker.value?.click(); return; }
  const el = source.value;
  if (!el) return;
  const next = applyMarkdown({ value: draft.bodyMd, start: el.selectionStart, end: el.selectionEnd }, action, t('blog.admin.md.text'));
  draft.bodyMd = next.value;
  void nextTick(() => { el.focus(); el.setSelectionRange(next.start, next.end); });
}
function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = images(input.files);
  input.value = '';
  if (files.length) void insertImages(files);
}
/** 內文裡的 ⌘B／⌘I／⌘K（Windows 是 Ctrl） */
function onSourceKey(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const map: Record<string, MarkdownAction> = { b: 'bold', i: 'italic', k: 'link' };
  const action = map[e.key.toLowerCase()];
  if (!action) return;
  e.preventDefault();
  act(action);
}

// ---- 自動儲存：只對草稿與已撤下的文章，停手 AUTOSAVE_MS 後存。公開或排程中的不自動存，免得半成品直接上線 ----

const autosaves = computed(() => !translationSource.value&&(!post.value || post.value.status === 'draft' || post.value.status === 'unpublished'));
let autoTimer: ReturnType<typeof setTimeout> | undefined;
/** 伺服器拒收的那一份內容：沒改過就不再自動送 */
let refusedDraft = '';
function scheduleAutosave() {
  clearTimeout(autoTimer);
  if (!alive) return;
  // 衝突中不存：交給「載入最新版本／複製我的內容」；欄目、標題、網址沒齊也不存（新文章要齊了才建得起來）
  if (loading.value || !autosaves.value || !dirty.value || conflict.value || missing.value.length || JSON.stringify(draft) === refusedDraft) return;
  autoTimer = setTimeout(() => {
    // 手動存檔、狀態變更或圖片上傳中：晚一點再試，不搶
    if (saving.value || busy.value || uploading.value) { scheduleAutosave(); return; }
    void save({ auto: true }).finally(scheduleAutosave);
  }, AUTOSAVE_MS);
}
watch(() => JSON.stringify(draft), scheduleAutosave);
onBeforeUnmount(() => { alive = false; clearTimeout(autoTimer); });

// ---- 離開前提醒：站內換頁與關分頁都攔 ----

const ask = async () => !dirty.value || (await confirmDialog({ message: t('blog.admin.unsaved'), confirmText: t('dialog.leave'), danger: true }));
onBeforeRouteLeave(ask);
// 同一條記錄換到另一篇（或回到新文章）也要問；第一次存好換成自己的網址不問
onBeforeRouteUpdate((to) => (to.params.id === post.value?.id ? true : ask()));
const guard = (e: BeforeUnloadEvent) => { if (dirty.value) { e.preventDefault(); e.returnValue = ''; } };
/** ⌘S／Ctrl＋S 儲存（已公開的是更新）；Esc 關抽屜 */
function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void (live.value ? update() : save()); return; }
  if (e.key === 'Escape' && revOpen.value) { revOpen.value = false; return; }
  if (e.key === 'Escape' && sideOpen.value) sideOpen.value = false;
}
onMounted(() => {
  document.title = pageTitle(t('moderation.tab.blog'));
  window.addEventListener('beforeunload', guard);
  window.addEventListener('keydown', onKey);
  void load();
});
onBeforeUnmount(() => { loadGeneration++;window.removeEventListener('beforeunload', guard); window.removeEventListener('keydown', onKey); });
// 新文章第一次存好會換到它自己的網址：那一篇已經在編輯器裡，不必重讀
watch(() => [route.params.id,route.query.translationOf,route.query.language], ([id]) => { if (/\/review\/blog\/[^/]+$/.test(route.path) && (!id || id !== post.value?.id)) void load(); });
</script>

<template>
  <section class="bed" :aria-label="t('moderation.tab.blog')" :aria-busy="loading">
    <header class="bed-top">
      <RouterLink class="btn btn--sm btn--ghost" :to="lp('/review/blog')">← {{ t('blog.admin.back') }}</RouterLink>
      <span class="chip bed-status">{{ status === 'scheduled' && post?.publishAt ? t('blog.admin.scheduledFor', { date: dateTime(post.publishAt) }) : t(`blog.admin.status.${status}`) }}</span>
      <button v-if="saveFailed" type="button" class="btn btn--sm btn--ghost bed-state bed-state--failed" data-save-state @click="save()">{{ saveState }}</button>
      <span v-else class="subtle bed-state" data-save-state role="status">{{ saveState }}</span>
      <span class="bed-top__spacer" />
      <div class="seg bed-pane">
        <button type="button" class="seg__item" :class="{ 'seg__item--on': pane === 'edit' }" :aria-pressed="pane === 'edit'" @click="pane = 'edit'">{{ t('blog.admin.edit') }}</button>
        <button type="button" class="seg__item" :class="{ 'seg__item--on': pane === 'preview' }" :aria-pressed="pane === 'preview'" @click="pane = 'preview'">{{ t('blog.admin.preview') }}</button>
      </div>
      <button type="button" class="btn btn--sm bed-settings-toggle" data-action="open-settings" :aria-expanded="sideOpen" @click="sideOpen = !sideOpen">{{ t('blog.admin.openSettings') }}</button>
      <div class="bed-primary">
        <button type="button" class="btn btn--primary" data-action="primary" :disabled="saving || busy || uploading > 0 || loading" @click="primary">{{ primaryLabel }}</button>
        <details ref="menu" class="bed-menu">
          <summary class="btn btn--primary bed-menu__toggle" data-action="publish-menu" :aria-label="t('blog.admin.publishOptions')">▾</summary>
          <div class="panel bed-menu__pop" role="menu">
            <template v-if="!post || status === 'draft' || status === 'unpublished'">
              <button type="button" role="menuitem" data-action="publish-now" @click="publishAt(null)">{{ t('blog.admin.publishNow') }}</button>
              <button type="button" role="menuitem" data-action="schedule" @click="openSchedule">{{ t('blog.admin.scheduleEllipsis') }}</button>
            </template>
            <template v-else-if="status === 'scheduled'">
              <button type="button" role="menuitem" data-action="publish-now" @click="publishAt(null)">{{ t('blog.admin.publishNow') }}</button>
              <button type="button" role="menuitem" data-action="reschedule" :disabled="!scheduleAt || scheduleAt === post.publishAt" @click="publishAt(scheduleAt)">{{ t('blog.admin.reschedule') }}</button>
              <button type="button" role="menuitem" data-action="cancel-schedule" @click="unpublish">{{ t('blog.admin.cancelSchedule') }}</button>
            </template>
            <button v-else type="button" role="menuitem" data-action="unpublish" @click="unpublish">{{ t('blog.admin.unpublish') }}</button>
          </div>
        </details>
      </div>
    </header>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <p v-if="done && !error" class="notice" role="status">{{ done }}</p>
    <div v-if="conflict" class="notice notice--error bed-conflict" role="alert" data-conflict>
      <span>{{ t('blog.admin.conflict') }}</span>
      <span class="bed-conflict__actions">
        <button type="button" class="btn btn--sm" data-action="load-latest" :disabled="busy" @click="loadLatest">{{ t('blog.admin.loadLatest') }}</button>
        <button type="button" class="btn btn--sm" data-action="copy-mine" @click="copy(draft.bodyMd, 'blog.admin.copied')">{{ t('blog.admin.copyMine') }}</button>
      </span>
    </div>
    <button v-if="linkConflict" type="button" class="btn btn--sm" @click="changeLink()">{{ t('blog.admin.reselectTranslationOf') }}</button>
    <p v-if="translationSource" class="notice">{{ t('blog.admin.translationDraftHint') }}</p>
    <p v-if="!loading && !columns.length" class="notice">{{ t('blog.admin.needColumn') }}</p>

    <div class="bed-body">
      <div class="bed-main">
        <template v-if="loading">
          <div class="ghost bed-ghost--title" />
          <div class="ghost bed-ghost--body" />
        </template>
        <template v-else>
          <input id="bed-f-title" v-model="draft.title" class="bed-title" maxlength="120" :placeholder="t('blog.admin.postTitle')" :aria-label="t('blog.admin.postTitle')" :aria-invalid="isMissing('title') || undefined" />
          <MarkdownToolbar v-show="pane === 'edit'" :disabled="uploading > 0" @act="act" />
          <input ref="imagePicker" type="file" accept="image/*" multiple class="bed-file" tabindex="-1" aria-hidden="true" @change="onPick" />
          <div class="bed-split" :class="`bed-split--${pane}`">
            <textarea autocomplete="off" ref="source" v-model="draft.bodyMd" class="input bed-source" data-source spellcheck="false" maxlength="60000" :aria-label="t('blog.admin.body')"
                      @paste="onPaste" @drop="onDrop" @dragover.prevent @keydown="onSourceKey" />
            <!-- renderDoc 不吃 HTML（html:false），跟文章頁同一份渲染 -->
            <article class="bed-preview" :aria-label="t('blog.admin.preview')" v-html="rendered" />
          </div>
        </template>
      </div>

      <div v-if="sideOpen" class="bed-scrim" @click="sideOpen = false" />
      <aside class="panel bed-side" :class="{ 'bed-side--open': sideOpen }" :aria-label="t('blog.admin.openSettings')">
        <div class="bed-side__head">
          <h2>{{ t('blog.admin.openSettings') }}</h2>
          <button type="button" class="btn btn--sm btn--ghost bed-side__close" @click="sideOpen = false">{{ t('blog.admin.close') }}</button>
        </div>
        <label class="field" :class="{ 'field--invalid': isMissing('columnId') }">
          <span>{{ t('blog.admin.column') }} <small class="subtle">{{ t('blog.admin.required') }}</small></span>
          <select id="bed-f-columnId" v-model="draft.columnId" :disabled="columnLocked" class="input" :aria-invalid="isMissing('columnId') || undefined">
            <option value="" disabled>{{ t('blog.admin.column') }}</option>
            <optgroup v-for="g in groups" :key="g.id" :label="columnName(g, String(locale))">
              <option v-for="c in g.columns" :key="c.id" :value="c.id">{{ columnName(c, String(locale)) }}{{ c.enabled && g.enabled ? '' : ` (${t('blog.admin.hidden')})` }}</option>
            </optgroup>
          </select>
        </label>
        <label v-if="!live || status === 'scheduled'" class="field">
          <span>{{ t('blog.admin.scheduleAt', { zone }) }}</span>
          <input id="bed-f-schedule" v-model="schedule" class="input" type="datetime-local" />
          <span class="subtle">{{ t('blog.admin.scheduleHint') }}</span>
        </label>
        <label class="field" :class="{ 'field--invalid': isMissing('slug') }">
          <span>{{ t('blog.admin.slug') }} <small class="subtle">{{ t('blog.admin.required') }}</small></span>
          <input id="bed-f-slug" v-model="draft.slug" :disabled="urlLocked" class="input" maxlength="80" pattern="[a-z0-9][a-z0-9\-]*" autocapitalize="off" spellcheck="false" :aria-invalid="isMissing('slug') || undefined" @input="slugTouched = true" />
          <span class="subtle">{{ t('blog.admin.slugHint') }}</span>
        </label>
        <label class="field">
          <span>{{ t('blog.admin.locale') }}</span>
          <select v-model="draft.locale" class="input" :disabled="urlLocked || sourceLocked || !!translationSource">
            <option v-for="l in POST_LOCALES" :key="l" :value="l">{{ localeLabel(l) }}</option>
          </select>
        </label>
        <p v-if="urlLocked" class="subtle">{{ t('blog.admin.permalinkLocked') }}</p>
        <p v-else-if="sourceLocked" class="subtle">{{ t('blog.admin.sourceLanguageLocked') }}</p>
        <p v-if="columnLocked && !urlLocked" class="subtle">{{ t('blog.admin.translationColumnHint') }}</p>
        <details v-if="post" class="bed-versions" open>
          <summary>{{ t('blog.admin.languageVersions') }}</summary>
          <p class="subtle">{{ t('blog.admin.translationPublishHint') }}</p>
          <nav :aria-label="t('blog.admin.languageVersions')" class="bed-version-list">
            <RouterLink v-for="v in versions" :key="v.id" :to="lp(`/review/blog/${v.id}`)" class="btn btn--sm" :aria-current="v.id===post.id?'page':undefined">{{ localeLabel(v.locale) }} · {{ t(`blog.admin.status.${displayStatus(v)}`) }}<span v-if="v.locale===post.sourceLocale"> · {{ t('blog.admin.sourceVersion') }}</span></RouterLink>
          </nav>
          <label class="field"><span>{{ t('blog.admin.translationLanguage') }}</span><select v-model="translationLanguage" class="input"><option v-for="l in POST_LOCALES" :key="l" :value="l">{{ localeLabel(l) }}</option></select></label>
          <p v-if="versions.some(v=>v.locale===translationLanguage)" class="subtle">{{ t('blog.admin.translationExists',{language:localeLabel(translationLanguage)}) }}</p>
          <button type="button" class="btn btn--sm" data-action="new-translation" :disabled="busy || saving" @click="startTranslation">{{ t(versions.some(v=>v.locale===translationLanguage)?'blog.admin.openTranslation':'blog.admin.startTranslation') }}</button>
          <details><summary>{{ t('blog.admin.translationOf') }}</summary><p class="subtle">{{ t('blog.admin.translationOfHint') }}</p>
            <button type="button" class="btn btn--sm" :disabled="busy || saving || sourceLocked" @click="changeLink()">{{ t('blog.admin.chooseTranslationOf') }}</button>
            <button v-if="canDetach" type="button" class="btn btn--sm btn--ghost" :disabled="busy || saving" @click="changeLink(true)">{{ t('blog.admin.detachTranslation') }}</button>
          </details>
        </details>
        <label class="field">
          <span>{{ t('blog.admin.excerpt') }} <small class="subtle">{{ draft.excerpt.length }}/300</small></span>
          <textarea autocomplete="off" v-model="draft.excerpt" class="input" rows="3" maxlength="300" />
        </label>
        <div class="field">
          <span class="bed-label">{{ t('blog.admin.cover') }}</span>
          <img v-if="draft.coverKey" class="bed-cover" :src="imageUrlOf(draft.coverKey)!" alt="" />
          <span class="bed-row">
            <label class="btn btn--sm">{{ t('blog.admin.upload') }}<input type="file" accept="image/*" class="bed-file" :disabled="busy" @change="uploadCover($event, 'coverKey')" /></label>
            <button v-if="draft.coverKey" type="button" class="btn btn--sm btn--ghost" @click="draft.coverKey = null">{{ t('blog.admin.removeImage') }}</button>
          </span>
        </div>

        <details v-if="post" class="bed-fold">
          <summary>{{ t('blog.admin.settings') }}</summary>
          <div class="bed-row">
            <button type="button" class="btn btn--sm" data-action="pin" :disabled="busy || saving" @click="pin(!post.pinned)">{{ post.pinned ? t('blog.admin.unpin') : t('blog.admin.pin') }}</button>
            <button type="button" class="btn btn--sm" data-action="comments" :disabled="busy || saving" @click="comments(!post.commentsClosed)">{{ post.commentsClosed ? t('blog.admin.openComments') : t('blog.admin.closeComments') }}</button>
          </div>
        </details>
        <details class="bed-fold">
          <summary>{{ t('blog.admin.share') }}</summary>
          <label class="field">
            <span>{{ t('blog.admin.shareTitle') }}</span>
            <input v-model="draft.shareTitle" class="input" maxlength="120" :placeholder="draft.title" />
          </label>
          <label class="field">
            <span>{{ t('blog.admin.shareDescription') }}</span>
            <textarea autocomplete="off" v-model="draft.shareDescription" class="input" rows="2" maxlength="300" :placeholder="draft.excerpt" />
          </label>
          <div class="field">
            <span class="bed-label">{{ t('blog.admin.shareCover') }}</span>
            <img v-if="draft.shareCoverKey" class="bed-cover" :src="imageUrlOf(draft.shareCoverKey)!" alt="" />
            <span class="bed-row">
              <label class="btn btn--sm">{{ t('blog.admin.upload') }}<input type="file" accept="image/*" class="bed-file" :disabled="busy" @change="uploadCover($event, 'shareCoverKey')" /></label>
              <button v-if="draft.shareCoverKey" type="button" class="btn btn--sm btn--ghost" @click="draft.shareCoverKey = null">{{ t('blog.admin.removeImage') }}</button>
            </span>
          </div>
        </details>
        <details class="bed-fold">
          <summary>{{ t('blog.admin.campaign') }}</summary>
          <label class="field">
            <span class="sr-only">{{ t('blog.admin.campaign') }}</span>
            <select v-model="draft.campaignId" class="input" data-field="campaign">
              <option value="">{{ t('blog.admin.noCampaign') }}</option>
              <option v-for="c in campaigns" :key="c.id" :value="c.id">{{ campaignLabel(c) }}</option>
              <option v-if="draft.campaignId && !campaigns.some((c) => c.id === draft.campaignId)" :value="draft.campaignId">{{ draft.campaignId }}</option>
            </select>
          </label>
        </details>
        <details v-if="post" class="bed-fold">
          <summary>{{ t('blog.admin.previewLink') }}</summary>
          <button type="button" class="btn btn--sm" :disabled="busy" @click="makePreview">{{ t('blog.admin.makePreview') }}</button>
          <template v-if="previewUrl">
            <code class="bed-link">{{ previewUrl }}</code>
            <button type="button" class="btn btn--sm" @click="copy(previewUrl, 'blog.copied')">{{ t('blog.copyLink') }}</button>
          </template>
        </details>
        <button v-if="post" type="button" class="btn btn--sm btn--ghost bed-revs-open" data-action="open-revisions" @click="openRevisions">{{ t('blog.admin.revisions') }} →</button>
      </aside>
    </div>

    <Teleport to="body">
      <div v-if="revOpen" class="bed-drawer-backdrop" @click.self="revOpen = false">
        <section class="panel bed-drawer" role="dialog" aria-modal="true" :aria-label="t('blog.admin.revisions')">
          <div class="bed-side__head">
            <h2>{{ t('blog.admin.revisions') }}</h2>
            <button type="button" class="btn btn--sm btn--ghost" @click="revOpen = false">{{ t('blog.admin.close') }}</button>
          </div>
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
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.bed-versions { display:grid;gap:var(--s-2);min-width:0; }
.bed-version-list { display:flex;flex-wrap:wrap;gap:var(--s-2);margin-block:var(--s-2); }
.bed-version-list .btn { white-space:normal;text-align:start;overflow-wrap:anywhere;max-width:100%;height:auto;min-height:var(--h-sm); }
.bed { display: grid; gap: var(--s-3); min-width: 0; }
.bed-top { position: sticky; top: var(--header-h); z-index: 20; display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; padding: var(--s-2) 0; background: var(--bg); }
.bed-top__spacer { flex: 1; }
.bed-status { cursor: default; }
.bed-state { font-size: 13px; }
.bed-state--failed { color: var(--danger); }
.bed-pane { flex: none; }
.bed-settings-toggle { display: none; }
.bed-primary { display: inline-flex; position: relative; }
.bed-primary > .btn { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.bed-menu { position: relative; }
.bed-menu__toggle { list-style: none; border-top-left-radius: 0; border-bottom-left-radius: 0; padding: 0 10px; margin-left: 1px; cursor: pointer; }
.bed-menu__toggle::-webkit-details-marker { display: none; }
.bed-menu__pop { position: absolute; right: 0; top: calc(100% + 4px); z-index: 40; display: grid; min-width: 180px; padding: var(--s-1); }
.bed-menu__pop button { min-height: 40px; padding: 0 var(--s-3); border: 0; border-radius: var(--r-sm); background: transparent; color: var(--text); font: inherit; font-size: 14px; text-align: start; cursor: pointer; }
.bed-menu__pop button:hover:not(:disabled) { background: var(--surface-2); }
.bed-menu__pop button:disabled { color: var(--text-3); cursor: default; }
.bed-conflict { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; justify-content: space-between; }
.bed-conflict__actions { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.bed-body { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: var(--s-5); align-items: start; }
.bed-main { display: grid; gap: var(--s-3); min-width: 0; }
.bed-ghost--title { height: 48px; }
.bed-ghost--body { height: 420px; }
.bed-title { width: 100%; padding: var(--s-2) 0; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--text); font: inherit; font-size: 28px; font-weight: 700; line-height: 1.3; outline: none; }
.bed-title:focus { border-bottom-color: var(--accent); }
.bed-title[aria-invalid='true'] { border-bottom-color: var(--danger); }
.bed-split { display: grid; min-height: 60vh; }
.bed-split--edit .bed-preview, .bed-split--preview .bed-source { display: none; }
.bed-source { width: 100%; height: auto; min-height: 60vh; padding: var(--s-3) var(--s-4); resize: vertical; font: 15px/1.75 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.bed-preview { padding: var(--s-2) 0; min-width: 0; font-size: 16px; line-height: 1.8; overflow-wrap: anywhere; }
.bed-preview :deep(h1), .bed-preview :deep(h2) { font-size: 22px; margin: var(--s-5) 0 var(--s-3); }
.bed-preview :deep(h3) { font-size: 18px; margin: var(--s-4) 0 var(--s-2); }
.bed-preview :deep(:first-child) { margin-top: 0; }
.bed-preview :deep(p), .bed-preview :deep(ul), .bed-preview :deep(ol), .bed-preview :deep(blockquote), .bed-preview :deep(pre), .bed-preview :deep(table) { margin: 0 0 var(--s-3); }
.bed-preview :deep(ul), .bed-preview :deep(ol) { padding-left: 1.4em; }
.bed-preview :deep(a) { color: var(--accent-text); text-decoration: underline; }
.bed-preview :deep(img) { display: block; max-width: 100%; height: auto; border-radius: var(--r-md); }
.bed-preview :deep(code) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; padding: 1px 6px; border-radius: 5px; background: var(--surface-2); }
.bed-preview :deep(pre) { padding: var(--s-3); overflow-x: auto; border-radius: var(--r-sm); background: var(--surface-2); }
.bed-preview :deep(pre code) { padding: 0; background: none; }
.bed-preview :deep(blockquote) { padding: var(--s-2) var(--s-3); border-left: 3px solid var(--accent); background: var(--accent-tint); color: var(--text-2); }
.bed-preview :deep(table) { border-collapse: collapse; }
.bed-preview :deep(th), .bed-preview :deep(td) { padding: 6px 10px; border: 1px solid var(--line); }
.bed-side { position: sticky; top: calc(var(--header-h) + 64px); display: grid; gap: var(--s-4); padding: var(--s-4); max-height: calc(100vh - var(--header-h) - 80px); overflow-y: auto; min-width: 0; }
.bed-side__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); }
.bed-side__head h2 { font-size: 16px; margin: 0; }
.bed-side__close { display: none; }
.bed-side .field { display: grid; gap: 6px; }
.bed-side .field > span:first-child, .bed-label { font-size: 13px; font-weight: 600; }
.bed-side .input { width: 100%; }
.bed-side textarea.input { height: auto; padding: 8px 12px; line-height: 1.6; resize: vertical; }
.field--invalid .input { border-color: var(--danger); }
.bed-fold { display: grid; gap: var(--s-3); border-top: 1px solid var(--line); padding-top: var(--s-3); }
.bed-fold summary { font-size: 13px; font-weight: 600; cursor: pointer; }
.bed-row { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.bed-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.bed-row .btn { position: relative; cursor: pointer; }
.bed-cover { display: block; max-width: 100%; max-height: 160px; border-radius: var(--r-sm); object-fit: cover; }
.bed-link { display: block; padding: 10px 12px; border-radius: var(--r-sm); background: var(--surface-2); font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; user-select: all; }
.bed-revs-open { justify-self: start; }
.bed-scrim { display: none; }
.bed-drawer-backdrop { position: fixed; inset: 0; z-index: 90; display: flex; justify-content: flex-end; background: rgba(0, 0, 0, 0.32); }
.bed-drawer { width: min(440px, 100%); height: 100%; border-radius: 0; display: grid; align-content: start; gap: var(--s-3); padding: var(--s-4); overflow-y: auto; }
.bed-revs { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-1); }
.bed-rev { display: grid; gap: 2px; width: 100%; padding: var(--s-2) var(--s-3); border: 0; border-radius: var(--r-sm); background: transparent; color: var(--text); text-align: start; font: inherit; font-size: 13px; cursor: pointer; }
.bed-rev:hover, .bed-rev--on { background: var(--surface-2); }
.bed-rev__title { font-weight: 600; overflow-wrap: anywhere; }
.bed-opened { display: grid; gap: var(--s-2); padding-top: var(--s-2); border-top: 1px solid var(--line); }
.bed-opened h3 { font-size: 15px; }
.bed-opened > .btn { justify-self: start; }
.bed-preview--rev { padding: 0; font-size: 14px; }
@media (max-width: 899px) {
  .bed-body { grid-template-columns: minmax(0, 1fr); }
  .bed-settings-toggle { display: inline-flex; }
  .bed-side { position: fixed; left: 0; right: 0; bottom: 0; top: auto; z-index: 85; max-height: 80vh; border-radius: 24px 24px 0 0; padding-bottom: calc(var(--s-4) + env(safe-area-inset-bottom)); transform: translateY(100%); visibility: hidden; transition: transform var(--dur) var(--ease), visibility var(--dur); }
  .bed-side--open { transform: none; visibility: visible; }
  .bed-side__close { display: inline-flex; }
  .bed-scrim { display: block; position: fixed; inset: 0; z-index: 84; background: rgba(0, 0, 0, 0.32); }
}
@media (max-width: 760px) {
  .bed-top { gap: var(--s-1); }
  .bed-pane { order: 10; width: 100%; }
  .bed-title { font-size: 22px; }
  .bed .btn, .bed .input:not(textarea) { min-height: 44px; }
}
</style>
