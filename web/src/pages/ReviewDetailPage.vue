<script setup lang="ts">
/**
 * /review/:id — 一張待審卡的唯讀審核頁。
 *
 * 看的是原始碼，不是渲染後的卡（owner 2026-09-07）：人設、開場白、世界書條目（含停用的）、
 * 正規表示式規則與常駐區塊的原文，外加成本側寫。要看效果按「試玩」開遊玩頁。
 * 分區沿用編輯頁的分法（基本／人設／對話／世界書），只是每一格都是唯讀。不顯示作者。
 *
 * 審核工具第一批（2026-11-02 體檢 R1–R5、R2）：
 *   - 直接開連結撞到「請先領取」時自動再領一次，真的被別人領走才說明。
 *   - 分頁條黏在頁首下方，低頻的兩格收進「更多」；手機底部固定「前往決定」，桌機右側欄放字數與入口。
 *   - 字數未達標時「通過」不能按（伺服器同樣拒絕）；常用理由一點就接到說明後面，不蓋掉已打的字。
 *   - 送出後決定區換成結果卡（我的決定、目前結果、下一張），重新整理或回頭看也是同一張。
 */
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import {formatReviewLength} from "@/lib/review-length";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, claimReview, fetchReviewDetail, fetchReviewOriginality, fetchReviewQueue, type ReviewQueueItem, releaseReview, stampReview, holdReview, unholdReview, withdrawReopen, correctReviewDecision, updateReviewTags, type ReviewDetail, type ReviewOriginality } from "@/lib/api";
import { confirmDialog, confirmState, settleConfirm } from '@/lib/confirm';
import TagPicker from "@/components/editor/TagPicker.vue";
import LookupField, { type LookupValue } from "@/components/LookupField.vue";
import { fetchFandomLookup } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { pageTitle } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { readTags, readTalkExample } from "@/lib/role-draft";
import RatingMark from "@/components/RatingMark.vue";
import ReviewAuthorPanel from '@/components/ReviewAuthorPanel.vue';
import { submissionTypeKey, submissionTypeOf } from '@/lib/review-type';
import ReviewLengthExemptionControl from '@/components/ReviewLengthExemptionControl.vue';
import { ratingLocale } from "@/lib/rating";
import { RATING_OTHER, RATING_TOPICS } from "../../../shared/content-rating";
import { OPENING_ALLOW, OPENING_SANDBOX, createFrameSizer, openingSrcdoc, parseOpeningMessage } from "stage-common/opening-page";
import { openingModeOf, ruleSetFromAuthorAsset } from "@/lib/regex-rules";

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const { lp } = useLocalePath();
const session = useSession();

const id = computed(() => String(route.params.id || ""));
const data = ref<ReviewDetail | null>(null);
const lengthParams = computed(()=>data.value?.detail.reviewLength?formatReviewLength(data.value.detail.reviewLength,String(locale.value)):{});
const loading = ref(true);
const error = ref("");
const needsClaim = ref(false);
/** 自動再領沒成功、被別人領著時的說明（這時不給領取鈕，只給回清單） */
const claimNote = ref("");
let autoClaimed = false;
const done = ref("");
const busy = ref(false);
const note = ref("");
const correctionNote=ref('');
const correctionOpen=ref(false);
const correctionError=ref('');
const correctionErrorNotice=ref<HTMLElement|null>(null);
let active=true;
let loadSequence=0;
let ownedConfirm:typeof confirmState.current=null;
const cancelOwnedConfirm=()=>{if(ownedConfirm&&confirmState.current===ownedConfirm)settleConfirm(false);ownedConfirm=null;};
onBeforeUnmount(()=>{active=false;cancelOwnedConfirm();});
// 「下一張待審」在同一個頁面實例裡換卡：上一張的查重結果、標籤草稿都要清掉，不然會帶到下一張（甚至存進下一張）
watch(id,()=>{cancelOwnedConfirm();data.value=null;note.value='';blockedNote.value=null;done.value='';originality.value=null;originalityError.value='';picked.value=null;editingTags.value=false;draftTags.value=[];tagsError.value='';correctionOpen.value=false;correctionNote.value='';claimNote.value='';holdReason.value='';holdReasonOpen.value=false;holdError.value='';withdrawOpen.value=false;withdrawReason.value='';withdrawError.value='';autoClaimed=false;decideError.value='';decideUnknown.value=false;nextItems.value=null;nextError.value='';section.value='basic';void load();});
async function decisionConfirm(options:Parameters<typeof confirmDialog>[0]){
 const answer=confirmDialog(options);ownedConfirm=confirmState.current;
 try{return await answer;}finally{ownedConfirm=null;}
}
function summary(name:string,submittedAt:number,verdict:string,reason:string,reasonKey='review.confirm.note'){
 const row=(label:string,value:string)=>t('review.confirm.row',{label,value});
 return [row(t('review.confirm.card'),name),row(t('review.confirm.version'),dateTime(submittedAt)),row(t('review.confirm.decision'),verdict),row(t(reasonKey),reason||t('review.confirm.noNote'))].join('\n');
}
const section = ref<"basic" | "rating" | "persona" | "originality" | "dialogue" | "worldbook" | "display" | "cost">("basic");
const SECTIONS = ["basic", "rating", "persona", "originality", "dialogue", "worldbook", "display", "cost"] as const;
const REVIEW_SECTIONS: readonly string[] = ["rating", "originality", "display", "cost"];

