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
 *   - 字數未達標時「通過」不能按（伺服器同樣拒絕）。駁回理由改成結構化代碼（審卡 V2，見決定區的說明）。
 *   - 送出後決定區換成結果卡（我的決定、目前結果、下一張），重新整理或回頭看也是同一張。
 *
 * AI 為主、人為輔（ui-ai-first.md v25，取代兩段式盲審）：作者區下方是「AI 審卡」區塊，決定區預設就是 AI 的建議，
 * 照 AI 或改了再定案都是一步。不受理、冷凍、重新審核、改判單照舊。
 */
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import {formatReviewLength} from "@/lib/review-length";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, claimReview, dropReview, restoreReview, fetchReviewDetail, fetchReviewOriginality, fetchReviewQueue, type ReviewQueueItem, releaseReview, stampReview, holdReview, unholdReview, withdrawReopen, correctReviewDecision, startReviewFlip, withdrawReviewFlip, updateReviewTags, type ReviewDetail, type ReviewOriginality, type ReviewAiState, type ReviewDecisionBody, type ReviewFinalSource } from "@/lib/api";
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
import ReviewAuthorProfile from '@/components/ReviewAuthorProfile.vue';
import ReviewReasonPicker from '@/components/ReviewReasonPicker.vue';
import ReviewTimeline from '@/components/ReviewTimeline.vue';
import ReviewDiffView from '@/components/ReviewDiffView.vue';
import ReviewAiNoteField from '@/components/ReviewAiNoteField.vue';
import ReviewAuthorNoteGuard from '@/components/ReviewAuthorNoteGuard.vue';
import ReviewVisibility from '@/components/ReviewVisibility.vue';
import { guardHits, type GuardHit } from '@/lib/author-note-guard';
import { fetchReviewAi, setAiInaccurate, type AiNoteType } from '@/lib/review-ai-api';
import { aiAsHuman, aiReasonCodes, aiStateOf, type AiView } from '@/lib/review-ai';
import { REVIEW_REASONS, reasonKey } from '@/lib/review-reasons';
import { REVIEW_DECISION_MARKS } from '../../../shared/review-reasons';
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
watch(id,()=>{cancelOwnedConfirm();data.value=null;note.value='';choice.value=null;reasonPicks.value=[];decisionMarks.value=[];suggestOpen.value=false;suggestPicks.value=[];coaching.value=null;dropDone.value=false;sectionChosen=false;done.value='';originality.value=null;originalityError.value='';picked.value=null;editingTags.value=false;draftTags.value=[];tagsError.value='';correctionOpen.value=false;correctionNote.value='';flipOpen.value=route.query.flip==='1';flipReason.value='';flipError.value='';flipDone.value=null;flipOperation=crypto.randomUUID();claimNote.value='';holdReason.value='';holdReasonOpen.value=false;holdError.value='';withdrawOpen.value=false;withdrawReason.value='';withdrawError.value='';changesOpened.value=false;autoClaimed=false;resetAi();finalSourceDone.value=null;decideError.value='';decideUnknown.value=false;nextItems.value=null;nextSwitched.value=null;nextError.value='';section.value='basic';void load();});
async function decisionConfirm(options:Parameters<typeof confirmDialog>[0]){
 const answer=confirmDialog(options);ownedConfirm=confirmState.current;
 try{return await answer;}finally{ownedConfirm=null;}
}
function summary(name:string,submittedAt:number,verdict:string,reason:string,reasonKey='review.confirm.note'){
 const row=(label:string,value:string)=>t('review.confirm.row',{label,value});
 return [row(t('review.confirm.card'),name),row(t('review.confirm.version'),dateTime(submittedAt)),row(t('review.confirm.decision'),verdict),row(t(reasonKey),reason||t('review.confirm.noNote'))].join('\n');
}
type Section = "changes" | "basic" | "rating" | "persona" | "originality" | "dialogue" | "worldbook" | "display" | "cost" | "history";
const section = ref<Section>("basic");
const READ_SECTIONS: readonly Section[] = ["basic", "rating", "persona", "originality", "dialogue", "worldbook", "display", "cost", "history"];
const REVIEW_SECTIONS: readonly string[] = ["changes", "rating", "originality", "display", "cost", "history"];
/**
 * 「更新內容」（審卡 V2 第二批）：只給待審中的更新與駁回後重送（伺服器明說的 type）。
 * 重新審核審的是現行公開版，沒有基準；首次送審也沒有。定案後差異讀不到（410），也不給。
 */
