<script setup lang="ts">
/**
 * 審核詳情·擴充單（ui.md §3.9 ①）。ReviewDetailPage 讀到 subjectKind "workshop" 時整頁交給這裡。
 *
 * 跟卡片審核頁的差別都來自擴充本身：
 *   - 擴充只要 1 章，沒有字數門檻、冷凍、重新審核、改判，所以這裡只有領取、試玩、駁回、通過。
 *   - 詳情不必先領取就讀得到：「未領取」「自己的擴充」「限制級·需驗證年齡」三種狀態都要先看到內容
 *     與原因，後兩種本來就領不了（伺服器在 claim／stamp 再擋一次）。
 *   - 內容是「一行摘要＋展開」（ReviewWorkshopContent，站方申訴頁共用）：審核員要讀原文，但四類內容攤開會長到找不到動作列。
 *   - 駁回理由必填，原文送給製作者（confirmForm 擋空白）；通過也確認一次，因為一章就定案、立刻發布。
 * 審核試玩沿用卡片的網址：原卡卡號＋review=<審核單 id>，遊玩頁用 play-access 判斷要不要掛上這個擴充。
 */
import { computed, defineAsyncComponent, onBeforeUnmount, ref } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, claimReview, releaseReview, stampReview } from "@/lib/api";
import { confirmDialog, confirmForm, confirmState, settleConfirm } from "@/lib/confirm";
import { dateTime, relativeTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import type { WorkshopReviewDetail } from "@/lib/workshop-review";
import RatingMark from "@/components/RatingMark.vue";
import ExtensionCover from "@/components/workshop/ExtensionCover.vue";
import ReviewWorkshopContent from "@/components/ReviewWorkshopContent.vue";

// 年齡驗證窗很少用到，按「驗證年齡」才載入
const AdultConsentDialog = defineAsyncComponent(() => import("@/components/AdultConsentDialog.vue"));

/** reload：父頁重讀詳情。等它回來才放開按鈕，免得舊狀態還在畫面上又被按一次（重領、重蓋章） */
const props = defineProps<{ review: WorkshopReviewDetail; reload: () => Promise<unknown> }>();
const { t } = useI18n();
const { lp } = useLocalePath();
const session = useSession();

/** 說明上限：與卡片審核同一個數（伺服器 REVIEW_NOTE_MAX） */
const NOTE_MAX = 2000;
const sub = computed(() => props.review.submission);
const w = computed(() => props.review.workshop);
const isUpdate = computed(() => sub.value.type === "update");
const approvals = computed(() => sub.value.stamps.filter((s) => s.verdict === "approve").length);
/** 蓋章成功就先在畫面上換成結果：重讀失敗也不會讓通過／駁回留在畫面上 */
const localStamp = ref<{ verdict: "approve" | "reject"; note: string } | null>(null);
const decided = computed(() => sub.value.status !== "pending" || !!sub.value.stampedByMe || !!localStamp.value);
const myStamp = computed(() => sub.value.stamps.find((s) => s.mine) ?? localStamp.value);
const own = computed(() => sub.value.ownWorkshop);
/** 領取時伺服器才說要驗證年齡（例如剛好在別的分頁撤銷了驗證）：同樣換成年齡說明 */
const ageBlocked = ref(false);
const ageGate = computed(() => !own.value && (sub.value.ageVerificationRequired || ageBlocked.value));
const claimed = computed(() => sub.value.claimedByMe);
const canDecide = computed(() => claimed.value && !decided.value && !own.value && !ageGate.value);
const playTo = computed(() => lp(`/play/${props.review.baseCard.id}?review=${encodeURIComponent(sub.value.id)}`));

const busy = ref(false);
const actionError = ref("");
const asking = ref(false);

async function token() {
  const tok = await session.accessToken();
  if (!tok) throw new Error(t("auth.expired"));
  return tok;
}

/** 這一頁開的確認框：離開頁面（或換單）時當取消，不讓它留在下一頁上 */
let ownedConfirm: typeof confirmState.current = null;
onBeforeUnmount(() => { if (ownedConfirm && confirmState.current === ownedConfirm) settleConfirm(false); ownedConfirm = null; });
async function owned<T>(answer: Promise<T>): Promise<T> {
  ownedConfirm = confirmState.current;
  try { return await answer; } finally { ownedConfirm = null; }
}

function failure(err: unknown, fallback: string) {
  if (err instanceof ApiError && err.code === "age_verification_required") { ageBlocked.value = true; return ""; }
  if (err instanceof Error && err.message === t("auth.expired")) return err.message;
  return fallback;
}

async function claim() {
  if (busy.value) return;
  busy.value = true;
  actionError.value = "";
  try {
    await claimReview(sub.value.id, await token());
    await props.reload();
  } catch (err) {
    const taken = err instanceof ApiError && err.status === 409;
    actionError.value = failure(err, taken ? t("review.claim.taken") : t("review.claim.failed"));
    if (taken) await props.reload();
  } finally {
    busy.value = false;
  }
}

async function release() {
  if (busy.value) return;
  busy.value = true;
  actionError.value = "";
  try {
    await releaseReview(sub.value.id, await token(), sub.value.claimGeneration);
    await props.reload();
  } catch (err) {
    actionError.value = failure(err, err instanceof ApiError && err.status === 409 ? t("review.claimChanged") : t("state.actionFailed"));
  } finally {
    busy.value = false;
  }
}

async function decide(verdict: "approve" | "reject") {
  if (busy.value || !canDecide.value) return;
  const review = props.review;
  let note = "";
  if (verdict === "reject") {
    const answer = await owned(confirmForm({
      title: t("workshop.review.rejectTitle", { name: review.workshop.name }),
      message: t("workshop.review.rejectBody"),
      field: { label: t("workshop.review.rejectReason"), required: true, multiline: true, maxlength: NOTE_MAX },
      confirmText: t("review.action.reject"), cancelText: t("dialog.cancel"),
      danger: true, dangerAppearance: "subdued", focusCancel: true, phraseWrap: true,
    }));
    if (!answer || !answer.text.trim()) return;
    note = answer.text.trim();
  } else {
    const ok = await owned(confirmDialog({
      title: t("review.confirm.approveTitle"), message: t("workshop.review.approveBody"),
      confirmText: t("review.confirm.approve"), cancelText: t("dialog.cancel"), focusCancel: true, phraseWrap: true,
    }));
    if (!ok) return;
  }
  // 確認框開著的時候換了單或重讀了：不把決定送到另一張上
  if (props.review !== review) return;
  busy.value = true;
  actionError.value = "";
  try {
    await stampReview(review.submission.id, await token(), { verdict, note, generation: review.submission.claimGeneration });
    localStamp.value = { verdict, note };
    await props.reload();
  } catch (err) {
    const changed = err instanceof ApiError && err.status === 409;
    actionError.value = failure(err, changed ? t("review.claimChanged") : t("review.decide.failed"));
    if (changed) await props.reload();
  } finally {
    busy.value = false;
  }
}

async function verified() {
  asking.value = false;
  ageBlocked.value = false;
  await props.reload();
}
</script>

<template>
  <article class="wsr" data-workshop-review>
    <div class="wsr__nav">
      <RouterLink class="btn btn--ghost btn--sm wsr__back" :to="lp('/review')">← {{ $t("review.backToQueue") }}</RouterLink>
      <button v-if="claimed && !decided" type="button" class="btn btn--ghost btn--sm" :disabled="busy" data-ws-release @click="release">{{ $t("review.action.release") }}</button>
    </div>

    <div class="wsr__cover"><ExtensionCover :src="w.coverUrl ?? ''" :name="w.name" :adult="sub.rating === 'R'" /></div>

    <header class="wsr__head">
      <h1 class="wsr__title ws-text">{{ w.name }}</h1>
      <div class="wsr__chips">
        <span class="chip ws-chip--on">{{ $t("workshop.review.kind") }}</span>
        <span class="chip" :class="{ 'ws-chip--warn': isUpdate }" data-type-chip>{{ isUpdate ? $t("workshop.review.updateVer", { ver: w.version }) : $t("review.type.first") }}</span>
        <RatingMark v-if="sub.rating" :rating="sub.rating" variant="chip" />
        <span class="chip chip--count">{{ $t("review.stamps", { n: approvals, required: sub.required }) }}</span>
      </div>
      <p class="wsr__meta">
        <RouterLink class="wsr__link" :to="lp(`/cards/${review.baseCard.id}`)" target="_blank" data-base-card>{{ $t("workshop.detail.forCard", { card: review.baseCard.name }) }}</RouterLink>
        <span v-if="review.maker">{{ $t("workshop.review.by", { name: review.maker.name }) }}</span>
        <span>{{ $t("workshop.review.submittedAt", { time: relativeTime(sub.submittedAt) }) }}</span>
      </p>
      <p v-if="w.summary" class="subtle ws-text">{{ w.summary }}</p>
    </header>

    <section v-if="isUpdate && w.updateNote" class="panel wsr__pane" data-update-note>
      <h2 class="wsr__lab">{{ $t("workshop.review.updateNoteTitle") }}</h2>
      <p class="wsr__note">{{ w.updateNote }}</p>
    </section>

    <ReviewWorkshopContent :workshop="w" />

    <section class="panel wsr__pane">
      <h2 class="wsr__lab">{{ $t("review.stampsList") }}</h2>
      <ul v-if="sub.stamps.length" class="wsr__stamps">
        <li v-for="(s, i) in sub.stamps" :key="i" class="wsr__stamp">
          <span class="wsr__stamphead"><span class="chip" :class="s.verdict === 'reject' ? 'ws-chip--bad' : 'ws-chip--ok'">{{ $t(`review.action.${s.verdict}`) }}</span><span class="subtle">{{ dateTime(s.at) }}</span></span>
          <p v-if="s.note" class="wsr__note">{{ s.note }}</p>
        </li>
      </ul>
      <p v-else class="subtle">{{ $t("workshop.review.noStamps") }}</p>
    </section>

    <!-- 定案後（或我蓋過章）：動作列換成結果，重新整理也是同一張 -->
    <section v-if="decided" class="panel wsr__pane" data-ws-result>
      <p v-if="myStamp" class="wsr__mine"><span class="chip" :class="myStamp.verdict === 'reject' ? 'ws-chip--bad' : 'ws-chip--ok'">{{ $t(myStamp.verdict === "approve" ? "review.result.mine.approve" : "review.result.mine.reject") }}</span></p>
      <p v-if="sub.status === 'approved' || sub.status === 'rejected'" class="wsr__now">{{ $t(sub.status === "approved" ? "review.result.now.approved" : "review.result.now.rejected") }}</p>
      <div class="wsr__acts"><RouterLink class="btn btn--primary btn--lg" :to="lp('/review')">{{ $t("review.result.toQueue") }}</RouterLink></div>
    </section>

    <!-- 底部固定動作列（手機同）：一次只有一種狀態 -->
    <div v-else class="wsr__bar" data-ws-actions>
      <p v-if="actionError" class="notice notice--error wsr__error" role="alert">{{ actionError }}</p>
      <p v-if="own" class="notice notice--error wsr__msg" data-ws-own>{{ $t("workshop.review.own") }}</p>
      <template v-else-if="ageGate">
        <p class="notice wsr__msg ws-text" data-ws-age>{{ $t("workshop.review.ageGate") }}</p>
        <div class="wsr__acts"><button type="button" class="btn btn--primary btn--lg" data-ws-verify @click="asking = true">{{ $t("workshop.review.verifyAge") }}</button></div>
      </template>
      <template v-else-if="!claimed">
        <p class="notice wsr__msg">{{ $t("review.claimFirst") }}</p>
        <div class="wsr__acts">
          <button v-if="sub.claim === 'other'" type="button" class="btn btn--lg" disabled>{{ $t("review.claim.other") }}</button>
          <button v-else type="button" class="btn btn--primary btn--lg" :disabled="busy" :aria-busy="busy" data-ws-claim @click="claim">{{ busy ? $t("review.action.claiming") : $t("review.action.claim") }}</button>
        </div>
      </template>
      <div v-else class="wsr__acts">
        <RouterLink class="btn btn--lg wsr__play" :to="playTo" target="_blank" data-ws-play>{{ $t("review.action.play") }}</RouterLink>
        <button type="button" class="btn btn--danger btn--lg" :disabled="busy" data-ws-reject @click="decide('reject')">{{ $t("review.action.reject") }}</button>
        <button type="button" class="btn btn--primary btn--lg" :disabled="busy" data-ws-approve @click="decide('approve')">{{ busy ? $t("review.decide.submitting") : $t("review.action.approve") }}</button>
      </div>
    </div>

    <AdultConsentDialog v-if="asking" @close="asking = false" @done="verified" />
  </article>
</template>

<style scoped>
/* 窄頁 720：內容是一欄讀下來的原文，太寬反而難讀 */
.wsr { max-width: 720px; margin: 0 auto; display: grid; gap: var(--s-4); }
.wsr__nav { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); }
.wsr__back { padding-inline-start: 0; }
/* 橫圖高度上限 300：桌機 720 寬照比例會到 405，壓掉下面的內容 */
.wsr__cover { width: 100%; aspect-ratio: 16 / 9; max-height: 300px; border-radius: var(--r-md); overflow: hidden; }
.wsr__cover :deep(.ext-cover) { aspect-ratio: auto; width: 100%; height: 100%; }
.wsr__head { display: grid; gap: var(--s-2); min-width: 0; }
.wsr__title { margin: 0; font-size: 22px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
.wsr__chips { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
.wsr__meta { margin: 0; display: flex; flex-wrap: wrap; gap: var(--s-1) var(--s-3); font-size: 13px; color: var(--text-2); }
.wsr__link { color: var(--accent-text); }
.chip--count { font-variant-numeric: tabular-nums; }
.wsr__pane { padding: var(--s-4); display: grid; gap: var(--s-3); min-width: 0; }
.wsr__lab { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-2); }
.wsr__note { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.7; }
.wsr__stamps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.wsr__stamp { display: grid; gap: var(--s-1); }
.wsr__stamphead { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); font-size: 13px; }
.wsr__mine, .wsr__now { margin: 0; }
.wsr__now { font-weight: 600; }
/* 底部固定動作列（DESIGN：底部動作列 z 15、玻璃、上緣一條線、safe-area），同卡片審核頁的 dock */
.wsr__bar {
  position: sticky; bottom: 0; z-index: 15; display: grid; gap: var(--s-2);
  padding: var(--s-3) 0 calc(var(--s-3) + env(safe-area-inset-bottom));
  background: color-mix(in srgb, var(--hr-page-bg) 84%, transparent);
  backdrop-filter: blur(16px) saturate(1.2); -webkit-backdrop-filter: blur(16px) saturate(1.2);
  border-top: 1px solid var(--line);
}
.wsr__msg, .wsr__error { margin: 0; }
.wsr__acts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--s-2); }
.wsr__play { margin-right: auto; }
@media (max-width: 600px) {
  .wsr__acts > .btn { flex: 1 1 0; min-width: max-content; }
  .wsr__play { margin-right: 0; }
}
</style>