function revealFocusedTab(event: FocusEvent) {
  const tab = event.currentTarget as HTMLElement;
  // 原生 focus 捲動完成後再揭露整個項目；聚焦不會切換正在閱讀的分頁。
  requestAnimationFrame(() => {
    if (document.activeElement === tab) tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

/**
 * 作者的分級問卷（owner 2026-10-10）：審核人看一眼答案，對照內容是不是他說的那樣。
 * 每一類列出作者選的那一項與它對應的級別；沒勾的類型也列出來，審核人才看得出「他說沒有」。
 */
const ratingLang = computed(() => ratingLocale(String(locale.value)));
const ratingRows = computed(() => {
  const a = data.value?.submission.ratingAnswers;
  if (!a) return [];
  return RATING_TOPICS.map((topic) => {
    const opt = topic.options.find((o) => o.id === a.topics[topic.id]);
    return { id: topic.id, title: topic.title[ratingLang.value], answer: opt?.text[ratingLang.value] ?? null, rating: opt?.rating ?? null };
  });
});
const ratingOther = computed(() => {
  const a = data.value?.submission.ratingAnswers;
  const opt = a ? RATING_OTHER.options.find((o) => o.id === a.other) : undefined;
  return opt ? { text: opt.text[ratingLang.value], rating: opt.rating } : null;
});

// 查重只給審核人參考，不替審核人下結論；分開載入，查重慢或失敗都不擋審核頁。
const originality = ref<ReviewOriginality | null>(null);
const originalityError = ref("");
/** 只看某一張來源的重複段落；null＝全部來源 */
const picked = ref<string | null>(null);
const percent = (x: number) => `${Math.round(x * 100)}%`;
const marked = computed(() => {
  const text = doc.value?.roleDetailDesc ?? "";
  const r = originality.value;
  if (!r?.available) return [{ text, hit: false }];
  const segs = picked.value ? r.sources.find((x) => x.cardId === picked.value)?.segments ?? [] : r.segments;
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of segs) {
    if (a > at) out.push({ text: text.slice(at, a), hit: false });
    out.push({ text: text.slice(a, b), hit: true });
    at = b;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
});
const sectionLabel = (s: (typeof SECTIONS)[number]) => {
  const label = REVIEW_SECTIONS.includes(s) ? t(`review.section.${s}`) : t(`editor.section.${s}`);
  return s === "originality" && originality.value?.available ? `${label} · ${percent(originality.value.similarity)}` : label;
};

async function loadOriginality() {
  const target = id.value;
  originalityError.value = "";
  try {
    const report = await fetchReviewOriginality(target, await token());
    if (target === id.value) originality.value = report;
  } catch (err) {
    if (target === id.value) originalityError.value = err instanceof Error ? err.message : t("state.loadFailed");
  }
}

const doc = computed(() => data.value?.detail.document);
const isOpeningPage = computed(() => {
  const asset = data.value?.detail.authorAsset;
  return !!asset && openingModeOf(ruleSetFromAuthorAsset(asset)) === "page";
});
const openingPage = computed(() => data.value?.detail.authorAsset.openingPage ?? "");
const openingDoc = computed(() => openingSrcdoc(openingPage.value));
const openingFrame = ref<HTMLIFrameElement | null>(null);
// 跟遊玩頁同一套高度規則：框有上限，內容在框裡捲。照視窗寫的頁面（min-height:100vh、position:fixed）回報的高度
// 會跟著框長，照回報撐開的話整頁會被拉到幾萬像素。審核頁沒有輸入列，上限取視窗高的八成，上下文仍看得到。
const openingCap = () => Math.round(window.innerHeight * 0.8);
let openingSizer = createFrameSizer(openingCap());
const openingFrameHeight = ref(openingSizer.height);
watch(openingPage, () => { openingSizer = createFrameSizer(openingCap()); openingFrameHeight.value = openingSizer.height; });
function onOpeningMessage(event: MessageEvent) {
  if (!openingFrame.value || event.source !== openingFrame.value.contentWindow) return;
  const message = parseOpeningMessage(event.data);
  if (message?.kind === "height") openingFrameHeight.value = openingSizer.report(message.height);
}
onMounted(() => window.addEventListener("message", onOpeningMessage));
onBeforeUnmount(() => window.removeEventListener("message", onOpeningMessage));
// 對話示例入庫是一串 JSON，作者在編輯頁看到的是一輪一輪的「誰說、說什麼」；審核頁照編輯頁的樣子畫，不倒原始字串。
const talkTurns = computed(() => readTalkExample(doc.value?.talkExample));
const claimedByMe = computed(() => !!data.value?.submission.claimedByMe);
const stampedByMe = computed(() => !!data.value?.submission.stampedByMe);
/** 作者送審時勾的標籤。 */
const authorTags = computed(() => readTags(doc.value?.roleTag));
/** 這一版過審後會上榜的標籤：審核人改過就是改過的那份。 */
const tags = computed(() => data.value?.card.tags ?? authorTags.value);
const tagsChanged = computed(() => JSON.stringify(tags.value) !== JSON.stringify(authorTags.value));
/** 這一版過審後會上的原作：作者宣告的，審核人改過就是改過的那個 */
const fandom = computed(() => data.value?.card.fandom ?? "");
const draftFandom = ref<LookupValue>({ label: "" });

/**
 * 審核時直接改標籤：作者少勾、勾錯不值得退件，領著單的審核人改對再過審。只改這一次送審的版本。
 * 分類目錄裡的籤用點的；作者自己打的、目錄裡沒有的籤可以拿掉。
 */
const TAGS_MAX = 20;
const editingTags = ref(false);
const draftTags = ref<string[]>([]);
const tagsBusy = ref(false);
const tagsError = ref("");
function editTags() {
  draftTags.value = [...tags.value];
  draftFandom.value = { label: fandom.value, ...(data.value?.card.fandomId ? { id: data.value.card.fandomId } : {}) };
  tagsError.value = "";
  editingTags.value = true;
}
function toggleDraftTag(name: string) {
  draftTags.value = draftTags.value.includes(name) ? draftTags.value.filter((x) => x !== name) : [...draftTags.value, name];
}
async function saveTags() {
  if (!data.value) return;
  tagsBusy.value = true;
  tagsError.value = "";
  try {
    const res = await updateReviewTags(id.value, await token(), { tags: draftTags.value, fandom: draftFandom.value.label.trim(), ...(draftFandom.value.id ? { fandomId: draftFandom.value.id } : {}), generation: data.value.submission.claimGeneration });
    data.value.card.tags = res.tags;
    data.value.card.fandom = res.fandom ?? draftFandom.value.label.trim();
    data.value.card.fandomId = res.fandomId;
    editingTags.value = false;
  } catch (err) {
    tagsError.value = err instanceof ApiError && err.status === 409 ? t("review.claimChanged") : t("review.tags.failed");
  } finally {
    tagsBusy.value = false;
  }
}
const decided = computed(() => !!data.value && data.value.submission.status !== "pending");

/** 字數：伺服器算的那一份；partial（同步開的重審單）沒有，就是「無法計算」，不當成達標也不當成未達標 */
const length = computed(() => (data.value?.detail.partial ? null : data.value?.detail.reviewLength ?? null));
// 重新審核的「維持通過」不看字數門檻：卡已經發布，伺服器也不擋
const approveBlocked = computed(() => !data.value?.submission.reopen && !data.value?.submission.lengthExempt && !!length.value && !length.value.eligible);
const approvals = computed(() => data.value?.submission.stamps.filter((s) => s.verdict === "approve").length ?? 0);
/** 冷凍並討論：有人把這張卡擋下來了，解凍前誰都不能通過或駁回（伺服器也擋） */
const hold = computed(() => (decided.value ? null : data.value?.submission.hold ?? null));
const canDecide = computed(() => claimedByMe.value && !stampedByMe.value && !decided.value && !hold.value);
const canHold = computed(() => claimedByMe.value && !stampedByMe.value && !decided.value && !hold.value);
const holdBusy = ref(false);
const holdError = ref("");
/** 管理員解別人的冷凍：先按解凍才展開理由欄 */
const holdReasonOpen = ref(false);
const holdReason = ref("");
/** 重新審核：已發布的卡回到待審。維持通過任一審核員；駁回與撤銷限管理員 */
const reopen = computed(() => !!data.value?.submission.reopen);
const submissionType = computed(() => (data.value ? submissionTypeOf({ ...data.value.submission, reopen: reopen.value }) : "first"));
const manager = computed(() => !!data.value?.submission.manager);
const rejectLocked = computed(() => reopen.value && !manager.value);
const withdrawOpen = ref(false);
const withdrawReason = ref("");
const withdrawError = ref("");
const myStamp = computed(() => data.value?.submission.stamps.find((s) => s.mine) ?? null);
/** 別人蓋的章（現行一張單一章就定案，通常是空的；舊單或日後恢復兩章時才有） */
const otherStamps = computed(() => data.value?.submission.stamps.filter((s) => !s.mine) ?? []);

const REASONS = ["count", "setting", "opening", "rating", "other"] as const;
type Reason = (typeof REASONS)[number];
/** 「有效字數不足」只在真的未達標時出現 */
const reasons = computed(() => REASONS.filter((r) => r !== "count" || approveBlocked.value));
const noteField = ref<HTMLTextAreaElement | null>(null);
const noteFocused = ref(false);
/** 說明上限（與伺服器 REVIEW_NOTE_MAX 同一個數）。輸入框的 maxlength 只擋打字，理由 chip 是程式填入，要自己擋 */
const NOTE_MAX = 2000;
/** 點的理由放不下：不追加、不截斷，改說明一句；說明欄一改動（刪減後）就收起 */
const blockedNote = ref<string | null>(null);
const noteFull = computed(() => blockedNote.value !== null && blockedNote.value === note.value);
function pickReason(reason: Reason) {
  if (reason !== "other") {
    const text = reason === "count"
      ? t("review.reason.count.text", { total: lengthParams.value.total, gap: lengthParams.value.remaining, required: lengthParams.value.required })
      : t(`review.reason.${reason}.text`);
    // 已經打了字就另起一行接在後面，不覆蓋、不詢問
    const typed = note.value.replace(/\s+$/, "");
    const next = typed ? `${typed}\n${text}` : text;
    if (next.trim().length > NOTE_MAX) { blockedNote.value = note.value; noteField.value?.focus(); return; }
    note.value = next;
  }
  noteField.value?.focus();
}

const decideError = ref("");
/** 送出後不知道有沒有成功（連線中斷）：不叫人直接重按，先去「我處理過的」看 */
const decideUnknown = ref(false);
const decideErrorEl = ref<HTMLElement | null>(null);
const decideSection = ref<HTMLElement | null>(null);
/** 決定區已經在畫面裡：手機底部列收起，免得「前往決定」疊在「通過」下面 */
const decideVisible = ref(false);
let decideObserver: IntersectionObserver | null = null;
watch(decideSection, (el) => {
  decideObserver?.disconnect();
  decideVisible.value = false;
  if (!el || typeof IntersectionObserver === "undefined") return;
  decideObserver = new IntersectionObserver((entries) => { decideVisible.value = entries.some((e) => e.isIntersecting); });
  decideObserver.observe(el);
});
onBeforeUnmount(() => decideObserver?.disconnect());
const tabsBar = ref<HTMLElement | null>(null);
function goDecide() {
  decideSection.value?.scrollIntoView({ block: "start" });
  decideSection.value?.querySelector<HTMLElement>("[data-decide-title]")?.focus({ preventScroll: true });
}
/** 回到讀卡：捲到內容區開頭（分頁條是黏著的，對它本身捲動沒有作用）；已打的說明留著 */
function backToRead() { tabsBar.value?.parentElement?.scrollIntoView({ block: "start" }); }

/** 結果卡的「下一張待審」：跟清單同樣的順序，我領著的在前，再來是沒人領的 */
const nextItems = ref<ReviewQueueItem[] | null>(null);
const nextError = ref("");
const nextBusy = ref(false);
async function loadNext() {
  try {
    const q = await fetchReviewQueue(await token(), String(locale.value));
    // 冷凍中的卡不能決定，「下一張」不帶人過去
    const open = q.items.filter((i) => i.id !== id.value && !i.stampedByMe && !i.hold && !skipped.has(i.id));
    nextItems.value = [...open.filter((i) => i.claim === "mine"), ...open.filter((i) => i.claim === "free")];
  } catch { nextItems.value = null; }
}
/** 這次領不到、而且再試也領不到的卡（要先確認年齡）：「下一張」跳過它們 */
const skipped = new Set<string>();
async function goNext() {
  const item = nextItems.value?.[0];
  if (!item || nextBusy.value) return;
  nextBusy.value = true; nextError.value = "";
  try {
    if (item.claim !== "mine") await claimReview(item.id, await token());
    await router.push(lp(`/review/${item.id}`));
  } catch (err) {
    const ageGate = err instanceof ApiError && err.code === "age_verification_required";
    if (ageGate) skipped.add(item.id);
    nextError.value = ageGate ? t("error.ageVerificationRequired") : err instanceof ApiError && err.status === 409 ? t("review.claim.taken") : t("review.claim.failed");
    await loadNext();
  } finally { nextBusy.value = false; }
}
watch(() => !!data.value && (stampedByMe.value || decided.value), (shown) => { if (shown && nextItems.value === null) void loadNext(); });

async function token() {
  const tok = await session.accessToken();
  if (!tok) throw new Error(t("auth.expired"));
  return tok;
}

async function load() {
  const seq=++loadSequence,target=id.value;
  error.value = "";
  correctionError.value = '';
  loading.value = !data.value;
  try {
    needsClaim.value=false;
    const result=await fetchReviewDetail(target, await token());
    if(!active||seq!==loadSequence||target!==id.value)return;
    data.value=result;
    void loadOriginality();
    document.title = pageTitle(`${t("review.detail.title")} · ${data.value.detail.document.roleName}`);
  } catch (err) {
    if(!active||seq!==loadSequence||target!==id.value)return;
    // 伺服器原文在 code；message 是給人看的「請求失敗」
    const unclaimed=err instanceof ApiError && err.status===409 && err.code==="claim this submission first";
    // 直接開連結、或讀到一半領取逾時：自動再領一次，只在真的被別人領走時才停下來說明。
    // 畫面上是已定案或我審過的單（例如改判後重讀）就不領：那不是要審的單。
    const reviewable=!data.value||(data.value.submission.status==='pending'&&!data.value.submission.stampedByMe);
    if(unclaimed&&!autoClaimed&&reviewable){
      autoClaimed=true;
      try{ await claimReview(target, await token()); }
      catch(claimErr){
        if(!active||seq!==loadSequence||target!==id.value)return;
        if(claimErr instanceof ApiError&&claimErr.status===409){ claimNote.value=t("review.claim.otherNote"); return claimErr; }
        // 成人內容的單要先確認年齡：再按一次領取也不會成功，只說明怎麼辦
        if(claimErr instanceof ApiError&&claimErr.code==="age_verification_required"){ error.value=t("error.ageVerificationRequired"); return claimErr; }
        needsClaim.value=true;error.value=t("review.claim.failed");return claimErr;
      }
      if(!active||seq!==loadSequence||target!==id.value)return;
      return load();
    }
    needsClaim.value=unclaimed;
    error.value = needsClaim.value ? t("review.claimFirst") : err instanceof ApiError && err.status===410 ? t("review.inactive") : err instanceof Error ? err.message : t("state.loadFailed");
    return err;
  } finally {
    if(seq===loadSequence)loading.value = false;
  }
}

async function showCorrectionError(message:string,target:string){
 if(!active||id.value!==target)return;
 correctionError.value=message;
 await nextTick();
 if(!active||id.value!==target)return;
 correctionErrorNotice.value?.focus({preventScroll:true});
 correctionErrorNotice.value?.scrollIntoView({block:'start'});
}

async function reloadCorrection(){
 const target=id.value,sequence=loadSequence+1;
 const failure=await load();
 if(!active||id.value!==target||loadSequence!==sequence)return;
 if(error.value){
  error.value='';
  await showCorrectionError(correctionReadMessage(failure),target);
 }
}

function correctionReadMessage(failure:unknown){
 if(failure instanceof ApiError){
  switch(failure.code){
   case 'age_verification_required':return t('error.ageVerificationRequired');
   case 'invalid_arguments':case 'invalid_argument':case 'invalid_request':return t('error.invalidArguments');
   case 'insufficient_scope':return t('error.insufficientScope');
  }
  if(failure.status===409&&failure.code==='claim this submission first')return t('review.claimFirst');
  switch(failure.status){
   case 401:return t('auth.expired');
   case 403:return t('state.forbidden');
   case 404:return t('state.notFound');
   case 410:return t('review.inactive');
  }
 }
 return failure instanceof Error&&failure.message===t('auth.expired')?t('auth.expired'):t('state.loadFailed');
}

async function claim() {
  busy.value = true;
  error.value = "";
  try {
    await claimReview(id.value, await token());
    await load();
  } catch (err) {
    error.value = err instanceof ApiError && err.status===409 ? t("review.claimChanged") : err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = false;
  }
}

async function release() {
  busy.value = true;
  try {
    await releaseReview(id.value, await token(),data.value?.submission.claimGeneration);
    if (data.value) data.value.submission.claimedByMe = false;
  } catch (err) {
    error.value = err instanceof ApiError && err.status===409 ? t("review.claimChanged") : err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = false;
  }
}

async function holdCard() {
  if (busy.value || holdBusy.value || !data.value || !canHold.value) return;
  const target = id.value;
  holdBusy.value = true;
  holdError.value = "";
  try {
    await holdReview(target, await token(), data.value.submission.claimGeneration);
    if (!active || id.value !== target) return;
    done.value = t("review.hold.done");
    await load();
  } catch (err) {
    if (!active || id.value !== target) return;
    holdError.value = err instanceof ApiError && err.code === "review_already_held" ? t("review.hold.taken")
      : err instanceof ApiError && err.status === 409 ? t("review.claimChanged")
      : err instanceof Error && err.message === t("auth.expired") ? err.message : t("review.hold.failed");
    if (err instanceof ApiError && err.status === 409) await load();
  } finally {
    holdBusy.value = false;
  }
}

async function unholdCard() {
  const current = hold.value;
  if (busy.value || holdBusy.value || !current?.canRelease) return;
  // 管理員解別人的冷凍要寫理由：第一次按只展開理由欄
  if (!current.byMe && !holdReasonOpen.value) { holdReasonOpen.value = true; return; }
  if (!current.byMe && !holdReason.value.trim()) return;
  const target = id.value;
  holdBusy.value = true;
  holdError.value = "";
  try {
    await unholdReview(target, await token(), current.byMe ? undefined : holdReason.value.trim());
    if (!active || id.value !== target) return;
    // 先在畫面上拿掉冷凍：解凍後冷凍人可能沒領著（單子正被別人領著讀），重讀會被擋，舊畫面不能還寫著「已冷凍」
    if (data.value?.submission.id === target) data.value.submission.hold = null;
    holdReasonOpen.value = false;
    holdReason.value = "";
    done.value = t("review.hold.released");
    await load();
  } catch (err) {
    if (!active || id.value !== target) return;
    holdError.value = err instanceof Error && err.message === t("auth.expired") ? err.message : t("review.hold.unholdFailed");
    if (err instanceof ApiError && err.status === 409) await load();
  } finally {
    holdBusy.value = false;
  }
}

async function withdraw() {
  if (busy.value || !data.value || !manager.value || decided.value) return;
  if (!withdrawOpen.value) { withdrawOpen.value = true; return; }
  const reason = withdrawReason.value.trim();
  if (!reason) return;
  const target = id.value;
  busy.value = true;
  withdrawError.value = "";
  try {
    await withdrawReopen(target, await token(), reason);
    if (!active || id.value !== target) return;
    withdrawOpen.value = false;
    withdrawReason.value = "";
    done.value = t("review.reopen.withdrawn");
    await load();
  } catch (err) {
    if (!active || id.value !== target) return;
    withdrawError.value = err instanceof Error && err.message === t("auth.expired") ? err.message : t("review.reopen.withdrawFailed");
  } finally {
    busy.value = false;
  }
}

async function stamp(verdict: "approve" | "reject") {
  if(busy.value||!data.value||data.value.submission.id!==id.value)return;
  if (hold.value) return;
  if (verdict === "reject" && rejectLocked.value) return;
  if (!claimedByMe.value) {
    error.value = t("review.claimFirst");
    return;
  }
  if (verdict === "approve" && approveBlocked.value) return;
  busy.value = true;
  error.value = "";
  decideError.value = "";
  decideUnknown.value = false;
  const target=id.value,review=data.value,reason=note.value,generation=review.submission.claimGeneration;
  try {
    const confirmedToken=await token();
    const approved=approvals.value+1>=review.submission.required;
    // 重新審核：維持通過不動卡片；駁回走改判，卡改回上一個通過的版本或下架
    const keep=verdict==='approve'&&reopen.value;
    const body=verdict==='reject'?(reopen.value?'review.reopen.rejectBody':'review.confirm.rejectBody'):keep?'review.reopen.keepBody':approved?'review.confirm.approveFinal':'review.confirm.approvePending';
    if(!await decisionConfirm({scrollMessage:true,title:t(keep?'review.reopen.keepTitle':verdict==='approve'?'review.confirm.approveTitle':'review.confirm.rejectTitle'),message:summary(review.detail.document.roleName,review.submission.submittedAt,t(keep?'review.action.keep':`review.action.${verdict}`),reason)+'\n\n'+t(body),confirmText:t(keep?'review.action.keep':verdict==='approve'?'review.confirm.approve':'review.confirm.rejectSubmit'),cancelText:t('review.confirm.back'),focusCancel:true,danger:verdict==='reject',dangerAppearance:'subdued'}))return;
    if(!active||id.value!==target||data.value!==review)return;
    if(await token()!==confirmedToken)throw new Error(t('auth.expired'));
    const res = await stampReview(target, confirmedToken, { verdict, note:reason, generation });
    if(!active||id.value!==target)return;
    if (data.value) {
      data.value.submission.status = res.status;
      data.value.submission.claimedByMe = false;
      data.value.submission.stampedByMe = true;
      data.value.submission.stamps.push({ verdict, note:reason, at: Date.now(), mine: true });
      // 重讀一次：結果卡要的是伺服器上的案件狀態，不是前端推算的
      await load();
      if(!active||id.value!==target)return;
      await nextTick();
      decideSection.value?.scrollIntoView({ block: "start" });
      decideSection.value?.querySelector<HTMLElement>("[data-decide-title]")?.focus({ preventScroll: true });
    }
  } catch (err) {
    if(!active||id.value!==target)return;
    if (err instanceof ApiError && err.code === "review_length_insufficient") {
      const l = err.reviewLength ? formatReviewLength(err.reviewLength, String(locale.value)) : lengthParams.value;
      decideError.value = t("review.decide.errorLength", { total: l.total, required: l.required });
    } else if (err instanceof ApiError && err.code === "review_reopen_stale") {
      decideError.value = t("review.reopen.stale");
      await load();
    } else if (err instanceof ApiError && err.code === "review_reopen_reject_manager") {
      decideError.value = t("review.reopen.rejectManager");
    } else if (err instanceof ApiError && err.code === "review_correction_reward_pending") {
      decideError.value = t("review.reopen.rewardPending");
    } else if (err instanceof ApiError && err.code === "review_held") {
      // 送出前一刻被別人冷凍了：說明並重讀，畫面換成冷凍狀態
      decideError.value = t("review.hold.decideBlocked");
      await load();
    } else if (err instanceof ApiError && err.status === 409) decideError.value = t("review.claimChanged");
    else if (err instanceof ApiError) decideError.value = t("review.decide.failed");
    else if (err instanceof Error && err.message === t("auth.expired")) decideError.value = err.message;
    else decideUnknown.value = true;
    await nextTick();
    decideErrorEl.value?.focus({ preventScroll: true });
    decideErrorEl.value?.scrollIntoView({ block: "nearest" });
  } finally {
    busy.value = false;
  }
}

async function correct(){
 if(busy.value||!data.value||data.value.submission.id!==id.value)return;
 const review=data.value,target=id.value,pending=review.submission.correction;
 const reason=pending?.state==='pending'?pending.note:correctionNote.value.trim();
 if(!reason){correctionError.value=t('review.correction.reasonRequired');return;}
 busy.value=true;error.value='';correctionError.value='';
 try{
  const confirmedToken=await token();
  if(!await decisionConfirm({scrollMessage:true,title:t('review.correction.confirmTitle'),message:summary(review.detail.document.roleName,review.submission.submittedAt,`${t('review.action.approve')} → ${t('review.action.reject')}`,reason,'review.correction.reason')+'\n\n'+t('review.correction.confirmBody')+'\n'+t('review.correction.publicEffect'),confirmText:t('review.correction.confirm'),cancelText:t('review.correction.back'),danger:true,dangerAppearance:'subdued'}))return;
  if(!active||id.value!==target||data.value!==review)return;
  const operationId=pending?.state==='pending'?pending.operationId:crypto.randomUUID();
  if(await token()!==confirmedToken)throw new Error(t('auth.expired'));
  const result=await correctReviewDecision(target,confirmedToken,{operationId,note:reason});
  if(!active||id.value!==target)return;
  done.value=t('review.correction.done')+' '+t(result.publicState==='previous_version'?'review.correction.donePrevious':result.publicState==='unpublished'?'review.correction.doneUnpublished':'review.correction.doneUnchanged');
  correctionOpen.value=false;await load();
 }catch(err){
  if(!active||id.value!==target)return;
  const message=err instanceof ApiError&&err.code==='review_correction_reward_pending'?t('review.correction.rewardPending'):err instanceof ApiError&&err.status===503?t('review.correction.unknown'):err instanceof Error?err.message:t('state.actionFailed');
  await load();
  await showCorrectionError(message,target);
 }finally{busy.value=false;}
}

onMounted(() => { void load(); });
</script>

<template>
  <section class="review-detail">
    <p v-if="error" class="notice notice--error" role="alert">{{ error }} <button v-if="data" class="btn btn--sm" :disabled="busy" @click="load">{{t('review.correction.reload')}}</button></p>
    <div v-if="claimNote" class="notice" role="status" data-claim-taken>
      <p>{{ claimNote }}</p>
      <RouterLink class="btn btn--primary" :to="lp('/review')">{{ $t("review.backToQueue") }}</RouterLink>
    </div>
    <RouterLink v-if="error && !data" :to="lp('/review')">{{ $t("review.backToQueue") }}</RouterLink>
    <button v-if="needsClaim" class="btn btn--primary" :disabled="busy" @click="claim">{{ $t("review.action.claim") }}</button>
    <p v-if="data?.detail.closed" class="notice" role="status">{{ $t("review.closedPartial") }}</p>
    <p v-else-if="data?.detail.partial" class="notice" role="status">{{ $t("review.partial") }}</p>
    <p v-if="done" class="notice" role="status">{{ done }} <RouterLink :to="lp('/review')">← {{ $t("review.eyebrow") }}</RouterLink></p>

    <div v-if="loading" class="ghost detail-ghost" aria-hidden="true" />

    <div v-else-if="data && doc" class="layout">
      <header class="head layout__head">
        <div class="head__text">
          <p class="eyebrow">
            <RouterLink :to="lp('/review')">{{ $t("review.eyebrow") }}</RouterLink>
            · <span data-type-label>{{ $t(submissionTypeKey(submissionType)) }}</span>
            · {{ $t("review.stamps", { n: approvals, required: data.submission.required }) }}
          </p>
          <div class="head__name">
            <h2 class="head__title display">{{ doc.roleName }}</h2>
            <span v-if="submissionType !== 'reopen' && (data.submission.attempt ?? 1) >= 2" class="chip chip--attempt" data-attempt>{{ $t("review.attempt", { n: data.submission.attempt }) }}</span>
          </div>
          <p class="subtle">{{ doc.roleDesc }}</p>
          <!-- 重送的卡：上一次的結果與說明。駁回說明預設一行，點開看全文 -->
          <div v-if="data.submission.previous" class="previous" data-previous-submission>
            <details v-if="data.submission.previous.status === 'rejected'" class="previous__note">
              <summary>{{ $t("review.previous.rejected", { reason: data.submission.previous.note || $t("review.confirm.noNote") }) }}</summary>
            </details>
            <p v-else class="previous__note">{{ $t("review.previous.approved") }}</p>
            <p class="subtle previous__time">{{ $t("review.previous.submittedAt", { time: dateTime(data.submission.previous.submittedAt) }) }}</p>
          </div>
          <!-- 原作者與他的其他卡（owner 2026-11-08 取消盲審）：抓到一張盜卡要能一串查出 -->
          <ReviewAuthorPanel v-if="data.author" :submission-id="data.submission.id" :author="data.author" />
          <!-- 作者的分級放最上面：審核人第一件事就是對照內容跟它符不符；問卷在「分級問卷」分頁 -->
          <p class="rating">
            {{ $t("review.rating.declared") }}
            <RatingMark v-if="data.submission.rating" :rating="data.submission.rating" variant="chip" />
            <strong v-else>{{ $t("review.rating.sfw") }}</strong>
            · {{ $t("review.rating.hint") }}
          </p>
          <!-- 冷凍並討論：放在卡名下面，進來第一眼就看得到為什麼不能決定、誰能解凍 -->
          <div v-if="hold" class="hold" role="status" data-hold-notice>
            <p class="hold__text">{{ hold.byMe ? $t("review.hold.noticeMine") : $t("review.hold.noticeOther", { name: hold.holder || $t("review.hold.someone") }) }}</p>
            <p class="subtle hold__time">{{ $t("review.hold.since", { time: dateTime(hold.at) }) }}</p>
            <div v-if="hold.canRelease && !hold.byMe && holdReasonOpen" class="field hold__reason">
              <label for="hold-reason">{{ $t("review.hold.reasonLabel") }}</label>
              <textarea id="hold-reason" v-model="holdReason" autocomplete="off" class="input" rows="3" :maxlength="NOTE_MAX" :disabled="holdBusy" />
            </div>
            <p v-if="holdError" class="notice notice--error hold__error" role="alert">{{ holdError }}</p>
            <button v-if="hold.canRelease" type="button" class="btn btn--sm hold__release" :disabled="busy || holdBusy || (!hold.byMe && holdReasonOpen && !holdReason.trim())" data-unhold @click="unholdCard">{{ $t("review.action.unhold") }}</button>
          </div>
          <!-- 重新審核：說清楚這是已發布的卡、為什麼被拿回來審；管理員在這裡撤銷 -->
          <div v-if="reopen && !decided" class="reopen" role="status" data-reopen-notice>
            <p class="reopen__text">{{ $t("review.reopen.notice") }}</p>
            <p v-if="data.submission.reopenReason" class="text reopen__reason">{{ $t("review.reopen.reason", { reason: data.submission.reopenReason }) }}</p>
            <div v-if="manager && withdrawOpen" class="field reopen__withdraw">
              <label for="withdraw-reason">{{ $t("review.reopen.withdrawReason") }}</label>
              <textarea id="withdraw-reason" v-model="withdrawReason" autocomplete="off" class="input" rows="3" :maxlength="NOTE_MAX" :disabled="busy" />
            </div>
            <p v-if="withdrawError" class="notice notice--error" role="alert">{{ withdrawError }}</p>
            <button v-if="manager" type="button" class="btn btn--sm reopen__action" :disabled="busy || (withdrawOpen && !withdrawReason.trim())" data-withdraw @click="withdraw">{{ $t("review.action.withdraw") }}</button>
          </div>
        </div>
        <div class="head__acts">
          <button v-if="claimedByMe" class="btn btn--sm" :disabled="busy || decided" @click="release">{{ $t("review.action.release") }}</button>
          <button v-else-if="!stampedByMe" class="btn btn--sm btn--primary" :disabled="busy || decided" @click="claim">{{ $t(hold ? "review.action.claimHeld" : "review.action.claim") }}</button>
        </div>
      </header>

      <!-- 桌機右側欄（≥1080，黏著）：字數與決定入口。窄螢幕排在卡名下面，入口改由底部固定列給 -->
      <aside class="side layout__side">
        <section class="pane panel side__length" data-review-length>
          <h3>{{ $t('reviewLength.title') }}</h3>
          <template v-if="data.detail.reviewLength">
            <p class="length-values">
                <span>{{ $t('reviewLength.persona', lengthParams) }}</span>
                <span>{{ $t('reviewLength.constantWorldbook', lengthParams) }}</span>
                <span>{{ $t('reviewLength.total', lengthParams) }}</span>
                <strong class="length-status" :class="data.submission.lengthExempt || data.detail.reviewLength.eligible ? 'length-status--ok' : 'length-status--short'" data-length-status>{{ $t(data.submission.lengthExempt ? 'lengthExemption.enabled' : data.detail.reviewLength.eligible ? 'reviewLength.eligible' : 'reviewLength.ineligible') }}</strong>
            </p>
            <p class="subtle">{{ $t('reviewLength.welcome', lengthParams) }}</p>
          </template>
          <p v-else class="subtle">{{ $t('reviewLength.unavailable') }}</p>
          <ReviewLengthExemptionControl v-if="data.submission.manager" :card-number="data.card.id" :disabled="busy" @change="data.submission.lengthExempt=$event" />
        </section>
        <div class="side__acts">
          <button v-if="canDecide" type="button" class="btn btn--primary btn--lg" @click="goDecide">{{ $t("review.action.toDecide") }}</button>
          <RouterLink class="btn btn--lg" :to="lp(`/play/${data.card.id}?review=${encodeURIComponent(id)}`)" target="_blank">{{ $t("review.action.play") }}</RouterLink>
        </div>
      </aside>

      <div class="layout__body">
      <nav ref="tabsBar" class="tabs-bar" :aria-label="$t('review.read.tabs')">
        <div class="seg tabs">
          <!-- 八格都排在分頁條上、橫滑可達：審核員每張卡都會看「正則與版面」「成本側寫」（owner 2026-11-02），不收進「更多」 -->
          <button v-for="s in SECTIONS" :key="s" class="seg__item" :class="{ 'seg__item--on': section === s }" :aria-pressed="section === s" @focus="revealFocusedTab" @click="section = s; ($event.currentTarget as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' })">
            {{ sectionLabel(s) }}
          </button>
        </div>
      </nav>

      <section v-show="section === 'basic'" class="pane panel">
        <div class="field"><label>{{ $t("editor.name") }}</label><input class="input" :value="doc.roleName" readonly /></div>
        <div class="field"><label>{{ $t("editor.summary") }}</label><pre class="text">{{ doc.roleDesc }}</pre></div>
        <div class="field"><label>{{ $t("review.fandom") }}</label><p class="text" data-fandom-shown>{{ fandom || $t("review.fandom.none") }}</p></div>
        <div class="field">
          <label>{{ $t("review.tags") }}</label>
          <template v-if="!editingTags">
            <div class="tags-row">
              <ul class="tags"><li v-for="tag in tags" :key="tag" class="chip">{{ tag }}</li></ul>
              <button v-if="claimedByMe && !decided && !reopen" type="button" class="btn btn--sm btn--ghost" @click="editTags">{{ $t("review.tags.edit") }}</button>
            </div>
            <span v-if="tagsChanged" class="subtle">{{ $t("review.tags.author", { tags: authorTags.join("、") || "—" }) }}</span>
          </template>
          <template v-else>
            <ul class="tags">
              <li v-for="tag in draftTags" :key="tag" class="chip">
                {{ tag }}
                <button type="button" class="chip__x" :aria-label="$t('review.tags.remove', { tag })" @click="toggleDraftTag(tag)">×</button>
              </li>
            </ul>
            <TagPicker :selected="draftTags" :language="doc.language || 'zh-Hant'" :max="TAGS_MAX" @toggle="toggleDraftTag" />
            <span class="subtle">{{ $t("review.tags.hint") }}</span>
            <label class="field"><span>{{ $t("review.fandom") }}</span><LookupField v-model="draftFandom" :lookup="(q) => fetchFandomLookup(q)" :placeholder="$t('editor.fandom.placeholder')" :label="$t('review.fandom')" /></label>
            <p v-if="tagsError" class="notice notice--error" role="alert">{{ tagsError }}</p>
            <div class="tags-acts">
              <button type="button" class="btn btn--sm btn--ghost" :disabled="tagsBusy" @click="editingTags = false">{{ $t("dialog.cancel") }}</button>
              <button type="button" class="btn btn--sm btn--primary" :disabled="tagsBusy" @click="saveTags">{{ $t("review.tags.save") }}</button>
            </div>
          </template>
        </div>
        <div v-if="doc.roleBackground || doc.roleAvatar" class="field"><label>{{ $t("editor.section.media") }}</label><img class="art" :src="doc.roleBackground || doc.roleAvatar" alt="" /></div>
        <!-- 分享圖（選填）也是訪客看得到的內容：貼連結時的預覽大圖 -->
        <div v-if="doc.roleShareImage" class="field"><label>{{ $t("editor.shareImage") }}</label><img class="art art--share" :src="doc.roleShareImage" alt="" /></div>
      </section>

      <section v-show="section === 'rating'" class="pane panel" data-rating-answers>
        <template v-if="data.submission.rating && data.submission.ratingAnswers">
          <RatingMark :rating="data.submission.rating" :descriptors="data.submission.ratingDescriptors ?? []" />
          <p class="subtle small-note">{{ $t("review.rating.answersHint") }}</p>
          <dl class="answers">
            <template v-for="row in ratingRows" :key="row.id">
              <dt>{{ row.title }}</dt>
              <dd>
                <template v-if="row.answer"><RatingMark :rating="row.rating!" variant="chip" /> {{ row.answer }}</template>
                <span v-else class="subtle">{{ $t("review.rating.notPicked") }}</span>
              </dd>
            </template>
            <template v-if="ratingOther">
              <dt>{{ $t("review.rating.other") }}</dt>
              <dd><RatingMark v-if="ratingOther.rating !== 'G'" :rating="ratingOther.rating" variant="chip" /> {{ ratingOther.text }}</dd>
            </template>
          </dl>
        </template>
        <p v-else class="subtle">{{ $t("review.rating.legacy") }}</p>
      </section>

      <section v-show="section === 'persona'" class="pane panel">
        <div class="field"><label>{{ $t("editor.detail") }}</label><pre class="text mono">{{ doc.roleDetailDesc }}</pre></div>
        <div class="field"><label>{{ $t("editor.contract") }}</label><pre class="text mono">{{ doc.roleOutputContract }}</pre></div>
        <div class="field"><label>{{ $t("editor.jailbreak") }}</label><pre class="text mono">{{ doc.customInstructions ?? doc.jailbreak }}</pre></div>
      </section>

      <section v-show="section === 'originality'" class="pane panel">
        <p v-if="originalityError" class="notice notice--error" role="alert">{{ originalityError }}</p>
        <div v-else-if="!originality" class="ghost originality-ghost" aria-hidden="true" />
        <p v-else-if="!originality.available" class="subtle">{{ $t(`review.originality.unavailable.${originality.reason}`) }}</p>
        <template v-else>
          <div class="score">
            <strong class="score__value">{{ percent(originality.similarity) }}</strong>
            <span class="score__label">{{ $t("review.originality.similarity") }}</span>
            <span class="subtle">{{ $t("review.originality.compared", { n: originality.comparedCards }) }}</span>
          </div>
          <p class="subtle small-note">{{ $t("review.originality.hint") }}</p>
          <p v-if="!originality.sources.length" class="notice">{{ $t("review.originality.none") }}</p>
          <div v-else class="field">
            <label>{{ $t("review.originality.sources") }}</label>
            <ul class="sources">
              <li>
                <button type="button" class="source" :class="{ 'source--on': picked === null }" :aria-pressed="picked === null" @click="picked = null">
                  <span class="source__name">{{ $t("review.originality.all") }}</span>
                  <span class="source__pct">{{ percent(originality.similarity) }}</span>
                </button>
              </li>
              <li v-for="src in originality.sources" :key="src.cardId">
                <button type="button" class="source" :class="{ 'source--on': picked === src.cardId }" :aria-pressed="picked === src.cardId" @click="picked = src.cardId">
                  <span class="source__name">{{ src.name || $t("review.originality.untitled") }}</span>
                  <span class="chip">{{ $t(`review.originality.status.${src.status}`) }}</span>
                  <span class="subtle">{{ $t(src.earlier ? "review.originality.earlier" : "review.originality.later") }} · {{ dateTime(src.firstSeenAt) }}</span>
                  <span class="source__pct">{{ percent(src.similarity) }}</span>
                </button>
                <!-- 只連已上榜的卡：審核中的卡還在盲審，公開頁不該成為認出作者的途徑 -->
                <RouterLink v-if="src.status === 'approved'" class="source__open" :to="lp(`/cards/${src.cardId}`)" target="_blank">{{ $t("review.action.open") }}</RouterLink>
              </li>
            </ul>
          </div>
          <div class="field">
            <label>{{ $t("editor.detail") }}</label>
            <p v-if="originality.segments.length" class="subtle small-note">{{ $t("review.originality.marked") }}</p>
            <pre class="text mono marked"><template v-for="(piece, i) in marked" :key="i"><mark v-if="piece.hit" class="hit">{{ piece.text }}</mark><template v-else>{{ piece.text }}</template></template></pre>
          </div>
        </template>
      </section>

      <section v-show="section === 'dialogue'" class="pane panel">
        <div v-if="isOpeningPage" class="field" data-opening-page>
          <label>{{ $t("editor.opening.page") }}</label>
          <template v-if="openingPage.trim()">
            <iframe
              ref="openingFrame"
              class="opening-frame"
              :sandbox="OPENING_SANDBOX"
              :allow="OPENING_ALLOW"
              :srcdoc="openingDoc"
              :title="$t('editor.opening.page')"
              :style="{ height: `${openingFrameHeight}px` }"
              data-opening-preview
            />
            <details class="opening-source" data-opening-source>
              <summary>{{ $t("review.openingPage.source", { n: [...openingPage].length }) }}</summary>
              <pre class="entry__body mono">{{ openingPage }}</pre>
            </details>
          </template>
          <p v-else class="subtle">{{ $t("editor.opening.page.empty") }}</p>
        </div>
        <div v-if="!isOpeningPage || data.detail.greetings.welcome" class="field"><label>{{ $t("editor.welcome") }}</label><pre class="text mono">{{ data.detail.greetings.welcome }}</pre></div>
        <div v-if="data.detail.greetings.alternates.length" class="field">
          <label>{{ $t("editor.alternates") }}</label>
          <pre v-for="(a, i) in data.detail.greetings.alternates" :key="i" class="text mono">{{ a }}</pre>
        </div>
        <div v-if="data.detail.greetings.prologue.length" class="field">
          <label>{{ $t("editor.prologue") }}</label>
          <ul class="tags"><li v-for="(p, i) in data.detail.greetings.prologue" :key="i" class="chip">{{ p }}</li></ul>
        </div>
        <div class="field">
          <label>{{ $t("editor.talkExample") }}</label>
          <ol v-if="talkTurns.length" class="turns">
            <li v-for="(turn, i) in talkTurns" :key="i" class="turn" :class="`turn--${turn.roleType}`">
              <span class="turn__who">{{ $t(turn.roleType === "user" ? "editor.talkExample.user" : "editor.talkExample.ai") }}</span>
              <pre class="text">{{ turn.content }}</pre>
            </li>
          </ol>
          <!-- 解不開的才原樣給看：那代表資料本身有問題，審核人該看到 -->
          <pre v-else-if="doc.talkExample" class="text mono">{{ doc.talkExample }}</pre>
          <p v-else class="subtle">—</p>
        </div>
      </section>

      <section v-show="section === 'worldbook'" class="pane panel">
        <p v-if="!data.detail.worldbook" class="subtle">{{ $t("review.wb.none") }}</p>
        <template v-else>
          <!-- 整本預設收起：三百條世界書沒人看得完，審核人抽查幾條就夠；展開後每條也先只露標題與關鍵詞 -->
          <details class="book">
            <summary class="book__sum">
              <strong>{{ data.detail.worldbook.name }}</strong>
              <span class="subtle">{{ $t("review.wb.book", { n: data.detail.worldbook.entries.length }) }}</span>
            </summary>
            <details v-for="e in data.detail.worldbook.entries" :key="e.entryId" class="entry" :class="{ 'entry--off': !e.isEnabled }">
              <summary class="entry__head">
                <strong>{{ e.name || $t("wb.entry.untitled") }}</strong>
                <span v-if="e.isConstant" class="chip">{{ $t("review.entry.constant") }}</span>
                <span v-if="!e.isEnabled" class="chip">{{ $t("review.entry.disabled") }}</span>
                <span v-if="e.keywords.length" class="subtle">{{ e.keywords.join("、") }}</span>
                <span v-if="e.secondaryKeywords.length" class="subtle">+ {{ e.secondaryKeywords.join("、") }}</span>
              </summary>
              <pre class="entry__body">{{ e.content }}</pre>
            </details>
          </details>
        </template>
      </section>

      <section v-show="section === 'display'" class="pane panel">
        <p v-if="!data.detail.authorAsset.rules.length" class="subtle">{{ $t("review.rules.none") }}</p>
        <template v-else>
          <!-- 只列數量與名字：規則內容是給機器讀的，又長又佔位；審核人要驗效果直接去試玩 -->
          <p class="subtle">{{ $t("review.rules.count", { n: data.detail.authorAsset.rules.length }) }}</p>
          <ul class="tags">
            <li v-for="r in data.detail.authorAsset.rules" :key="r.id" class="chip" :class="{ 'chip--off': !r.enabled }">{{ r.name || r.id }}</li>
          </ul>
        </template>
        <div v-if="data.detail.authorAsset.mountTrigger" class="field">
          <label>{{ $t("review.mount") }}</label>
          <input class="input" :value="`${data.detail.authorAsset.mountTrigger} · ${data.detail.authorAsset.mountLayer} · ${data.detail.authorAsset.pageMode}`" readonly />
        </div>
        <!-- 開場網頁：開局形式是開場網頁時，預覽與原文在「對話」分頁，這裡只給跳過去的連結，不重複放大段原文 -->
        <p v-if="isOpeningPage && data.detail.authorAsset.openingPage" class="field subtle opening-ref">
          <span>{{ $t("review.openingPage", { n: [...data.detail.authorAsset.openingPage].length }) }}</span>
          <button type="button" class="link opening-ref__link" data-opening-page-link @click="section = 'dialogue'">{{ $t("review.openingPage.inDialogue") }}</button>
        </p>
        <details v-else-if="data.detail.authorAsset.openingPage" class="field">
          <summary>{{ $t("review.openingPage", { n: [...data.detail.authorAsset.openingPage].length }) }}</summary>
          <pre class="entry__body">{{ data.detail.authorAsset.openingPage }}</pre>
        </details>
      </section>

      <section v-show="section === 'cost'" class="pane panel">
        <dl class="cost">
          <dt>{{ $t("review.cost.persona") }}</dt><dd>{{ data.detail.costProfile.personaChars }}</dd>
          <dt>{{ $t("review.cost.entries") }}</dt>
          <dd>{{ data.detail.costProfile.worldbookEntryCount }}（{{ data.detail.costProfile.worldbookEnabledCount }} / {{ data.detail.costProfile.worldbookConstantCount }}）</dd>
        </dl>
        <p class="notice">{{ $t("review.cost.constantTokens", { n: data.detail.costProfile.estimatedConstantTokens }) }}</p>
        <p class="notice">{{ $t("review.cost.maxTokens", { n: data.detail.costProfile.estimatedMaxTokens }) }}</p>
      </section>

      <section ref="decideSection" id="decide" class="verdict panel">
        <!-- 送出後（或回頭看審過、已定案的單）：決定區換成結果卡 -->
        <template v-if="stampedByMe || decided">
          <h3 class="verdict__title" tabindex="-1" data-decide-title data-result-card>{{ doc.roleName }}</h3>
          <p v-if="myStamp" class="result__mine"><span class="chip" :class="{ 'chip--reject': myStamp.verdict === 'reject' }">{{ $t(myStamp.verdict === 'approve' ? 'review.result.mine.approve' : 'review.result.mine.reject') }}</span></p>
          <!-- 一張單一章就定案：送出後只會是已上榜或已駁回 -->
          <p v-if="data.submission.status === 'approved' || data.submission.status === 'rejected'" class="result__now">{{ $t(data.submission.status === 'approved' ? 'review.result.now.approved' : 'review.result.now.rejected') }}</p>
          <div v-if="myStamp" class="field">
            <p class="subtle records__title">{{ $t("review.result.noteTitle") }}</p>
            <p class="text record__note">{{ myStamp.note || $t("review.confirm.noNote") }}</p>
          </div>
          <div v-if="otherStamps.length" class="records" data-other-stamps>
            <p class="subtle records__title">{{ $t("review.stampsList") }}</p>
            <ul class="records__list">
              <li v-for="(s, i) in otherStamps" :key="i" class="record">
                <span class="record__head">
                  <span class="chip" :class="{ 'chip--reject': s.verdict === 'reject' }">{{ $t(`review.action.${s.verdict}`) }}</span>
                  <span class="subtle">{{ dateTime(s.at) }}</span>
                </span>
                <p v-if="s.note" class="text record__note">{{ s.note }}</p>
              </li>
            </ul>
          </div>
          <p v-if="myStamp?.verdict === 'approve' && data.submission.canCorrect && !data.submission.manager && !correctionOpen" class="subtle">{{ $t("review.correction.window", { hours: 24 }) }}</p>
            <p v-if="correctionError" ref="correctionErrorNotice" class="notice notice--error correction-error" role="alert" tabindex="-1">{{correctionError}} <button class="btn btn--sm" :disabled="busy" @click="reloadCorrection">{{t('review.correction.reload')}}</button></p>
            <div v-if="data.submission.correction" class="records">
              <h3>{{t('review.correction.recordTitle')}}</h3>
              <p>{{dateTime(data.submission.correction.at)}}</p>
              <p class="text record__note">{{data.submission.correction.note}}</p>
              <p v-if="data.submission.correction.state==='pending'" class="notice">{{t('review.correction.unknown')}}</p>
              <p v-if="data.submission.correction.state==='conflict'" class="notice">{{t('review.correction.changed')}}</p>
              <button v-if="data.submission.correction.state==='pending'" class="btn" :disabled="busy" @click="reloadCorrection">{{t('review.correction.reload')}}</button>
              <button v-if="data.submission.correction.state==='pending'&&data.submission.correction.canResume" class="btn" :disabled="busy" @click="correct">{{t('review.correction.action')}}</button>
            </div>
            <template v-if="data.submission.canCorrect&&(!data.submission.correction||data.submission.correction.state==='conflict')">
              <button class="btn" :disabled="busy" @click="correctionOpen=!correctionOpen">{{t('review.correction.action')}}</button>
              <div v-if="correctionOpen" class="field">
                <p v-if="!data.submission.manager">{{t('review.correction.window',{hours:24})}}</p>
                <p v-if="!data.submission.manager&&data.submission.deadline">{{t('review.correction.deadline',{deadline:dateTime(data.submission.deadline)})}}</p>
                <label for="correction-note">{{t('review.correction.reason')}}</label>
                <textarea autocomplete="off" id="correction-note" v-model="correctionNote" class="input" rows="5" maxlength="2000" :disabled="busy" />
                <p class="subtle">{{t('review.correction.reasonHint')}}</p>
                <button class="btn btn--lg" :disabled="busy||!correctionNote.trim()" @click="correct">{{t('review.correction.action')}}</button>
              </div>
            </template>
          <p v-if="nextError" class="notice notice--error" role="alert">{{ nextError }}</p>
          <p v-if="nextItems && !nextItems.length" class="subtle">{{ $t("review.result.queueEmpty") }}</p>
          <div class="verdict__acts">
            <RouterLink class="btn btn--lg" :to="lp('/review')">{{ $t("review.result.toQueue") }}</RouterLink>
            <button v-if="nextItems && nextItems.length" type="button" class="btn btn--primary btn--lg" :disabled="nextBusy" @click="goNext">{{ $t("review.result.next", { n: nextItems.length }) }}</button>
          </div>
        </template>
        <template v-else>
          <h3 class="verdict__title" tabindex="-1" data-decide-title>{{ $t("review.decide.title") }}</h3>
          <div v-if="decideError || decideUnknown" ref="decideErrorEl" class="notice notice--error" role="alert" tabindex="-1">
            <p>{{ decideUnknown ? $t("review.decide.unknown") : decideError }}</p>
            <RouterLink v-if="decideUnknown" class="btn btn--sm" :to="lp('/review/decisions')">{{ $t("review.history.title") }}</RouterLink>
          </div>
          <p v-if="hold" class="notice blocked" data-hold-blocked>{{ $t("review.hold.decideBlocked") }}</p>
          <p v-else-if="rejectLocked && claimedByMe" class="subtle" data-reject-locked>{{ $t("review.reopen.rejectManager") }}</p>
          <p v-if="approveBlocked" id="approve-blocked" class="notice blocked" data-approve-blocked>{{ $t("review.decide.approveBlocked", { total: lengthParams.total, gap: lengthParams.remaining }) }}</p>
          <p v-else-if="!length && !decided" id="approve-blocked" class="subtle">{{ $t("review.decide.lengthUnknown") }}</p>
          <!-- 已經有人蓋過的章（舊單或需要兩章時）。駁回說明可能很長：不能塞進固定高度的 chip -->
          <div v-if="otherStamps.length" class="records" data-other-stamps>
            <p class="subtle records__title">{{ $t("review.stampsList") }}</p>
            <ul class="records__list">
              <li v-for="(s, i) in otherStamps" :key="i" class="record">
                <span class="record__head">
                  <span class="chip" :class="{ 'chip--reject': s.verdict === 'reject' }">{{ $t(`review.action.${s.verdict}`) }}</span>
                  <span class="subtle">{{ dateTime(s.at) }}</span>
                </span>
                <p v-if="s.note" class="text record__note">{{ s.note }}</p>
              </li>
            </ul>
          </div>
          <div class="field">
            <p class="reasons__label">{{ $t("review.decide.reasons") }}</p>
            <div class="reasons" role="group" :aria-label="$t('review.decide.reasons')">
              <button v-for="r in reasons" :key="r" type="button" class="chip reason" :disabled="!canDecide" :data-reason="r" @click="pickReason(r)">{{ $t(`review.reason.${r}.label`) }}</button>
            </div>
            <p v-if="noteFull" class="small-note blocked-note" role="status" data-note-full>{{ $t("review.decide.noteFull", { max: new Intl.NumberFormat(String(locale)).format(NOTE_MAX) }) }}</p>
            <p v-else class="subtle small-note">{{ $t("review.decide.reasonsHint") }}</p>
          </div>
          <div class="field">
            <label for="review-note">{{ $t("review.note.label") }}</label>
            <textarea ref="noteField" autocomplete="off" id="review-note" v-model="note" class="input" rows="4" :maxlength="NOTE_MAX" :placeholder="$t('review.note.placeholder')" :disabled="decided||busy||!!hold" @focus="noteFocused = true" @blur="noteFocused = false" />
          </div>
          <p v-if="!claimedByMe && !decided && !hold" class="subtle">{{ $t("review.claimFirst") }}</p>
          <!-- 拿不定主意、要先跟其他審核員討論：冷凍後誰都不能決定，卡留在清單上 -->
          <div v-if="canHold" class="field hold-entry">
            <button type="button" class="btn" :disabled="busy || holdBusy" data-hold @click="holdCard">{{ $t("review.action.hold") }}</button>
            <p class="subtle small-note">{{ $t("review.hold.hint") }}</p>
            <p v-if="holdError" class="notice notice--error" role="alert">{{ holdError }}</p>
          </div>
          <div class="verdict__acts">
            <button type="button" class="btn btn--ghost verdict__back" @click="backToRead">← {{ $t("review.decide.backToRead") }}</button>
            <button class="btn btn--danger btn--lg verdict__btn" :disabled="busy || decided || !claimedByMe || !!hold || rejectLocked || !note.trim()" @click="stamp('reject')">{{ busy ? $t("review.decide.submitting") : $t("review.action.reject") }}</button>
            <button class="btn btn--primary btn--lg verdict__btn" :disabled="busy || decided || !claimedByMe || !!hold || approveBlocked" :aria-describedby="approveBlocked || !length ? 'approve-blocked' : undefined" @click="stamp('approve')">{{ busy ? $t("review.decide.submitting") : $t(reopen ? "review.action.keep" : "review.action.approve") }}</button>
          </div>
        </template>
      </section>
      </div>
    </div>

    <!-- 手機底部固定列：試玩與前往決定。只在還能決定、決定區還沒進畫面時出現；打字時也收起，免得蓋住說明欄 -->
    <div v-if="data && doc && !loading && canDecide && !decideVisible && !noteFocused" class="dock">
      <RouterLink class="btn btn--lg dock__play" :to="lp(`/play/${data.card.id}?review=${encodeURIComponent(id)}`)" target="_blank">{{ $t("review.action.play") }}</RouterLink>
      <button type="button" class="btn btn--primary btn--lg dock__main" @click="goDecide">{{ $t("review.action.toDecide") }}</button>
    </div>
  </section>
</template>

<style scoped>
.link { display: inline-flex; align-items: center; min-height: var(--h-lg); }
.link, .link:hover { color: var(--accent-text); }
.correction-error { scroll-margin-block-start: calc(var(--header-h) + var(--s-4)); }
.head { display: flex; flex-wrap: wrap; gap: var(--s-4); align-items: flex-start; justify-content: space-between; margin-bottom: var(--s-4); }
.head__title { font-size: clamp(20px, 2.6vw, 24px); margin: 2px 0; }
.head__name { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.chip--attempt { color: var(--warning-text); }
.previous { display: grid; gap: 2px; margin-top: var(--s-2); padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); font-size: 13px; min-width: 0; }
.previous__note { margin: 0; min-width: 0; }
.previous__note > summary { cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.previous__note[open] > summary { white-space: pre-wrap; overflow-wrap: anywhere; }
.previous__time { font-size: 12px; }
.head__acts { display: flex; gap: var(--s-2); }
/* 版面：窄螢幕一欄（卡名 → 字數 → 分頁與內容 → 決定）；≥1080 右側 300 寬黏著欄放字數與決定入口 */
.layout { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-areas: "head" "side" "body"; column-gap: var(--s-5); }
.layout__head { grid-area: head; }
.layout__side { grid-area: side; }
.layout__body { grid-area: body; min-width: 0; scroll-margin-top: var(--header-h); --tabs-bar-h: calc(var(--h-sm) + var(--s-1) * 2 + var(--s-2) * 3); }
.side__acts { display: none; }
/* 分頁條黏在頁首下方（z 15，不透明底，內容不會從底下透出來）；讀到很長的人設也換得了分頁 */
.tabs-bar { position: sticky; top: var(--header-h); z-index: 15; background: var(--bg); padding-block: var(--s-2); margin-bottom: var(--s-2); }
/* 手機底部固定列：試玩與前往決定（DESIGN：底部動作列 z 15、玻璃、上緣一條線、safe-area）。
   用 sticky 而不是 fixed：讀卡時黏在畫面底部，捲到頁尾時停在頁面內容的最後，不蓋住站台頁尾的連結 */
.dock { position: sticky; bottom: 0; z-index: 15; display: flex; gap: var(--s-2); margin-top: var(--s-4); padding: var(--s-3) 0 calc(var(--s-3) + env(safe-area-inset-bottom)); background: color-mix(in srgb, var(--bg) 84%, transparent); backdrop-filter: blur(16px) saturate(1.2); -webkit-backdrop-filter: blur(16px) saturate(1.2); border-top: 1px solid var(--line); box-shadow: 0 0 0 100vmax color-mix(in srgb, var(--bg) 84%, transparent); clip-path: inset(0 -100vmax); }
.dock__play { flex: none; min-width: 88px; }
.dock__main { flex: 1; }
@media (max-width: 1079px) {
  /* 右緣漸層：分頁比畫面寬時，提示還可以往右滑 */
  .tabs-bar::after { content: ""; position: absolute; top: 0; right: 0; width: 36px; height: calc(var(--h-sm) + var(--s-2) * 2 + var(--s-1) * 2); pointer-events: none; background: linear-gradient(to right, transparent, var(--bg)); }
}
@media (min-width: 1080px) {
  .layout { grid-template-columns: minmax(0, 1fr) 300px; grid-template-areas: "head side" "body side"; }
  .layout__side { position: sticky; top: calc(var(--header-h) + var(--s-4)); align-self: start; display: grid; gap: var(--s-3); }
  .side__length { margin-bottom: 0; }
  .side__acts { display: grid; gap: var(--s-2); }
  .dock { display: none; }
}
/* 分段控制預設是 inline-flex，會照內容撐寬、自己永遠不捲；外層又把超出的部分裁掉，窄螢幕右邊的分頁就點不到。
   這裡改成跟容器同寬、可以橫向滑動，每格不壓縮 */
.tabs { display: flex; max-width: 100%; padding: var(--s-1); overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.tabs .seg__item { flex: none; scroll-margin-inline: var(--s-1); }
.pane { padding: var(--s-4); margin-bottom: var(--s-4); }
.pane .field:last-child { margin-bottom: 0; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
.small { font-size: 12px; word-break: break-all; }
.art { max-width: 200px; border-radius: var(--r-md); }
.art--share { max-width: 320px; }
.tags { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--s-2); }
.text { margin: 0; padding: var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.text + .text { margin-top: var(--s-2); }
.turns { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.turn { display: grid; gap: 4px; }
.turn__who { font-size: 12px; font-weight: 600; color: var(--text-3); }
.turn--ai .turn__who { color: var(--accent-text); }
.book__sum { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; cursor: pointer; padding: var(--s-2) 0; }
.book[open] > .book__sum { margin-bottom: var(--s-2); border-bottom: 1px solid var(--line); }
.entry { padding: var(--s-3) 0; border-top: 1px solid var(--line); }
.entry:first-of-type { border-top: 0; }
.entry > summary { cursor: pointer; }
.chip--off { opacity: 0.55; text-decoration: line-through; }
.entry--off { opacity: 0.6; }
.entry__head { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; margin-bottom: var(--s-2); }
.entry__body { margin: 0; padding: var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
.opening-frame { display: block; width: 100%; height: 320px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface-2); }
.opening-source { margin-top: var(--s-2); }
.opening-source > summary { cursor: pointer; font-size: 13px; color: var(--text-2); padding: var(--s-1) 0; }
.opening-source[open] > summary { margin-bottom: var(--s-2); }
.opening-ref { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); margin-top: var(--s-3); }
.opening-ref__link { min-height: var(--h-sm); padding: 0; border: 0; background: transparent; font: inherit; color: var(--accent-text); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.length-values { display:flex; flex-wrap:wrap; gap:var(--s-2) var(--s-4); font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
:lang(ko) .length-values { word-break:keep-all; }
/* 達標與否一眼分得出：未達標用跟清單字數 chip 同一個警示色，達標用成功色；狀態仍是文字 */
.length-status { padding: 0 var(--s-2); border-radius: var(--r-sm); }
.length-status--short { color: var(--warning-text); background: color-mix(in srgb, var(--warning-text) 12%, var(--surface)); }
.length-status--ok { color: var(--success); background: var(--success-soft); }
.cost { display: grid; grid-template-columns: auto 1fr; gap: var(--s-2) var(--s-4); margin: 0 0 var(--s-3); }
.cost dt { color: var(--text-3); font-size: 13px; }
.cost dd { margin: 0; font-variant-numeric: tabular-nums; }
/* 捲到決定區時要避開黏著的頁首與分頁條 */
.verdict { padding: var(--s-4); display: grid; gap: var(--s-3); scroll-margin-top: calc(var(--header-h) + var(--tabs-bar-h, 0px) + var(--s-3)); }
.verdict__title { margin: 0; font-size: 16px; }
/* 標題只在送出後被程式聚焦（讓讀屏器知道結果出來了），不在 Tab 順序裡：不畫鍵盤焦點環 */
.verdict__title:focus { outline: none; }
.verdict__acts { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: var(--s-2); }
.verdict > .field, .verdict .records { margin-bottom: 0; }
.verdict .small-note { margin: var(--s-2) 0 0; }
.verdict .reasons { margin-bottom: 0; }
.verdict__back { margin-right: auto; min-height: var(--h-md); padding-inline-start: 0; }
.verdict__btn { min-width: 112px; }
/* 手機：「回去看內容」自己一行，兩個決定（或結果卡的兩個去處）並排平分；放不下時各佔一行，不截字 */
@media (max-width: 600px) {
  .verdict__back { flex: 1 1 100%; margin-right: 0; justify-content: flex-start; }
  .verdict__acts > .btn--lg { flex: 1 1 0; min-width: max-content; }
}
.hold { display: grid; gap: var(--s-2); justify-items: start; margin-top: var(--s-3); padding: var(--s-3); border-radius: var(--r-md); color: var(--warning-text); background: color-mix(in srgb, var(--warning-text) 10%, var(--surface)); min-width: 0; }
.hold__text, .hold__time { margin: 0; overflow-wrap: anywhere; }
.hold__time { color: var(--text-2); font-size: 13px; }
.hold__reason { width: 100%; margin: 0; color: var(--text); }
.hold__error { margin: 0; }
.hold__release { min-height: var(--h-md); }
/* 手機：解凍是這一格唯一的動作，照觸控主行動 44 */
@media (max-width: 600px) { .hold__release { min-height: var(--h-lg); } }
.reopen { display: grid; gap: var(--s-2); justify-items: start; margin-top: var(--s-3); padding: var(--s-3); border-radius: var(--r-md); background: var(--accent-tint); min-width: 0; }
.reopen__text { margin: 0; font-weight: 600; color: var(--accent-text); }
.reopen__reason { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.reopen__withdraw { width: 100%; margin: 0; }
.reopen__action { min-height: var(--h-md); }
@media (max-width: 600px) { .reopen__action { min-height: var(--h-lg); } }
.hold-entry { display: grid; gap: var(--s-2); justify-items: start; margin-bottom: 0; }
.hold-entry .small-note { margin: 0; }
.blocked { color: var(--warning-text); background: color-mix(in srgb, var(--warning-text) 10%, var(--surface)); margin: 0; }
.reasons__label { margin: 0 0 var(--s-2); font-size: 14px; font-weight: 600; }
.reasons { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-bottom: var(--s-2); }
/* 可點的 chip：點擊區至少 30（DESIGN 點擊區分級），有 hover 與焦點樣式 */
.reason { min-height: var(--h-sm); padding-inline: var(--s-3); border: 0; font: inherit; font-size: 13px; color: inherit; cursor: pointer; }
.reason:hover:not(:disabled) { background: var(--border); }
.reason:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.reason:disabled { opacity: 0.55; cursor: default; }
.result__mine, .result__now { margin: 0; }
.blocked-note { color: var(--warning-text); }
.result__now { font-weight: 600; }
.tags-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.tags-acts { display: flex; justify-content: flex-end; gap: var(--s-2); }
.chip__x { border: 0; background: none; color: inherit; font: inherit; line-height: 1; padding: 0 0 0 2px; cursor: pointer; }
.records { display: grid; gap: var(--s-2); }
.records__title { margin: 0; }
.records__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.record { display: grid; gap: var(--s-1); min-width: 0; }
.record__head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); font-size: 13px; }
.record__note { max-height: 240px; overflow-y: auto; font-size: 13px; }
.chip--reject { background: color-mix(in srgb, var(--danger) 12%, var(--surface)); color: var(--danger); }
.rating { margin: 6px 0 0; font-size: 13px; color: var(--text-2); display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.answers { display: grid; grid-template-columns: max-content 1fr; gap: 10px var(--s-4); margin: 0; font-size: 14px; line-height: 1.5; }
.answers dt { color: var(--text-2); }
.answers dd { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
@media (max-width: 480px) { .answers { grid-template-columns: 1fr; gap: 4px; } .answers dd { margin-bottom: 8px; } }
.detail-ghost { height: 60vh; border-radius: var(--r-md); }
.originality-ghost { height: 120px; border-radius: var(--r-md); }
.score { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-2) var(--s-3); margin-bottom: var(--s-2); }
.score__value { font-size: 32px; font-variant-numeric: tabular-nums; }
.score__label { font-weight: 600; }
.small-note { font-size: 13px; margin: 0 0 var(--s-3); }
.sources { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.sources li { display: flex; align-items: center; gap: var(--s-2); }
.source { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); padding: var(--s-2) var(--s-3); border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.source--on { border-color: var(--accent); background: var(--surface-2); }
.source__name { font-weight: 600; overflow-wrap: anywhere; }
.source__pct { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; }
.source__open { flex: none; font-size: 13px; }
.marked { display: block; }
.hit { display: inline; background: color-mix(in srgb, var(--accent) 30%, transparent); color: inherit; border-radius: 2px; }
</style>