const hasChanges = computed(() => {
  const s = data.value?.submission;
  return !!s && s.status === "pending" && (s.type === "update" || s.type === "resubmit");
});
const SECTIONS = computed<readonly Section[]>(() => (hasChanges.value ? ["changes", ...READ_SECTIONS] : READ_SECTIONS));
/** 第一次切到「更新內容」才掛上差異元件（才去讀），之後切走也留著，不重讀 */
const changesOpened = ref(false);
watch(section, (s) => { if (s === "changes") changesOpened.value = true; }, { flush: "sync" });
/* 定案後這一格就沒了：停在上面的人回到基本資料，不留一個空白頁 */
watch(hasChanges, (shown) => { if (!shown && section.value === "changes") section.value = "basic"; });

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
const sectionLabel = (s: Section) => {
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
// 改判單由發起人一人處理，不冷凍討論（伺服器也擋）
const canHold = computed(() => claimedByMe.value && !stampedByMe.value && !decided.value && !hold.value && !data.value?.submission.flip);
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
/**
 * 駁回改判為通過（ui-flip-approve.md v20，限管理員）。這張是改判單：頂端說明、決定只有通過與撤回改判；
 * 這張是可改判的駁回單：結果卡多一塊「改判為通過」表單（從清單帶 ?flip=1 進來就直接展開）。
 */
const flip = computed(() => data.value?.submission.flip ?? null);
const flipState = computed(() => data.value?.submission.flipState ?? null);
const flipOpen = ref(route.query.flip === "1");
const flipReason = ref("");
const flipError = ref("");
const flipDone = ref<string | null>(null);
/** 同一次表單的冪等鍵：網路中斷後重按回到同一張改判單 */
let flipOperation = crypto.randomUUID();
const FLIP_REASON_MAX = 500;
const rejectNote = computed(() => data.value?.submission.stamps.find((s) => s.verdict === "reject")?.note ?? "");
const reasonNames = (codes: string[]) => codes.map((c) => t(reasonKey(c, "name"))).join(" · ");

/**
 * 審卡 V2 決定區（ui.md §2.3）：一個「你的決定」、三個選項都不預選（通過｜駁回｜不受理），選了才展開。
 * 駁回改成結構化理由（可多選、至少一項、「其他」要補充），作者看到的改法與範例由理由帶出，審核員不必再手打。
 * 有效字數未達標時「有效字數不足」自動勾選且不能取消（伺服器也會補上）。不受理不必先領取、不跳確認。
 * 重新審核單只有「維持通過」與「駁回（管理員，走改判、要寫說明）」，沒有理由選擇器也不能不受理。
 */
const choice = ref<"approve" | "reject" | "drop" | null>(null);
const reasonPicks = ref<string[]>([]);
/** 審核標記（只給審核員與數據；任何決定都能標） */
const decisionMarks = ref<string[]>([]);
/** 通過並附改進建議（owner 2026-11-23）：選了通過才有，預設收合；作者端一律看輔導版改法 */
const suggestOpen = ref(false);
const suggestPicks = ref<string[]>([]);
const suggestions = computed(() => (choice.value === "approve" && !reopen.value && suggestOpen.value ? REVIEW_REASONS.filter((c) => suggestPicks.value.includes(c)) : []));
const suggestNoteMissing = computed(() => suggestions.value.includes("other") && !note.value.trim());
/** 輔導（附完整改法與範例）：作者是新人時預設開，可改回一般；null＝照預設 */
const coaching = ref<boolean | null>(null);
const coachingDefault = computed(() => data.value?.authorProfile?.tier === "new");
const coachingOn = computed(() => coaching.value ?? coachingDefault.value);
const lengthForced = computed(() => approveBlocked.value);
const pickedReasons = computed(() => {
  const set = new Set(reasonPicks.value);
  if (lengthForced.value) set.add("content.min_length");
  return REVIEW_REASONS.filter((c) => set.has(c));
});
const noteField = ref<HTMLTextAreaElement | null>(null);
const noteFocused = ref(false);
/** 說明上限（與伺服器 REVIEW_NOTE_MAX 同一個數） */
const NOTE_MAX = 2000;
const noteRequired = computed(() => reopen.value || pickedReasons.value.includes("other"));
const rejectReady = computed(() => reopen.value ? !!note.value.trim() : pickedReasons.value.length > 0 && (!noteRequired.value || !!note.value.trim()));
/** 不受理：剛移出（結果卡）與從不受理清單點進來看（唯讀） */
const dropDone = ref(false);
const dropped = computed(() => !!data.value?.dropped || dropDone.value);
let sectionChosen = false;
/** 快速審：作者是優質、沒有疑似量產旗標、還在待審。只是先給重點，不自動通過 */
const fastReview = computed(() => !decided.value && !reopen.value && data.value?.authorProfile?.tier === "top" && !data.value.authorProfile.batchSuspected);
const keyChecksOpen = ref(false);

// ---- AI 為主、人為輔（ui-ai-first.md v25，owner 2026-11-25 結束雙盲） ----
/**
 * 待審的一般單（不是重新審核、不是改判單）：進來就讀 AI 的建議，畫在作者區下方的「AI 審卡」區塊；
 * 決定區預設就是 AI 的建議（那一項預選、駁回時理由勾好、給作者的說明預填 AI 草稿）。沒改就是「照 AI 定案」（finalSource ai），
 * 改了任何一處記為「改了 AI 的建議」（modified）；AI 還沒審或沒有建議時照一般流程（human_no_ai）。
 * 只有「AI 建議駁回、定案通過」（會讓卡上架的覆寫）跳確認。AI 晚到不動審核員已填的內容，只提示可以套用。
 */
const aiFirst = computed(() => !!data.value && data.value.submission.status === 'pending' && !reopen.value && !flip.value);
/** AI 那一邊：null＝還沒讀到 */
const aiState = ref<ReviewAiState | null>(null);
const aiLoadFailed = ref(false);
const aiBusy = ref(false);
const aiSuggestion = computed(() => aiState.value?.suggestion ?? null);
const aiView = computed<AiView>(() => {
  const s = aiState.value;
  if (!s) return aiLoadFailed.value ? 'error' : 'loading';
  if (s.state === 'pending' || s.state === 'handoff') return s.state;
  return s.state === 'ready' && aiAsHuman(s.suggestion.verdict) ? 'ready' : 'none';
});
const aiVerdict = computed(() => (aiView.value === 'ready' ? aiAsHuman(aiSuggestion.value!.verdict) : null));
const aiReasons = computed(() => (aiView.value === 'ready' && aiSuggestion.value ? aiReasonCodes(aiSuggestion.value) : []));
/** 伺服器照 AI 定案時蓋的內容：結論、正式理由代碼、給作者的說明（AI 草稿）；不帶輔導、不附建議 */
const aiBase = computed(() => {
  const s = aiSuggestion.value, v = aiVerdict.value;
  if (!s || !v) return null;
  return { verdict: v, reasons: v === 'reject' ? aiReasons.value : [], note: v === 'reject' ? (s.authorNote ?? '').trim() : '' };
});
const sameAi = (r: { id: string; at: number } | null, s: { id: string; at: number } | null) => !!r && !!s && r.id === s.id && r.at === s.at;
/** 決定區目前套用的那一筆 AI 建議；先不套用的那一筆 */
const aiApplied = ref<{ id: string; at: number } | null>(null);
const aiDismissed = ref<{ id: string; at: number } | null>(null);
/** 「AI 判斷不準確」：選填，定案前跟著定案送出、定案後在結果卡上按下就寫入；不影響這張卡的結果 */
const aiInaccurate = ref(false);
const aiMarkBusy = ref(false);
const aiMarkError = ref('');
/** 給 AI 的說明（選填，跟著定案送出，不給作者看） */
const aiNoteTypes = ref<AiNoteType[]>([]);
const aiNote = ref('');
/**
 * 給作者看的說明命中內部字詞（400 author_note_internal）：沒有送出，字都留著。錯誤區放在那個欄位上方——
 * note＝駁回時給作者的說明、suggest＝通過附建議的補充；top＝畫面上沒有對應欄位時放在決定區頂端。下次送出時清掉。
 */
type GuardAt = 'note' | 'suggest' | 'top';
const noteGuard = ref<{ at: GuardAt; hits: GuardHit[]; final: boolean } | null>(null);
/** 剛定案時伺服器回的來源；重新讀詳情後以我那一章的 finalSource 為準 */
const finalSourceDone = ref<ReviewFinalSource | null>(null);
function resetAi() {
  aiState.value = null; aiLoadFailed.value = false; aiBusy.value = false; aiApplied.value = null; aiDismissed.value = null;
  aiInaccurate.value = false; aiMarkBusy.value = false; aiMarkError.value = ''; aiNoteTypes.value = []; aiNote.value = ''; noteGuard.value = null;
}
/** 審核員動過決定區（選了結論、勾了理由、寫了字）：AI 晚到時不覆蓋 */
const formTouched = computed(() => choice.value !== null || reasonPicks.value.length > 0 || !!note.value.trim() || suggestPicks.value.length > 0);
/** 把 AI 的建議帶進決定區。AI 建議通過、而這一版字數未達標（通過按不下去）時不預選 */
function applyAi() {
  const s = aiSuggestion.value, b = aiBase.value;
  if (!s || !b) return;
  choice.value = b.verdict === 'approve' && approveBlocked.value ? null : b.verdict;
  reasonPicks.value = [...b.reasons];
  note.value = b.verdict === 'reject' ? s.authorNote ?? '' : '';
  suggestOpen.value = false; suggestPicks.value = []; coaching.value = false;
  aiApplied.value = { id: s.id, at: s.at }; aiDismissed.value = null; noteGuard.value = null;
}
function dismissAi() { const s = aiSuggestion.value; if (s) aiDismissed.value = { id: s.id, at: s.at }; }
// AI 建議駁回、說明欄預填了駁回草稿，審核員改成通過：草稿不能變成給作者的通過補充說明，清掉（改過的就留著）
watch(choice, (c) => {
  const b = aiBase.value;
  if (c === 'approve' && b?.verdict === 'reject' && aiSuggestion.value?.authorNote && note.value.trim() === aiSuggestion.value.authorNote.trim()) note.value = '';
});
// AI 的建議到了而決定區還沒人動：直接帶入；已經動過就留給「套用 AI 的建議」
watch(aiBase, (b) => {
  if (!b || !aiFirst.value || aiApplied.value || formTouched.value) return;
  applyAi();
}, { immediate: true });
/** AI 剛審完（或重判）而決定區已有審核員填的內容：提示可以套用 */
const aiLate = computed(() => aiFirst.value && !!aiBase.value && !sameAi(aiApplied.value, aiSuggestion.value) && !sameAi(aiDismissed.value, aiSuggestion.value) && (!!aiApplied.value || formTouched.value));
/** 決定區跟 AI 的建議比，改了哪些（null＝沒有 AI 建議可比，或還沒選通過／駁回） */
const aiChanges = computed<string[] | null>(() => {
  const b = aiBase.value, c = choice.value;
  if (!b || (c !== 'approve' && c !== 'reject')) return null;
  const sep = /^(en|ko)/.test(String(locale.value)) ? ', ' : '、';
  const names = (codes: string[]) => codes.map((x) => t(reasonKey(x, 'name'))).join(sep);
  const out: string[] = [];
  if (c !== b.verdict) out.push(t('reviewAi.first.change.verdict', { verdict: t(`review.action.${c}`) }));
  if (c === 'reject') {
    // 字數未達標時自動帶上的「有效字數不足」不算修改：照 AI 定案時伺服器同樣會補上
    const added = pickedReasons.value.filter((x) => !b.reasons.includes(x) && !(lengthForced.value && x === 'content.min_length'));
    const removed = b.reasons.filter((x) => !pickedReasons.value.includes(x));
    if (added.length) out.push(t('reviewAi.first.change.added', { names: names(added) }));
    if (removed.length) out.push(t('reviewAi.first.change.removed', { names: names(removed) }));
    if (note.value.trim() !== b.note) out.push(t('reviewAi.first.change.note'));
    if (coachingOn.value) out.push(t('reviewAi.first.change.coaching'));
  } else if (suggestions.value.length) out.push(t('reviewAi.first.change.suggestions'));
  return out;
});
/** 這次定案記成什麼 */
const decideSource = computed<ReviewFinalSource>(() => (aiBase.value ? (aiChanges.value?.length === 0 ? 'ai' : 'modified') : 'human_no_ai'));
/** 結果卡的來源 chip：詳情裡我那一章記下的來源；剛定案、還沒重讀時用蓋章回應的 */
const resultSource = computed<ReviewFinalSource | null>(() => myStamp.value?.finalSource ?? (myStamp.value ? finalSourceDone.value : null));
/** 給作者的說明欄現在是 AI 的草稿帶進來的（照 AI 駁回時預填）：說明句先講可以直接改 */
const noteFromAi = computed(() => aiFirst.value && !!aiApplied.value && aiBase.value?.verdict === 'reject' && !!aiBase.value.note && !!note.value.trim());
/**
 * 定案後仍可標「AI 判斷不準確」（ui-ai-first.md：可在定案前後標）：我定的、而且當時有 AI 的建議可對照（照 AI／改了 AI）。
 * 管理員看別人定的單不在這裡標（伺服器允許，畫面先只給定案的人）。
 */
const aiMarkable = computed(() => decided.value && !!myStamp.value && (resultSource.value === 'ai' || resultSource.value === 'modified'));
async function toggleInaccurate() {
  if (aiMarkBusy.value) return;
  const target = id.value, next = !aiInaccurate.value;
  aiMarkBusy.value = true; aiMarkError.value = ''; aiInaccurate.value = next;
  try {
    const res = await setAiInaccurate(target, await token(), next);
    if (!active || target !== id.value) return;
    aiInaccurate.value = res.inaccurate;
  } catch {
    if (!active || target !== id.value) return;
    // 沒寫進去：切換鈕回到原本的狀態，說一句再按一次
    aiInaccurate.value = !next; aiMarkError.value = t('reviewV2.toast.failed');
  } finally {
    if (target === id.value) aiMarkBusy.value = false;
  }
}
/** 已定案、而保留期已過（伺服器回 null）：內容只剩公開資料。舊版伺服器不帶這個欄位，照舊顯示 */
const retentionExpired = computed(() => decided.value && data.value?.retainUntil === null);

/** 讀 AI 的建議（進來時、輪詢、再試一次）。讀不到不擋審核：照一般流程決定 */
async function refreshAi(manual = false) {
  const target = id.value;
  if (manual) { aiBusy.value = true; aiLoadFailed.value = false; }
  try {
    const res = await fetchReviewAi(target, await token());
    if (!active || target !== id.value) return;
    aiState.value = aiStateOf(res.suggestions, res.current);
    // 已定案：切換鈕照伺服器記下的標；待審時是本頁還沒送出的選擇，不覆蓋
    if (aiMarkable.value) aiInaccurate.value = res.inaccurate === true;
    aiLoadFailed.value = false;
  } catch {
    if (!active || target !== id.value) return;
    // 輪詢失敗不打斷：下一次再讀；還沒讀到過才顯示讀不到
    if (!aiState.value) aiLoadFailed.value = true;
  } finally {
    if (manual && target === id.value) aiBusy.value = false;
  }
}
/** AI 還沒審完：每 10 秒重讀一次，沒有上限（PM 2026-11-24） */
const AI_POLL_MS = 10_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
function stopAiPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
watch(() => aiFirst.value && !stampedByMe.value && aiView.value === 'pending', (on) => {
  stopAiPoll();
  if (on) pollTimer = setInterval(() => void refreshAi(), AI_POLL_MS);
}, { immediate: true });
onBeforeUnmount(stopAiPoll);

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
/**
 * 「下一張」留在同一個分頁（owner 2026-11-23）：審更新就一直拿更新，審新卡就一直拿新卡，順序跟那一頁一樣
 * （快速審在前）；那一頁審完了才換另一頁，並說一聲。不受理清單與我處理過的不參與。
 */
const nextSwitched = ref<"new" | "updates" | null>(null);
async function loadNext() {
  try {
    const tok = await token();
    const from: "new" | "updates" = submissionType.value === "first" ? "new" : "updates";
    const pick = async (tab: "new" | "updates") => {
      const q = await fetchReviewQueue(tok, String(locale.value), tab);
      // 冷凍中的卡不能決定，「下一張」不帶人過去
      const open = q.items.filter((i) => i.id !== id.value && !i.stampedByMe && !i.hold && !skipped.has(i.id));
      return [...open.filter((i) => i.claim === "mine"), ...open.filter((i) => i.claim === "free")];
    };
    let items = await pick(from);
    nextSwitched.value = null;
    if (!items.length) {
      const other = from === "new" ? "updates" : "new";
      items = await pick(other);
      if (items.length) nextSwitched.value = other;
    }
    nextItems.value = items;
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
    // AI 為主：待審的一般單進來就讀 AI 的建議（讀過就不重讀，AI 還沒審完由輪詢接手）；
    // 回頭看我定的單也讀一次，結果卡上的「AI 判斷不準確」要照記下的狀態
    if((aiFirst.value||aiMarkable.value)&&!aiState.value&&!aiLoadFailed.value)void refreshAi();
    // 新卡預設先看開場白（最大的駁回原因，也最快看完）；之後使用者自己切的分頁不動
    // 更新與駁回後重送先看「這次改了什麼」
    if(!sectionChosen){sectionChosen=true;if(hasChanges.value)section.value='changes';else if(submissionTypeOf({ ...result.submission, reopen: !!result.submission.reopen })==='first')section.value='dialogue';}
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

/**
 * 重新審核（一步，沒有兩段式）：維持通過不動卡片；駁回限管理員，走改判（卡改回上一個通過的版本或下架），要寫說明。
 * 兩樣都先跳確認層。
 */
async function stampReopen(verdict: "approve" | "reject") {
  if(busy.value||!data.value||data.value.submission.id!==id.value||!reopen.value)return;
  if (hold.value) return;
  if (verdict === "reject" && rejectLocked.value) return;
  if (!claimedByMe.value) {
    error.value = t("review.claimFirst");
    return;
  }
  error.value = "";
  decideError.value = "";
  decideUnknown.value = false;
  noteGuard.value = null;
  const built = decisionBody(verdict);
  if ('error' in built) { decideError.value = built.error; return; }
  const target=id.value,review=data.value,generation=review.submission.claimGeneration,keep=verdict==='approve';
  busy.value = true;
  try {
    const confirmedToken=await token();
    if(!await decisionConfirm({scrollMessage:true,title:t(keep?'review.reopen.keepTitle':'review.confirm.rejectTitle'),message:summary(review.detail.document.roleName,review.submission.submittedAt,t(keep?'review.action.keep':'review.action.reject'),built.body.note??'')+'\n\n'+t(keep?'review.reopen.keepBody':'review.reopen.rejectBody'),confirmText:t(keep?'review.action.keep':'review.confirm.rejectSubmit'),cancelText:t('review.confirm.back'),focusCancel:true,danger:!keep,dangerAppearance:'subdued'}))return;
    if(!active||id.value!==target||data.value!==review)return;
    if(await token()!==confirmedToken)throw new Error(t('auth.expired'));
    const res = await stampReview(target, confirmedToken, { ...built.body, generation });
    if(!active||id.value!==target)return;
    await settleStamp(target, res.status, { verdict, note: built.body.note ?? '' });
  } catch (err) {
    await explainDecideError(err, target, { at: verdict === 'reject' ? 'note' : 'top', final: false });
  } finally {
    busy.value = false;
  }
}

/** 蓋章成功：先在畫面上記下我的章，再重讀一次（結果卡要的是伺服器上的案件狀態，不是前端推算的） */
async function settleStamp(target: string, status: string, stamp: { verdict: "approve" | "reject"; note: string; finalSource?: ReviewFinalSource }) {
  if (!data.value) return;
  data.value.submission.status = status;
  data.value.submission.claimedByMe = false;
  data.value.submission.stampedByMe = true;
  data.value.submission.stamps.push({ ...stamp, at: Date.now(), mine: true });
  await load();
  if(!active||id.value!==target)return;
  await nextTick();
  decideSection.value?.scrollIntoView({ block: "start" });
  decideSection.value?.querySelector<HTMLElement>("[data-decide-title]")?.focus({ preventScroll: true });
}

/**
 * 定案失敗時說明，輸入都留著。AI 的 409 要先認出來，不能當成「領取變了」：
 * AI 剛重判（ai_changed）或照 AI 定案不成立（ai_choice_unavailable）→ 重讀 AI 的建議，「AI 審卡」區塊提示可以套用，決定區不動。
 */
async function explainDecideError(err: unknown, target: string, guard: { at: GuardAt; final: boolean } = { at: 'top', final: false }) {
    if(!active||id.value!==target)return;
    if (err instanceof ApiError && err.code === "author_note_internal" && err.noteInternal) {
      const hits = guardHits(err.noteInternal);
      // 錯誤區自己把焦點移到第一個命中項；欄位與選擇都不動
      if (hits.length) { noteGuard.value = { ...guard, hits }; return; }
    }
    if (err instanceof ApiError && (err.code === "ai_changed" || err.code === "ai_choice_unavailable")) {
      decideError.value = t("reviewAi.two.final.aiChanged");
      await refreshAi(true);
    } else if (err instanceof ApiError && err.code === "review_length_insufficient") {
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
    } else if (err instanceof ApiError && err.code === "review_dropped") {
      await load();
    } else if (err instanceof ApiError && (err.code === "review_reasons_required" || err.code === "review_reason_invalid")) {
      decideError.value = t("reviewV2.decide.pickReason");
    } else if (err instanceof ApiError && err.code === "review_other_needs_note") {
      decideError.value = t("reviewV2.decide.otherNeedsNote");
    } else if (err instanceof ApiError && err.status === 409) decideError.value = t("review.claimChanged");
    else if (err instanceof ApiError) decideError.value = t("review.decide.failed");
    else if (err instanceof Error && err.message === t("auth.expired")) decideError.value = err.message;
    else decideUnknown.value = true;
    await nextTick();
    decideErrorEl.value?.focus({ preventScroll: true });
    decideErrorEl.value?.scrollIntoView({ block: "nearest" });
}

/** 第一步、通過與駁回共用：組出決定的內容；缺理由或說明時回傳要顯示的錯誤 */
function decisionBody(verdict: "approve" | "reject"): { body: ReviewDecisionBody } | { error: string } {
  // 說明欄只在選「駁回」時出現：改選通過時，之前打在駁回裡的字不能跟著送出；通過附建議時，補充說明跟著建議一起給作者
  const reason = verdict === 'reject' || (verdict === 'approve' && suggestions.value.length) ? note.value : '';
  const suggest = verdict === 'approve' ? [...suggestions.value] : [];
  if (suggest.length && suggestNoteMissing.value) return { error: t('reviewV2.decide.otherNeedsNote') };
  if (verdict === 'reject' && !rejectReady.value) return { error: t(reopen.value || pickedReasons.value.length ? 'reviewV2.decide.otherNeedsNote' : 'reviewV2.decide.pickReason') };
  const codes = verdict === 'reject' && !reopen.value ? pickedReasons.value : undefined;
  return { body: { verdict, note: reason, ...(codes ? { reasons: [...codes], coaching: coachingOn.value } : {}), ...(decisionMarks.value.length ? { marks: [...decisionMarks.value] } : {}), ...(suggest.length ? { suggestions: suggest } : {}) } };
}

/**
 * 通過與駁回（一般待審單）：一步定案。來源見 decideSource：照 AI（沒改）／改了 AI／無 AI 對照。
 * 照 AI 時伺服器蓋 AI 那一筆的內容，只帶審核標記（標記要跟著結論送，伺服器才收）；其他兩種帶這次的決定。
 * 只有「AI 建議駁回、定案通過」跳確認（會讓卡上架的覆寫），其他一律直接定案。
 */
async function decide(verdict: "approve" | "reject") {
  const review = data.value;
  if (busy.value || !review || review.submission.id !== id.value || hold.value || reopen.value) return;
  if (!claimedByMe.value) { error.value = t("review.claimFirst"); return; }
  if (verdict === "approve" && approveBlocked.value) return;
  decideError.value = ""; decideUnknown.value = false; error.value = ""; noteGuard.value = null;
  const built = decisionBody(verdict);
  if ('error' in built) { decideError.value = built.error; return; }
  const source = decideSource.value;
  // 帶畫面上那一筆：AI 在這之間重判過，伺服器回 ai_changed，不會蓋成沒看過的結論
  const shown = aiBase.value ? aiSuggestion.value : null;
  const target = id.value, generation = review.submission.claimGeneration;
  busy.value = true;
  try {
    const confirmedToken = await token();
    if (shown && aiVerdict.value === 'reject' && verdict === 'approve') {
      const row = (label: string, value: string) => t('review.confirm.row', { label, value });
      const message = [
        row(t('review.confirm.card'), review.detail.document.roleName),
        row(t('review.confirm.version'), dateTime(review.submission.submittedAt)),
        row(t('reviewAi.first.confirm.ai'), t('review.action.reject')),
        row(t('reviewAi.first.confirm.final'), t('review.action.approve')),
      ].join('\n') + '\n\n' + t('reviewAi.first.confirm.body');
      if (!await decisionConfirm({ scrollMessage: true, title: t('reviewAi.first.confirm.title'), message, confirmText: t('reviewAi.first.confirm.submit'), cancelText: t('reviewAi.two.confirm.back'), focusCancel: true })) return;
      if (!active || id.value !== target || data.value !== review) return;
      if (await token() !== confirmedToken) throw new Error(t('auth.expired'));
    }
    const marks = built.body.marks ?? [];
    const body = source === 'ai' ? (marks.length ? { verdict, marks } : {}) : built.body;
    const types = [...aiNoteTypes.value], text = aiNote.value.trim();
    const res = await stampReview(target, confirmedToken, {
      generation, finalSource: source, ...body,
      ...(shown ? { aiSuggestionId: shown.id, aiSuggestionAt: shown.at } : {}),
      ...(types.length ? { aiNoteTypes: types } : {}), ...(text ? { aiNote: text } : {}),
      ...(aiInaccurate.value && aiView.value === 'ready' ? { aiInaccurate: true } : {}),
    });
    if (!active || id.value !== target) return;
    const recorded = res.finalSource ?? source;
    finalSourceDone.value = recorded;
    await settleStamp(target, res.status, { verdict, note: source === 'ai' ? aiBase.value?.note ?? '' : built.body.note ?? '', finalSource: recorded });
  } catch (err) {
    await explainDecideError(err, target, { at: verdict === 'approve' ? 'suggest' : 'note', final: true });
  } finally {
    busy.value = false;
  }
}

/** 不受理：不必領取、不寫理由、不跳確認；結果卡上可以復原 */
async function dropCard() {
  if (busy.value || !data.value || data.value.submission.id !== id.value) return;
  const target = id.value;
  busy.value = true; decideError.value = "";
  try {
    await dropReview(target, await token(), [...decisionMarks.value]);
    if (!active || id.value !== target) return;
    dropDone.value = true;
    if (data.value) data.value.submission.claimedByMe = false;
    void loadNext();
    await nextTick();
    decideSection.value?.querySelector<HTMLElement>("[data-decide-title]")?.focus({ preventScroll: true });
  } catch (err) {
    if (!active || id.value !== target) return;
    decideError.value = err instanceof ApiError && err.code === "claimed_by_other" ? t("reviewV2.menu.claimedByOther")
      : err instanceof ApiError && err.code === "review_held" ? t("reviewV2.menu.held")
      : err instanceof Error && err.message === t("auth.expired") ? err.message : t("reviewV2.decide.submitFailed");
  } finally { busy.value = false; }
}

async function restoreCard() {
  if (busy.value || !data.value) return;
  const target = id.value;
  busy.value = true; decideError.value = "";
  try {
    await restoreReview(target, await token());
    if (!active || id.value !== target) return;
    dropDone.value = false; choice.value = null;
    // 復原後回到預設：有 AI 的建議就再帶進來
    if (aiBase.value) applyAi();
    await load();
  } catch {
    if (active && id.value === target) decideError.value = t("reviewV2.toast.failed");
  } finally { busy.value = false; }
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

async function startFlip() {
  if (busy.value || !data.value || data.value.submission.id !== id.value || flipState.value?.supersededBy) return;
  const review = data.value, target = id.value, reason = flipReason.value.trim();
  if (!reason) { flipError.value = t("review.flipApprove.reasonRequired"); return; }
  busy.value = true; flipError.value = "";
  try {
    const confirmedToken = await token();
    const version = t("review.flipApprove.confirmVersion", { date: dateTime(review.submission.submittedAt) });
    const row = (label: string, value: string) => t("review.confirm.row", { label, value });
    const message = [row(t("review.confirm.card"), review.detail.document.roleName), row(t("review.confirm.version"), version), row(t("review.flipApprove.reasonLabel"), reason)].join("\n")
      + "\n\n" + ["review.flipApprove.effect1", "review.flipApprove.effect2", "review.flipApprove.effect3"].map((k, i) => `${i + 1}. ${t(k)}`).join("\n");
    if (!await decisionConfirm({ scrollMessage: true, title: t("review.flipApprove.confirmTitle"), message, confirmText: t("review.flipApprove.confirmSubmit"), cancelText: t("review.flipApprove.confirmCancel"), focusCancel: true })) return;
    if (!active || id.value !== target || data.value !== review) return;
    const result = await startReviewFlip(target, confirmedToken, { operationId: flipOperation, reason });
    if (!active || id.value !== target) return;
    flipDone.value = result.id; flipOpen.value = false; flipReason.value = "";
    await load();
  } catch (err) {
    if (!active || id.value !== target) return;
    // 作者剛改稿重送、別人剛建了改判單：重讀，表單會換成停用說明或改判審核中，不另外報錯
    const settled = err instanceof ApiError && (err.code === "review_flip_superseded" || err.code === "review_flip_exists");
    if (err instanceof ApiError && err.status === 409) await load();
    if (!settled) flipError.value = err instanceof Error ? err.message : t("state.actionFailed");
  } finally { busy.value = false; }
}

async function withdrawFlip() {
  if (busy.value || !data.value || !(flip.value?.mine || flip.value?.canTakeOver) || decided.value) return;
  const target = id.value;
  if (!await decisionConfirm({ title: t("review.flipApprove.withdrawConfirmTitle"), message: t("review.flipApprove.withdrawConfirmBody"), confirmText: t("review.flipApprove.withdrawAction"), cancelText: t("review.flipApprove.confirmCancel"), focusCancel: true, danger: true, dangerAppearance: "subdued" })) return;
  if (!active || id.value !== target) return;
  busy.value = true; decideError.value = "";
  try {
    await withdrawReviewFlip(target, await token());
    if (!active || id.value !== target) return;
    done.value = t("review.flipApprove.withdrawn");
    await load();
  } catch (err) {
    if (!active || id.value !== target) return;
    decideError.value = err instanceof Error ? err.message : t("state.actionFailed");
    if (err instanceof ApiError && err.status === 409) await load();
  } finally { busy.value = false; }
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
    <!-- 定案後的保留期（7 天，與 AI 不一致未仲裁最長 14 天）過了：只剩公開資料 -->
    <p v-if="retentionExpired" class="notice" role="status" data-retain-expired>{{ $t("review.retain.expired") }}</p>
    <p v-else-if="data?.detail.closed" class="notice" role="status">{{ $t("review.closedPartial") }}</p>
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
          <!-- 審卡 V2：作者標記與依據（只給審核員）；管理員從這裡開批次不受理 -->
          <ReviewAuthorProfile v-if="data.authorProfile" :submission-id="data.submission.id" :profile="data.authorProfile" :manager="manager"
            :can-mark="claimedByMe && !decided" @changed="data.authorProfile = $event" @batched="load" />
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
          <!-- 改判單：原本哪天駁回、理由、誰發起、為什麼；通過前作者看到的仍是未通過審核 -->
          <div v-if="flip" class="reopen" role="status" data-flip-notice>
            <p><span class="chip chip--flip">{{ $t("review.flipApprove.detailChip") }}</span></p>
            <p class="reopen__text">{{ $t("review.flipApprove.detailNotice", { rejectedAt: flip.rejectedAt ? dateTime(flip.rejectedAt) : "—", name: flip.by }) }}</p>
            <p class="subtle">{{ $t("review.flipApprove.detailOriginalRejection", { rejectedAt: flip.rejectedAt ? dateTime(flip.rejectedAt) : "—", reasons: reasonNames(flip.reasons) || $t("review.confirm.noNote") }) }}</p>
            <div v-if="flip.note" class="field"><p class="subtle records__title">{{ $t("review.flipApprove.originalNote") }}</p><p class="text reopen__reason">{{ flip.note }}</p></div>
            <p v-if="flip.reason" class="text reopen__reason" data-flip-reason>{{ $t("review.flipApprove.detailReason", { reason: flip.reason }) }}</p>
            <p v-if="!flip.mine && !flip.canTakeOver && !decided" class="notice" data-flip-readonly>{{ $t("review.flipApprove.onlyInitiator", { name: flip.by }) }}</p>
          </div>
        </div>
        <div class="head__acts">
          <button v-if="claimedByMe" class="btn btn--sm" :disabled="busy || decided" @click="release">{{ $t("review.action.release") }}</button>
          <button v-else-if="!stampedByMe && !dropped && !(flip && !flip.mine && !flip.canTakeOver)" class="btn btn--sm btn--primary" :disabled="busy || decided" @click="claim">{{ $t(hold ? "review.action.claimHeld" : "review.action.claim") }}</button>
        </div>
      </header>

      <!-- 快速審（優質作者、沒有疑似量產）：先給重點檢查，決定規則與一般卡完全相同，全文照樣在下面的分頁 -->
      <section v-if="fastReview" class="pane panel key-checks layout__checks" data-key-checks>
        <h3>{{ $t("reviewV2.fast.summaryTitle") }}</h3>
        <p class="text key-checks__opening" :class="{ 'key-checks__opening--clamp': !keyChecksOpen }">{{ data.detail.greetings?.welcome || "—" }}</p>
        <button type="button" class="btn btn--sm btn--ghost" :aria-expanded="keyChecksOpen" @click="keyChecksOpen = !keyChecksOpen">{{ keyChecksOpen ? $t("reviewV2.fast.collapse") : $t("reviewV2.fast.expand") }}</button>
        <ul class="key-checks__elements">
          <li>{{ $t("reviewV2.elements.scene") }}</li><li>{{ $t("reviewV2.elements.event") }}</li><li>{{ $t("reviewV2.elements.hook") }}</li>
        </ul>
        <dl class="key-checks__cells">
          <div><dt>{{ $t("reviewV2.fast.rating") }}</dt><dd><RatingMark v-if="data.submission.rating" :rating="data.submission.rating" variant="chip" /><template v-else>{{ $t("review.rating.sfw") }}</template></dd></div>
          <div><dt>{{ $t("reviewV2.fast.originality") }}</dt><dd>{{ originality?.available ? percent(originality.similarity) : $t("reviewV2.mark.unmeasured") }}</dd></div>
          <div><dt>{{ $t("reviewV2.fast.length") }}</dt><dd>{{ data.detail.reviewLength ? lengthParams.total : $t("reviewV2.mark.unmeasured") }}</dd></div>
        </dl>
        <p class="subtle">{{ $t("reviewV2.fast.entries", { n: data.features?.worldbookEntries ?? data.detail.costProfile?.worldbookEntryCount ?? 0 }) }}</p>
      </section>

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
      <!-- AI 審卡（ui-ai-first.md）：作者區下方、分頁之前。給作者的說明草稿不在這裡重複，直接帶進決定區 -->
      <section v-if="aiFirst" class="pane panel ai-first" aria-labelledby="ai-first-title" data-ai-first :data-ai-view="aiView">
        <h3 id="ai-first-title" class="ai-first__title">{{ $t("reviewAi.first.title") }}</h3>
        <div class="ai-first__live" aria-live="polite" :aria-busy="aiView === 'loading' ? 'true' : undefined">
          <div v-if="aiView === 'loading'" class="ghost ai-first__ghost" aria-hidden="true" />
          <template v-else-if="aiView === 'error'">
            <p class="ai-first__line" data-ai-error>{{ $t("reviewAi.first.error") }}</p>
            <button type="button" class="btn btn--sm ai-first__retry" :disabled="aiBusy" data-ai-retry @click="refreshAi(true)">{{ $t("reviewAi.two.none.retry") }}</button>
          </template>
          <p v-else-if="aiView === 'pending'" class="ai-first__line" data-ai-pending>{{ $t("reviewAi.first.pending") }}</p>
          <p v-else-if="aiView === 'none'" class="ai-first__line" data-ai-none>{{ $t("reviewAi.first.none") }}</p>
          <template v-else-if="aiSuggestion">
            <p v-if="aiView === 'handoff'" class="ai-first__chips">
              <span class="chip ai-first__chip" data-ai-handoff>{{ $t("reviewAi.first.verdict.handoff") }}</span>
            </p>
            <p v-else-if="aiVerdict" class="ai-first__chips">
              <span class="chip ai-first__chip" :class="aiVerdict === 'approve' ? 'ai-first__chip--pass' : 'ai-first__chip--reject'" :data-ai-verdict="aiSuggestion.verdict">{{ $t(`reviewAi.first.verdict.${aiSuggestion.verdict}`) }}</span>
              <span v-if="aiSuggestion.confidence !== null" class="chip ai-first__chip ai-first__chip--num" data-ai-confidence>{{ $t("reviewAi.reveal.confidence", { pct: new Intl.NumberFormat(String(locale), { style: "percent", maximumFractionDigits: 0 }).format(aiSuggestion.confidence) }) }}</span>
            </p>
            <ul v-if="aiReasons.length" class="ai-first__chips ai-first__list" data-ai-reasons>
              <li v-for="code in aiReasons" :key="code" class="chip ai-first__chip">{{ $t(reasonKey(code, "name")) }}</li>
            </ul>
            <section v-if="aiSuggestion.note" class="ai-first__internal" aria-labelledby="ai-first-internal" data-ai-internal>
              <div class="ai-first__internal-head">
                <h4 id="ai-first-internal" class="ai-first__internal-title">{{ $t("reviewAi.two.internalNote.title") }}</h4>
                <ReviewVisibility who="reviewers" />
              </div>
              <p class="ai-first__text" data-ai-internal-note>{{ aiSuggestion.note }}</p>
            </section>
          </template>
        </div>
        <!-- AI 剛審完（或重判）而決定區已經填了東西：不動審核員填的，套用才帶入 -->
        <div v-if="aiLate && aiVerdict" class="notice ai-first__late" role="status" data-ai-late>
          <p>{{ $t("reviewAi.first.late", { verdict: $t(`reviewAi.first.verdict.${aiVerdict === 'approve' ? 'pass' : 'reject'}`) }) }}</p>
          <div class="ai-first__late-acts">
            <button type="button" class="btn btn--sm btn--primary" :disabled="busy" data-ai-apply @click="applyAi">{{ $t("reviewAi.first.apply") }}</button>
            <button type="button" class="btn btn--sm btn--ghost" :disabled="busy" data-ai-dismiss @click="dismissAi">{{ $t("reviewAi.first.dismiss") }}</button>
          </div>
        </div>
        <!-- 「AI 判斷不準確」：給 AI 打分，跟照不照 AI 定案是兩件事，不影響這張卡的結果 -->
        <div v-if="aiView === 'ready'" class="ai-first__flag">
          <p class="subtle ai-first__flag-hint" data-ai-inaccurate-hint>{{ $t(aiInaccurate ? "reviewAi.first.inaccurateOn" : "reviewAi.first.inaccurateHint") }}</p>
          <button type="button" class="btn btn--sm ai-first__flag-btn" :class="{ 'ai-first__flag-btn--on': aiInaccurate }" :aria-pressed="aiInaccurate" :disabled="busy || stampedByMe" data-ai-inaccurate @click="aiInaccurate = !aiInaccurate">{{ $t("reviewAi.first.inaccurate") }}</button>
        </div>
      </section>
      <nav ref="tabsBar" class="tabs-bar" :aria-label="$t('review.read.tabs')">
        <div class="seg tabs">
          <!-- 八格都排在分頁條上、橫滑可達：審核員每張卡都會看「正則與版面」「成本側寫」（owner 2026-11-02），不收進「更多」 -->
          <button v-for="s in SECTIONS" :key="s" class="seg__item" :class="{ 'seg__item--on': section === s }" :aria-pressed="section === s" @focus="revealFocusedTab" @click="section = s; ($event.currentTarget as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' })">
            {{ sectionLabel(s) }}
          </button>
        </div>
      </nav>

      <!-- 更新內容（審卡 V2 第二批）：第一次切到這一格才讀，之後留著 -->
      <section v-if="hasChanges && changesOpened" v-show="section === 'changes'" class="pane panel" data-changes-pane>
        <ReviewDiffView :key="data.submission.id" :submission-id="data.submission.id" :previous-reasons="data.submission.previous?.status === 'rejected' ? data.submission.previous.reasons : undefined" />
      </section>
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

      <!-- 審核紀錄（審卡 V2 第二批）：第一次切到這一格才讀 -->
      <section v-if="section === 'history'" class="pane panel" data-history-pane>
        <ReviewTimeline :submission-id="data.submission.id" />
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
        <!-- 不受理中：剛移出的結果卡，或從不受理清單點進來的唯讀查看。復原後才能領取與決定 -->
        <template v-if="dropped && !decided">
          <h3 class="verdict__title" tabindex="-1" data-decide-title data-dropped-card>{{ dropDone ? $t("reviewV2.decide.resultDropped") : $t("reviewV2.dropped.title") }}</h3>
          <p v-if="!dropDone" class="notice" role="status">{{ $t("reviewV2.dropped.readonly") }}</p>
          <p v-if="decideError" class="notice notice--error" role="alert">{{ decideError }}</p>
          <p v-if="nextSwitched && nextItems?.length" class="subtle" data-next-switched>{{ $t(nextSwitched === "new" ? "reviewV2.decide.nextSwitchedToNew" : "reviewV2.decide.nextSwitchedToUpdates") }}</p>
          <div class="verdict__acts">
            <button type="button" class="btn btn--lg" :disabled="busy" data-restore @click="restoreCard">{{ $t("reviewV2.decide.restore") }}</button>
            <button v-if="nextItems && nextItems.length" type="button" class="btn btn--primary btn--lg" :disabled="nextBusy" @click="goNext">{{ $t("reviewV2.decide.next", { n: nextItems.length }) }}</button>
            <RouterLink v-else class="btn btn--primary btn--lg" :to="lp('/review')">{{ $t("review.result.toQueue") }}</RouterLink>
          </div>
        </template>
        <!-- 送出後（或回頭看審過、已定案的單）：決定區換成結果卡 -->
        <template v-else-if="stampedByMe || decided">
          <h3 class="verdict__title" tabindex="-1" data-decide-title data-result-card>{{ doc.roleName }}</h3>
          <p v-if="myStamp" class="result__mine"><span class="chip" :class="{ 'chip--reject': myStamp.verdict === 'reject' }">{{ $t(myStamp.verdict === 'approve' ? 'review.result.mine.approve' : 'review.result.mine.reject') }}</span></p>
          <!-- 一張單一章就定案：送出後只會是已上榜或已駁回 -->
          <p v-if="data.submission.status === 'approved' || data.submission.status === 'rejected'" class="result__now">{{ $t(data.submission.status === 'approved' ? 'review.result.now.approved' : 'review.result.now.rejected') }}</p>
          <!-- 定案的來源（照 AI／改了 AI／無 AI 對照；舊的定案可能是「用我的」） -->
          <p v-if="resultSource" class="result__mine"><span class="chip result__source" :data-final-source="resultSource">{{ $t("reviewAi.two.sourceChip", { source: $t(`reviewAi.two.source.${resultSource}`) }) }}</span></p>
          <!-- 定案後也能標「AI 判斷不準確」：按下就記下，可以取消，不影響這張卡的結果 -->
          <!-- 判準版本換過之後，舊版本的建議在這裡讀成「還沒審」；來源是照 AI／改了 AI 就表示當時有結論可對照，讀完就給 -->
          <div v-if="aiMarkable && aiState" class="ai-first__flag result__ai-flag" data-result-ai-flag>
            <p class="subtle ai-first__flag-hint" data-ai-inaccurate-hint>{{ $t(aiInaccurate ? "reviewAi.first.inaccurateOn" : "reviewAi.first.inaccurateHint") }}</p>
            <button type="button" class="btn btn--sm ai-first__flag-btn" :class="{ 'ai-first__flag-btn--on': aiInaccurate }" :aria-pressed="aiInaccurate" :aria-busy="aiMarkBusy ? 'true' : undefined" :disabled="aiMarkBusy" data-ai-inaccurate @click="toggleInaccurate">{{ $t("reviewAi.first.inaccurate") }}</button>
            <p v-if="aiMarkError" class="notice notice--error result__ai-flag-error" role="alert" data-ai-inaccurate-error>{{ aiMarkError }}</p>
          </div>
          <p v-if="data.retainUntil" class="subtle result__retain" data-retain-until>{{ $t("review.retain.until", { date: dateTime(data.retainUntil) }) }}</p>
          <ul v-if="data.rejectReasons?.length" class="result__reasons" data-result-reasons>
            <li v-for="code in data.rejectReasons" :key="code" class="chip">{{ $t(reasonKey(code, 'name')) }}</li>
          </ul>
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
                  <span v-if="s.finalSource === 'ai_fast_track'" class="chip" data-final-source="ai_fast_track">{{ $t("reviewAi.two.source.ai_fast_track") }}</span>
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
          <!-- 駁回改判為通過（限管理員，ui-flip-approve.md）：同一個送審版本建改判單，由自己領取後走正常核准 -->
          <p v-if="flipState?.pendingId && !flipDone" class="notice" role="status" data-flip-pending>{{ $t("review.history.flipPending") }} <RouterLink :to="lp(`/review/${flipState.pendingId}`)">{{ $t("review.flipApprove.goReview") }}</RouterLink></p>
          <p v-else-if="flipState?.approvedId" class="subtle" data-flip-approved>{{ $t("review.history.flippedToApproved") }}</p>
          <div v-if="flipDone" class="records" role="status" data-flip-done>
            <h3>{{ $t("review.flipApprove.doneTitle") }}</h3>
            <p>{{ $t("review.flipApprove.doneBody") }}</p>
            <RouterLink class="btn btn--primary" :to="lp(`/review/${flipDone}`)">{{ $t("review.flipApprove.goReview") }}</RouterLink>
          </div>
          <template v-else-if="flipState?.canStart">
            <button v-if="!flipOpen" type="button" class="btn" :disabled="busy" data-flip-entry @click="flipOpen = true">{{ $t("review.flipApprove.action") }}</button>
            <div v-else class="field flip-form" data-flip-form>
              <h3>{{ $t("review.flipApprove.title") }}</h3>
              <p v-if="flipState.supersededBy" class="notice" role="alert" data-flip-superseded>
                {{ $t("review.flipApprove.supersededWarning", { date: dateTime(flipState.supersededBy.submittedAt) }) }}
                <RouterLink :to="lp(`/review/${flipState.supersededBy.id}`)">{{ $t("review.flipApprove.goLatest") }}</RouterLink>
              </p>
              <p>{{ $t("review.flipApprove.originalSummary", { date: data.submission.decidedAt ? dateTime(data.submission.decidedAt) : "—" }) }}</p>
              <div v-if="data.rejectReasons?.length"><p class="subtle records__title">{{ $t("review.flipApprove.originalReasons") }}</p><p>{{ reasonNames(data.rejectReasons) }}</p></div>
              <div v-if="rejectNote"><p class="subtle records__title">{{ $t("review.flipApprove.originalNote") }}</p><p class="text record__note">{{ rejectNote }}</p></div>
              <label for="flip-reason">{{ $t("review.flipApprove.reasonLabel") }}</label>
              <textarea id="flip-reason" v-model="flipReason" autocomplete="off" class="input" rows="4" :maxlength="FLIP_REASON_MAX" :disabled="busy || !!flipState.supersededBy" aria-describedby="flip-reason-hint" />
              <p id="flip-reason-hint" class="subtle">{{ $t("review.flipApprove.reasonHint") }}</p>
              <p v-if="flipError" class="notice notice--error" role="alert">{{ flipError }}</p>
              <button type="button" class="btn btn--danger btn--lg" :disabled="busy || !!flipState.supersededBy" data-flip-submit @click="startFlip">{{ $t("review.flipApprove.submit") }}</button>
            </div>
          </template>
          <p v-if="nextError" class="notice notice--error" role="alert">{{ nextError }}</p>
          <p v-if="nextItems && !nextItems.length" class="subtle">{{ $t("review.result.queueEmpty") }}</p>
          <p v-else-if="nextSwitched" class="subtle" data-next-switched>{{ $t(nextSwitched === "new" ? "reviewV2.decide.nextSwitchedToNew" : "reviewV2.decide.nextSwitchedToUpdates") }}</p>
          <div class="verdict__acts">
            <RouterLink class="btn btn--lg" :to="lp('/review')">{{ $t("review.result.toQueue") }}</RouterLink>
            <button v-if="nextItems && nextItems.length" type="button" class="btn btn--primary btn--lg" :disabled="nextBusy" @click="goNext">{{ $t("review.result.next", { n: nextItems.length }) }}</button>
          </div>
        </template>
        <template v-else>
          <div class="verdict__head">
            <h3 class="verdict__title" tabindex="-1" data-decide-title>{{ $t("review.decide.title") }}</h3>
            <!-- AI 為主：決定區預設就是 AI 的建議（ui-ai-first.md） -->
            <span v-if="aiFirst && aiBase && aiApplied" class="chip verdict__default" data-ai-default>{{ $t("reviewAi.first.defaultChip") }}</span>
          </div>
          <div v-if="decideError || decideUnknown" ref="decideErrorEl" class="notice notice--error" role="alert" tabindex="-1">
            <p>{{ decideUnknown ? $t("review.decide.unknown") : decideError }}</p>
            <RouterLink v-if="decideUnknown" class="btn btn--sm" :to="lp('/review/decisions')">{{ $t("review.history.title") }}</RouterLink>
          </div>
          <ReviewAuthorNoteGuard v-if="noteGuard?.at === 'top'" :hits="noteGuard.hits" :final="noteGuard.final" />
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
                  <span v-if="s.finalSource === 'ai_fast_track'" class="chip" data-final-source="ai_fast_track">{{ $t("reviewAi.two.source.ai_fast_track") }}</span>
                  <span class="subtle">{{ dateTime(s.at) }}</span>
                </span>
                <p v-if="s.note" class="text record__note">{{ s.note }}</p>
              </li>
            </ul>
          </div>
          <!-- 改了 AI 的建議：列出差異，定案會記為「改了 AI 的建議」 -->
          <p v-if="aiFirst && aiChanges?.length" class="notice ai-modified" role="status" data-ai-modified>{{ $t("reviewAi.first.modified", { changes: aiChanges.join(/^(en|ko)/.test(String(locale)) ? ", " : "、") }) }}</p>

          <!-- 改判單的另一條路：撤回改判（＝駁回這張改判單），原本的駁回維持、不通知作者；限發起人 -->
          <div v-if="flip?.mine || flip?.canTakeOver" class="flip-withdraw" data-flip-withdraw>
            <button type="button" class="btn btn--danger" :disabled="busy" @click="withdrawFlip">{{ $t("review.flipApprove.withdrawAction") }}</button>
            <p class="subtle">{{ $t("review.flipApprove.withdrawHint") }}</p>
          </div>
          <!-- 有 AI 的建議時預選那一項並標「AI 建議」，否則三個選項都不預選；重新審核單沒有「不受理」，駁回限管理員 -->
          <div class="choices" role="radiogroup" :aria-label="$t('reviewV2.decide.title')" data-decide-choices>
            <label class="choice" :class="{ 'choice--on': choice === 'approve', 'choice--off': approveBlocked || !claimedByMe || !!hold }">
              <input v-model="choice" type="radio" name="decide" value="approve" :disabled="busy || !claimedByMe || !!hold || approveBlocked" />
              <span class="choice__name">{{ $t(reopen ? "review.action.keep" : "reviewV2.decide.approve") }}<span v-if="aiFirst && aiVerdict === 'approve'" class="chip choice__ai" data-ai-option>{{ $t("reviewAi.first.optionChip") }}</span></span>
              <span class="choice__hint">{{ approveBlocked ? $t("reviewV2.decide.lengthGap", { gap: lengthParams.remaining }, Number(data.detail.reviewLength?.remaining ?? 0)) : !claimedByMe ? $t("reviewV2.decide.claimFirst") : $t("reviewV2.decide.approveHint") }}</span>
            </label>
            <label v-if="!flip" class="choice" :class="{ 'choice--on': choice === 'reject', 'choice--off': !claimedByMe || !!hold || rejectLocked }">
              <input v-model="choice" type="radio" name="decide" value="reject" :disabled="busy || !claimedByMe || !!hold || rejectLocked" />
              <span class="choice__name">{{ $t("reviewV2.decide.reject") }}<span v-if="aiFirst && aiVerdict === 'reject'" class="chip choice__ai" data-ai-option>{{ $t("reviewAi.first.optionChip") }}</span></span>
              <span class="choice__hint">{{ !claimedByMe ? $t("reviewV2.decide.claimFirst") : $t("reviewV2.decide.rejectHint") }}</span>
            </label>
            <label v-if="!reopen && !flip" class="choice" :class="{ 'choice--on': choice === 'drop', 'choice--off': !!hold }">
              <input v-model="choice" type="radio" name="decide" value="drop" :disabled="busy || !!hold" />
              <span class="choice__name">{{ $t("reviewV2.decide.drop") }}</span>
              <span class="choice__hint">{{ hold ? $t("reviewV2.menu.held") : $t("reviewV2.decide.dropHint") }}</span>
            </label>
          </div>

          <!-- 通過並附改進建議：不常用，預設收合；駁回、不受理、重新審核單沒有 -->
          <div v-if="choice === 'approve' && !reopen" class="suggest" data-suggest>
            <button type="button" class="btn btn--ghost btn--sm suggest__toggle" :aria-expanded="suggestOpen" :disabled="busy" data-suggest-toggle @click="suggestOpen = !suggestOpen">{{ suggestOpen ? "−" : "＋" }} {{ $t("reviewV2.decide.suggestToggle") }}</button>
            <p class="subtle suggest__hint">{{ $t("reviewV2.decide.suggestHint") }}</p>
            <template v-if="suggestOpen">
              <ReviewReasonPicker v-model="suggestPicks" :locked="[]" :disabled="busy || !canDecide" :coaching="true" :coaching-default="false" :fandom="!!fandom"
                :opening="data.detail.greetings?.welcome ?? ''" :length="lengthParams" :exclude="['content.min_length', 'rating.mismatch', 'decline.burst_similar', 'decline.not_ready']"
                :preview-title="$t('reviewV2.decide.suggestPreviewTitle')" />
              <ReviewAuthorNoteGuard v-if="noteGuard?.at === 'suggest'" :hits="noteGuard.hits" :final="noteGuard.final" />
              <div class="field">
                <div class="note-head">
                  <label for="suggest-note">{{ $t(suggestions.includes('other') ? "reviewV2.decide.noteLabelRequired" : "reviewV2.decide.noteLabel") }}</label>
                  <!-- 勾了建議就連這段補充一起給作者（結果頁的「審核員補充」），跟駁回說明一樣過內部字詞檢查；沒勾時補充不會送出 -->
                  <ReviewVisibility v-if="suggestions.length" who="author" />
                </div>
                <textarea id="suggest-note" v-model="note" autocomplete="off" class="input" rows="3" :maxlength="NOTE_MAX" :disabled="busy" :aria-invalid="noteGuard?.at === 'suggest' ? 'true' : undefined" />
              </div>
            </template>
          </div>

          <template v-if="choice === 'reject'">
            <ReviewReasonPicker v-if="!reopen" v-model="reasonPicks" :locked="lengthForced ? ['content.min_length'] : []" :disabled="busy || !canDecide"
              :coaching="coachingOn" :coaching-default="coachingDefault" :fandom="!!fandom" :opening="data.detail.greetings?.welcome ?? ''"
              :length="lengthParams" @update:coaching="coaching = $event" />
            <ReviewAuthorNoteGuard v-if="noteGuard?.at === 'note'" :hits="noteGuard.hits" :final="noteGuard.final" />
            <div class="field">
              <div class="note-head">
                <label for="review-note">{{ $t(noteRequired ? "reviewV2.decide.noteLabelRequired" : "reviewV2.decide.noteLabel") }}</label>
                <ReviewVisibility v-if="!reopen" who="author" />
              </div>
              <p v-if="!reopen" id="review-note-hint" class="subtle note-hint" :data-note-prefilled="noteFromAi ? '' : undefined">{{ $t(noteFromAi ? "reviewAi.two.authorNote.prefilledHint" : "reviewAi.two.authorNote.editHint") }}</p>
              <textarea ref="noteField" autocomplete="off" id="review-note" v-model="note" class="input" rows="4" :maxlength="NOTE_MAX" :placeholder="$t('review.note.placeholder')" :disabled="decided||busy||!!hold" :aria-required="noteRequired" :aria-describedby="reopen ? undefined : 'review-note-hint'" :aria-invalid="noteGuard?.at === 'note' ? 'true' : undefined" @focus="noteFocused = true" @blur="noteFocused = false" />
              <p v-if="!reopen" class="subtle note-count" data-note-count>{{ $t("reviewAi.two.authorNote.count", { n: note.length, max: NOTE_MAX }) }}</p>
            </div>
          </template>
          <div v-else-if="choice === 'drop'" class="drop-info" data-drop-info>
            <p>{{ $t("reviewV2.decide.dropLine1") }}</p>
            <p>{{ $t("reviewV2.decide.dropLine2") }}</p>
            <p>{{ $t("reviewV2.decide.dropLine3") }}</p>
          </div>

          <!-- 審核標記：只給審核員與數據，作者看不到；三種決定都能標 -->
          <fieldset v-if="choice" class="decision-marks" data-decision-marks>
            <legend class="decision-marks__title">{{ $t("reviewV2.decide.marksTitle") }}</legend>
            <label v-for="m in REVIEW_DECISION_MARKS" :key="m" class="decision-marks__item">
              <input v-model="decisionMarks" type="checkbox" :value="m" :disabled="busy" :data-decision-mark="m" />
              <span>{{ $t(`reviewV2.marks.${m}`) }}</span>
            </label>
          </fieldset>
          <!-- 拿不定主意、要先跟其他審核員討論：冷凍後誰都不能決定，卡留在清單上 -->
          <div v-if="canHold" class="field hold-entry">
            <button type="button" class="btn" :disabled="busy || holdBusy" data-hold @click="holdCard">{{ $t("review.action.hold") }}</button>
            <p class="subtle small-note">{{ $t("review.hold.hint") }}</p>
            <p v-if="holdError" class="notice notice--error" role="alert">{{ holdError }}</p>
          </div>
          <!-- 沒領著（例如領取逾時後回來）不能送出判斷，也不能定案 -->
          <p v-if="!claimedByMe && !decided && !hold && choice !== 'drop'" class="subtle">{{ $t("review.claimFirst") }}</p>
          <!-- 給 AI 的說明：選填，收在最後（收合，不增加定案的步驟） -->
          <ReviewAiNoteField v-if="aiFirst && aiView === 'ready' && (choice === 'approve' || choice === 'reject')" v-model:types="aiNoteTypes" v-model:note="aiNote"
            context="final" id-base="final-ai-note" :disabled="busy" :collapsible="true" />
          <div class="verdict__acts">
            <button type="button" class="btn btn--ghost verdict__back" @click="backToRead">← {{ $t("review.decide.backToRead") }}</button>
            <template v-if="reopen">
              <button v-if="choice === 'reject'" class="btn btn--danger btn--lg verdict__btn" :disabled="busy || decided || !claimedByMe || !!hold || rejectLocked || !rejectReady" data-submit-reject @click="stampReopen('reject')">{{ busy ? $t("review.decide.submitting") : $t("review.action.reject") }}</button>
              <button v-else class="btn btn--primary btn--lg verdict__btn" :disabled="busy || decided || !claimedByMe || !!hold || choice !== 'approve'" data-submit-approve @click="stampReopen('approve')">{{ busy ? $t("review.decide.submitting") : $t("review.action.keep") }}</button>
            </template>
            <template v-else>
              <button v-if="choice === 'reject'" class="btn btn--danger btn--lg verdict__btn" :disabled="busy || decided || !claimedByMe || !!hold || !rejectReady" data-submit-reject :data-source="decideSource" @click="decide('reject')">{{ busy ? $t("review.decide.submitting") : $t(decideSource === 'ai' ? "reviewAi.first.submitAi.reject" : "reviewAi.first.submit.reject") }}</button>
              <button v-else-if="choice === 'drop'" class="btn btn--primary btn--lg verdict__btn" :disabled="busy || !!hold" data-submit-drop @click="dropCard">{{ busy ? $t("review.decide.submitting") : $t("reviewV2.decide.dropAction") }}</button>
              <button v-else class="btn btn--primary btn--lg verdict__btn" :disabled="busy || decided || !claimedByMe || !!hold || approveBlocked || choice !== 'approve'" :aria-describedby="approveBlocked || !length ? 'approve-blocked' : undefined" data-submit-approve :data-source="choice === 'approve' ? decideSource : undefined" @click="decide('approve')">{{ busy ? $t("review.decide.submitting") : $t(choice === 'approve' && decideSource === 'ai' ? "reviewAi.first.submitAi.approve" : "reviewAi.first.submit.approve") }}</button>
            </template>
          </div>
          <!-- 有 AI 的建議時寫明：沒改就是照 AI 定案，改了會記為改了 AI 的建議 -->
          <p v-if="aiFirst && aiBase && (choice === 'approve' || choice === 'reject')" class="subtle final__note" data-ai-submit-hint>{{ $t("reviewAi.first.submitHint") }}</p>
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
.flip-form { display: grid; gap: var(--s-2); }
.flip-form h3, .flip-form p { margin: 0; }
.flip-withdraw { display: grid; gap: var(--s-1); justify-items: start; margin-block-end: var(--s-3); }
.flip-withdraw p { margin: 0; }
.chip--flip { background: var(--accent-tint); color: var(--accent-text); }
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
.layout { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-areas: "head" "checks" "side" "body"; column-gap: var(--s-5); }
.layout__head { grid-area: head; }
/* 快速審的重點檢查：自己一格，排在頁首之後（跟頁首共用一格會蓋住卡名與作者區） */
.layout__checks { grid-area: checks; margin-bottom: var(--s-4); }
.layout__side { grid-area: side; }
.layout__body { grid-area: body; min-width: 0; scroll-margin-top: var(--header-h); --tabs-bar-h: calc(var(--h-sm) + var(--s-1) * 2 + var(--s-2) * 3); }
.side__acts { display: none; }
/* 分頁條黏在頁首下方（z 15，不透明底，內容不會從底下透出來）；讀到很長的人設也換得了分頁 */
.tabs-bar { position: sticky; top: var(--header-h); z-index: 15; background: var(--hr-page-bg); padding-block: var(--s-2); margin-bottom: var(--s-2); }
/* 手機底部固定列：試玩與前往決定（DESIGN：底部動作列 z 15、玻璃、上緣一條線、safe-area）。
   用 sticky 而不是 fixed：讀卡時黏在畫面底部，捲到頁尾時停在頁面內容的最後，不蓋住站台頁尾的連結 */
.dock { position: sticky; bottom: 0; z-index: 15; display: flex; gap: var(--s-2); margin-top: var(--s-4); padding: var(--s-3) 0 calc(var(--s-3) + env(safe-area-inset-bottom)); background: color-mix(in srgb, var(--hr-page-bg) 84%, transparent); backdrop-filter: blur(16px) saturate(1.2); -webkit-backdrop-filter: blur(16px) saturate(1.2); border-top: 1px solid var(--line); box-shadow: 0 0 0 100vmax color-mix(in srgb, var(--hr-page-bg) 84%, transparent); clip-path: inset(0 -100vmax); }
.dock__play { flex: none; min-width: 88px; }
.dock__main { flex: 1; }
@media (max-width: 1079px) {
  /* 右緣漸層：分頁比畫面寬時，提示還可以往右滑 */
  .tabs-bar::after { content: ""; position: absolute; top: 0; right: 0; width: 36px; height: calc(var(--h-sm) + var(--s-2) * 2 + var(--s-1) * 2); pointer-events: none; background: linear-gradient(to right, transparent, var(--hr-page-bg)); }
}
@media (min-width: 1080px) {
  .layout { grid-template-columns: minmax(0, 1fr) 300px; grid-template-areas: "head side" "checks side" "body side"; }
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
.verdict { padding: var(--s-4); display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); min-width: 0; scroll-margin-top: calc(var(--header-h) + var(--tabs-bar-h, 0px) + var(--s-3)); }
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
/* 決定三選項：手機直排、桌機三欄；選中用 accent 淡底，不用實心（實心留給主按鈕） */
.choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: var(--s-2); min-width: 0; }
@media (max-width: 760px) { .choices { grid-template-columns: minmax(0, 1fr); } }
.choice { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: var(--s-2); row-gap: 2px; align-items: center; padding: var(--s-3); min-height: var(--h-lg); border: 1px solid var(--border); border-radius: var(--r-md); cursor: pointer; }
.choice input { grid-row: span 2; width: 18px; height: 18px; margin: 0; }
.choice--on { border-color: var(--accent); background: var(--accent-tint); }
.choice--off { cursor: not-allowed; }
.choice--off .choice__name { color: var(--text-3); }
.choice__name { font-weight: 600; overflow-wrap: anywhere; }
.choice__hint { font-size: 12px; color: var(--text-2); overflow-wrap: anywhere; }
.choice__hint:lang(ko), .drop-info:lang(ko) { word-break: keep-all; }
.drop-info { display: grid; gap: var(--s-1); padding: var(--s-3); border-radius: var(--r-md); background: var(--surface-2); font-size: 13px; }
.key-checks { display: grid; gap: var(--s-2); }
.key-checks h3 { margin: 0; font-size: 15px; }
.key-checks__opening { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; margin: 0; }
.key-checks__opening--clamp { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.key-checks__elements { margin: 0; padding-left: var(--s-5); font-size: 13px; color: var(--text-2); }
.key-checks__cells { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--s-2); margin: 0; }
.key-checks__cells dt { font-size: 12px; color: var(--text-3); }
.key-checks__cells dd { margin: 0; font-variant-numeric: tabular-nums; }
.suggest { display: grid; gap: var(--s-2); min-width: 0; padding: var(--s-3); border-radius: var(--r-md); background: var(--surface-2); }
.suggest__toggle { justify-self: start; min-height: var(--h-md); }
.suggest__hint { margin: 0; }
/* 給作者看的說明欄：標題旁標「作者會看到」，下一行寫只寫卡片本身 */
.note-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-1) var(--s-2); min-width: 0; }
.note-head > label { font-size: 13px; font-weight: 600; }
.note-hint { margin: 0; overflow-wrap: anywhere; }
.note-hint:lang(ko) { word-break: keep-all; }
.decision-marks { border: 0; margin: 0; padding: 0; min-width: 0; min-inline-size: 0; display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-4); align-items: center; }
.decision-marks__title { font-size: 13px; font-weight: 600; color: var(--text-2); padding: 0; margin-bottom: var(--s-1); width: 100%; }
.decision-marks__item { display: inline-flex; gap: var(--s-2); align-items: center; min-height: var(--h-md); cursor: pointer; font-size: 13px; }
.result__reasons { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--s-2); }
/* 可點的 chip：點擊區至少 30（DESIGN 點擊區分級），有 hover 與焦點樣式 */
.reason { min-height: var(--h-sm); padding-inline: var(--s-3); border: 0; font: inherit; font-size: 13px; color: inherit; cursor: pointer; }
.reason:hover:not(:disabled) { background: var(--border); }
.reason:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.reason:disabled { opacity: 0.55; cursor: default; }
.result__mine, .result__now { margin: 0; }
.result__source { cursor: default; color: var(--accent-text); background: var(--accent-tint); font-weight: 600; }
.result__source:hover { color: var(--accent-text); background: var(--accent-tint); }
.result__retain { margin: 0; overflow-wrap: anywhere; }
/* 兩段式步驟列：目前這一格用 accent 淡底，完成的打勾；都有文字，不只靠顏色 */
/* AI 審卡區塊：內部說明虛線灰底＋鎖頭（只有審核員看得到），與給作者的字分得出來 */
.ai-first { display: grid; gap: var(--s-3); min-width: 0; margin-bottom: var(--s-4); }
.ai-first__title { margin: 0; font-size: 16px; }
.ai-first__live { display: grid; gap: var(--s-2); min-width: 0; }
.ai-first__ghost { height: 48px; border-radius: var(--r-md); }
.ai-first__line { margin: 0; overflow-wrap: anywhere; }
.ai-first__retry { justify-self: start; }
.ai-first__chips { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: 0; padding: 0; }
.ai-first__list { list-style: none; }
.ai-first__chip { cursor: default; max-width: 100%; }
.ai-first__chip:hover { color: var(--text-2); background: var(--surface-2); }
.ai-first__chip--num { font-variant-numeric: tabular-nums; }
.ai-first__chip--pass, .ai-first__chip--pass:hover { color: var(--success); background: var(--success-soft); font-weight: 600; }
.ai-first__chip--reject, .ai-first__chip--reject:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, var(--surface)); font-weight: 600; }
.ai-first__internal { display: grid; gap: var(--s-2); min-width: 0; padding: var(--s-2) var(--s-3); border: 1px dashed var(--border-strong); border-radius: var(--r-sm); background: var(--surface-2); }
.ai-first__internal-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-1) var(--s-2); min-width: 0; }
.ai-first__internal-title { margin: 0; font-size: 13px; font-weight: 600; }
.ai-first__text { margin: 0; font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow-y: auto; }
.ai-first__late { display: grid; gap: var(--s-2); }
.ai-first__late p { margin: 0; }
.ai-first__late-acts { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.ai-first__flag { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--s-2); }
.ai-first__flag-hint { margin: 0 auto 0 0; font-size: 12px; overflow-wrap: anywhere; }
.result__ai-flag-error { flex-basis: 100%; margin: 0; }
.ai-first__flag-btn--on, .ai-first__flag-btn--on:hover { border-color: var(--accent); background: var(--accent-tint); color: var(--accent-text); }
.ai-first__line:lang(ko), .ai-first__flag-hint:lang(ko) { word-break: keep-all; }
.verdict__head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.verdict__default { cursor: default; }
.verdict__default:hover { color: var(--text-2); background: var(--surface-2); }
.choice__ai { margin-inline-start: var(--s-2); cursor: default; vertical-align: middle; font-size: 12px; font-weight: 600; color: var(--accent-text); background: var(--accent-tint); }
.choice__ai:hover { color: var(--accent-text); background: var(--accent-tint); }
.ai-modified { margin: 0; overflow-wrap: anywhere; }
.final__label { margin: 0; font-size: 14px; font-weight: 600; }
.final__text, .final__note { margin: 0; overflow-wrap: anywhere; }
.final__text:lang(ko), .final__note:lang(ko) { word-break: keep-all; }
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
.note-count { margin: 4px 0 0; text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; }
</style>
