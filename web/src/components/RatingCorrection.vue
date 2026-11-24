<script setup lang="ts">
/**
 * 作品管理「更正分級」（管理員，owner 2026-11-24；UI 稿 ui-rating-correction.md v13）。
 *
 * 直接生效、不走提出→投票：改卡片、上架版本與待審單的分級，並把新分級鎖成分級下限
 * （作者之後送審不能低於它）。可升可降，下限跟著走；不通知作者。
 *
 * 新分級＝目前分級、但分級下限不同（含沒有下限）時只鎖定下限（v15）：卡片分級不動，按鈕與確認框改成
 * 「鎖定分級下限」；分級和下限都已經是這一級才是「分級沒有改變」。結果以伺服器回的 lockOnly 為準。
 *
 * 一次「嘗試」一個 operationId：失敗後按重試沿用同一個，伺服器靠它去重；改了分級或理由就換新的。
 * 成功後不重載清單（那會把選取清掉、看不到結果），改成頁內成功卡，並請頁面換上新的卡片詳情。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RATINGS, isRating, type Rating } from "../../../shared/content-rating";
import { ApiError } from "@/lib/api";
import { confirmDialog, settleConfirm } from "@/lib/confirm";
import { moderationRequest, type CardHistory } from "@/lib/moderation";
import { ratingName } from "@/lib/rating";
import RatingMark from "./RatingMark.vue";

const props = defineProps<{ card: CardHistory["card"]; token: () => Promise<string>; disabled?: boolean }>();
const emit = defineEmits<{ busy: [value: boolean]; updated: [fresh: CardHistory]; again: [] }>();
const { t, locale } = useI18n();

const REASON_MAX = 500;
const current = computed<Rating | null>(() => (isRating(props.card.rating) ? props.card.rating : null));
const floor = computed<Rating | null>(() => (isRating(props.card.ratingFloor) ? props.card.ratingFloor : null));
const next = ref<Rating | "">(current.value ?? "");
const reason = ref("");
const busy = ref(false);
const failed = ref("");
const retryable = ref(false);
const notice = ref("");
const done = ref<{ from: Rating | null; to: Rating; lockOnly: boolean; floorFrom: Rating | null } | null>(null);
let operation = crypto.randomUUID();
let alive = true;
let ownConfirmation = false;

const name = (r: Rating | null) => (r ? ratingName(r, String(locale.value)) : t("moderation.ratingCorrection.unrated"));
const floorName = (r: Rating | null) => (r ? ratingName(r, String(locale.value)) : t("moderation.ratingCorrection.noFloor"));
const sameRating = computed(() => !!next.value && next.value === current.value);
// 分級一樣但下限不同（含沒有下限）：只鎖定下限；兩者都一樣才不需要動
const lockOnly = computed(() => sameRating.value && floor.value !== next.value);
const unchanged = computed(() => sameRating.value && floor.value === next.value);
const canSubmit = computed(() => !busy.value && !props.disabled && !!next.value && !unchanged.value && !!reason.value.trim());
const adult = computed(() => next.value === "R" && current.value !== "R");

// 作者動了分級或理由，就是新的一次嘗試（只看使用者的輸入；詳情重讀帶動的選單變化不算）
function changed() { operation = crypto.randomUUID(); failed.value = ""; retryable.value = false; notice.value = ""; }
// 卡片詳情更新了（例如分級沒變時重讀），選單回到目前分級
watch(current, (r) => { if (!done.value) next.value = r ?? ""; });
watch(busy, (value) => emit("busy", value));
onBeforeUnmount(() => { alive = false; if (ownConfirmation) settleConfirm(false); });

function effects(to: Rating): string[] {
  const list = [t("moderation.ratingCorrection.effect.floor", { to: name(to) }), t("moderation.ratingCorrection.effect.noNotice")];
  // 只有限制級擋未成年人：改成限制級時這條最重要，放第一。其他分級沒有年齡門檻，降級也不另寫誰看得到（稿 v18，PM 2026-11-24）
  if (to === "R") list.unshift(t("moderation.ratingCorrection.effect.hideMinors"));
  return list;
}

async function refresh(access: string) {
  const fresh = await moderationRequest<CardHistory>(`/cards/${props.card.id}?lang=${locale.value}`, access);
  if (alive) emit("updated", fresh);
}

async function send(to: Rating, from: Rating | null, floorFrom: Rating | null, text: string) {
  busy.value = true; failed.value = ""; retryable.value = false; notice.value = "";
  try {
    const access = await props.token(); if (!alive) return;
    const result = await moderationRequest<{ before: { rating: string | null; floor?: string | null }; rating: string; lockOnly?: boolean }>(`/cards/${props.card.id}/rating`, access, { rating: to, reason: text, operationId: operation });
    if (!alive) return;
    // 結果照伺服器說的：表單可能過時（別人剛改過），以實際做了什麼為準
    const before = result.before ?? { rating: null };
    done.value = {
      from: isRating(before.rating) ? before.rating : from,
      to: isRating(result.rating) ? result.rating : to,
      lockOnly: !!result.lockOnly,
      floorFrom: before.floor === undefined ? floorFrom : isRating(before.floor) ? before.floor : null,
    };
    operation = crypto.randomUUID();
    await refresh(access).catch(() => {});
  } catch (e) {
    if (!alive) return;
    const code = e instanceof ApiError ? e.code ?? "" : "";
    if (code === "rating_unchanged") {
      // 別人剛改過、或已經是這一級：重讀詳情，表單回到「不需要更正」
      await props.token().then(refresh).catch(() => {});
      if (alive) notice.value = t("moderation.ratingCorrection.alreadyRated", { to: name(to) });
      return;
    }
    const denied = ["review_manager_required", "moderation_self_review", "age_verification_required"].includes(code);
    failed.value = denied ? (e as Error).message : t("moderation.ratingCorrection.failed");
    retryable.value = !denied;
  } finally {
    if (alive) busy.value = false;
  }
}

async function submit() {
  if (!canSubmit.value || !isRating(next.value)) return;
  const to = next.value, from = current.value, floorFrom = floor.value, text = reason.value.trim(), lock = lockOnly.value;
  const card = props.card;
  const reasonLine = t("moderation.ratingCorrection.reasonLine", { reason: text });
  ownConfirmation = true;
  const ok = await confirmDialog({
    title: t(lock ? "moderation.ratingCorrection.lockConfirmTitle" : "moderation.ratingCorrection.confirmTitle"),
    subject: card.cardNumber != null ? t("moderation.ratingCorrection.subject", { name: card.name, number: card.cardNumber }) : card.name,
    message: lock
      ? `${t("moderation.ratingCorrection.ratingKept", { rating: name(to) })}\n${t("moderation.ratingCorrection.floorChange", { from: floorName(floorFrom), to: name(to) })}\n${reasonLine}`
      : `${t("moderation.ratingCorrection.change", { from: name(from), to: name(to) })}\n${reasonLine}`,
    consequences: lock ? [t("moderation.ratingCorrection.effect.lockOnly", { to: name(to) }), t("moderation.ratingCorrection.effect.noNotice")] : effects(to),
    // 「可以再更正一次」講的是改分級；只鎖下限時稿子沒有這一行
    ...(lock ? {} : { hint: t("moderation.ratingCorrection.history") }),
    confirmText: t(lock ? "moderation.ratingCorrection.lockFloor" : "moderation.action.rating"),
    cancelText: t("moderation.cancel"),
    danger: true,
    scrollMessage: true,
  });
  ownConfirmation = false;
  if (!ok || !alive || props.card.id !== card.id) return;
  await send(to, from, floorFrom, text);
}

function retry() {
  if (busy.value || !isRating(next.value)) return;
  void send(next.value, current.value, floor.value, reason.value.trim());
}

function again() {
  done.value = null; reason.value = ""; next.value = current.value ?? "";
  emit("again");
}
</script>

<template>
  <section class="rc" data-rating-correction>
    <div v-if="done" class="panel rc__done" role="status" data-rating-done>
      <template v-if="done.lockOnly">
        <strong>{{ $t("moderation.ratingCorrection.lockDoneTitle") }}</strong>
        <p>{{ $t("moderation.ratingCorrection.ratingKept", { rating: name(done.to) }) }}</p>
        <p>{{ $t("moderation.ratingCorrection.floorChange", { from: floorName(done.floorFrom), to: name(done.to) }) }}</p>
      </template>
      <template v-else>
        <strong>{{ $t("moderation.ratingCorrection.doneTitle") }}</strong>
        <p>{{ $t("moderation.ratingCorrection.change", { from: name(done.from), to: name(done.to) }) }}</p>
        <p>{{ $t("moderation.ratingCorrection.doneFloor", { to: name(done.to) }) }}</p>
      </template>
      <p class="subtle">{{ $t("moderation.ratingCorrection.doneNotice") }}</p>
      <button type="button" class="btn" data-rating-again @click="again">{{ $t("moderation.ratingCorrection.again") }}</button>
    </div>
    <template v-else>
      <p class="subtle" data-rating-proposal>{{ lockOnly && next ? $t("moderation.ratingCorrection.lockProposal", { to: name(next) }) : $t("moderation.proposal.rating") }}</p>
      <div class="rc__row">
        <span class="rc__pair">
          <span class="rc__label">{{ $t("moderation.ratingCorrection.current") }}</span>
          <RatingMark v-if="current" :rating="current" variant="chip" data-rating-current />
          <span v-else class="chip" data-rating-current>{{ $t("moderation.ratingCorrection.unrated") }}</span>
        </span>
        <span class="rc__pair">
          <span class="rc__label">{{ $t("moderation.ratingCorrection.floor") }}</span>
          <RatingMark v-if="floor" :rating="floor" variant="chip" data-rating-floor />
          <span v-else class="chip" data-rating-floor>{{ $t("moderation.ratingCorrection.noFloor") }}</span>
        </span>
        <span class="rc__arrow" aria-hidden="true">→</span>
        <label class="rc__label" for="rating-next">{{ $t("moderation.ratingCorrection.next") }}</label>
        <select id="rating-next" v-model="next" class="input rc__select" :disabled="busy || disabled" data-rating-next @change="changed">
          <option v-if="!current" value="" disabled>{{ $t("moderation.ratingCorrection.pick") }}</option>
          <option v-for="r in RATINGS" :key="r" :value="r">{{ name(r) }}</option>
        </select>
      </div>
      <p v-if="unchanged && next" class="subtle" data-rating-unchanged>{{ $t("moderation.ratingCorrection.unchanged", { to: name(next) }) }}</p>
      <p v-if="adult" class="notice rc__warn" data-rating-adult>{{ $t("moderation.ratingCorrection.adultWarning") }}</p>
      <label for="rating-reason">{{ $t("moderation.reason") }}</label>
      <textarea id="rating-reason" v-model="reason" autocomplete="off" class="input" rows="4" :maxlength="REASON_MAX" :disabled="busy || disabled" data-rating-reason @input="changed" />
      <p v-if="notice" class="notice" role="status" data-rating-notice>{{ notice }}</p>
      <p v-if="failed" class="notice notice--error rc__failed" role="alert" data-rating-failed>
        <span>{{ failed }}</span>
        <button v-if="retryable" type="button" class="btn btn--sm" :disabled="busy" data-rating-retry @click="retry">{{ $t("moderation.ratingCorrection.retry") }}</button>
      </p>
      <button type="button" class="btn btn--danger work-submit rc__submit" :disabled="!canSubmit" data-rating-submit @click="submit">{{ $t(lockOnly ? "moderation.ratingCorrection.lockFloor" : "moderation.action.rating") }}</button>
    </template>
  </section>
</template>

<style scoped>
.rc { display: grid; gap: var(--s-3); min-width: 0; }
.rc label, .rc__label { font-size: 13px; font-weight: 600; }
.rc__row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2); }
.rc__pair { display: inline-flex; align-items: center; gap: var(--s-2); }
.rc__arrow { color: var(--text-3); }
.rc__select { width: auto; min-width: 140px; flex: 1 1 160px; }
.rc__warn { margin: 0; color: var(--warning-text); background: color-mix(in srgb, var(--warning-text) 10%, var(--surface)); }
.rc__failed { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2); margin: 0; }
/* 和本頁其他動作同一顆 btn btn--danger work-submit；work-submit 是頁面的 scoped 樣式進不來，靠齊左這裡再寫一次 */
.rc__submit { justify-self: start; }
.rc__done { display: grid; gap: var(--s-2); padding: var(--s-4); justify-items: start; }
.rc__done p { margin: 0; }
/* 跟作品管理頁的其他動作一致：表單欄位撐滿，手機上控件都是 44 高（頁面的 scoped 樣式進不到這個元件） */
.rc > .input { width: 100%; }
@media (max-width: 760px) { .rc .btn, .rc .input { min-height: var(--h-lg); } }
:lang(ko) .rc { word-break: keep-all; }
:lang(ja) .rc { word-break: auto-phrase; }
</style>
