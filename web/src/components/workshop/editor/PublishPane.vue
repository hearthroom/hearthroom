<script setup lang="ts">
/**
 * 編輯頁「發布」分區（ui.md §3.6、§3.8 製作者端、§4.6）：狀態區 → 送審前檢查 →（已發布時）更新說明 → 動作 → 刪除。
 *
 * 只吃 props、只發事件，請求都在編輯器裡：九種狀態加申訴中是純畫面判斷，這樣測得到每一種，
 * 也不會有兩個地方各自決定「現在能不能送審」。
 *
 * 退件意見與原作者理由常駐在狀態區（不是只在 toast）：作者隔天回來還看得到為什麼。
 * 被原作者隱藏時沒有送審鈕——隱藏不要求修改，由原作者自己取消；能做的只有申訴。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AppealState, ChecklistItem, PublishState, WorkshopDraft } from "@/lib/workshop";
import { UPDATE_NOTE_MAX, UPDATE_NOTE_MIN } from "@/lib/workshop";

const props = defineProps<{
  state: PublishState;
  draft: Pick<WorkshopDraft, "published" | "updateNote" | "card">;
  checklist: ChecklistItem[];
  /** 平台的退件意見（未通過、新版未通過） */
  rejectNote: string | null;
  /** 原作者退回／隱藏的理由原文 */
  ownerReason: string | null;
  appeal: AppealState;
  /** 這次編輯期間開過試玩：只是提醒，不擋送審 */
  tried: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{
  "update:note": [string];
  submit: [];
  withdraw: [];
  appeal: [];
  delete: [];
}>();
const { t } = useI18n();

const ver = (n: number | undefined) => (n ? `v${n}` : "");
const live = computed(() => props.draft.published?.version ?? 0);

/** 狀態區的標題：已發布系列帶版號，其他用短狀態名 */
const title = computed(() => {
  switch (props.state) {
    case "draft": return t("workshop.status.draft");
    case "review": return t("workshop.status.inReview");
    case "rejected": return t("workshop.status.rejected");
    case "live": return t("workshop.publish.published.title", { ver: ver(live.value) });
    case "livechg": return t("workshop.publish.dirty.title", { ver: ver(live.value) });
    case "liveup": return t("workshop.publish.updateInReview.title", { ver: ver(live.value + 1) });
    case "liverej": return t("workshop.publish.updateRejected.title", { ver: ver(live.value + 1) });
    case "returned": return t("workshop.status.returned");
    case "hidden": return t("workshop.status.hidden");
  }
  return "";
});
const desc = computed(() => {
  switch (props.state) {
    case "draft": return t("workshop.publish.draft.desc");
    case "review": return t("workshop.publish.inReview.desc");
    case "rejected": return "";
    case "live": return t("workshop.publish.published.desc");
    case "livechg": return t("workshop.publish.dirty.desc", { ver: ver(live.value) });
    case "liveup": return t("workshop.publish.updateInReview.desc", { prev: ver(live.value) });
    case "liverej": return t("workshop.publish.updateRejected.desc", { prev: ver(live.value) });
    case "returned": return t("workshop.publish.returned.desc");
    case "hidden": return t("workshop.publish.hidden.desc");
  }
  return "";
});
const tone = computed(() => ({
  draft: "", review: "ws-chip--on", liveup: "ws-chip--on", live: "ws-chip--ok", livechg: "ws-chip--ok",
  rejected: "ws-chip--bad", liverej: "ws-chip--bad", returned: "ws-chip--bad", hidden: "ws-chip--warn",
}[props.state]));

const appealPending = computed(() => props.appeal === "pending");
/** 主按鈕：依狀態三種字；審核中只有取消送審；已發布沒改、被隱藏都沒有送審鈕 */
const submitLabel = computed(() => {
  switch (props.state) {
    case "draft": return t("workshop.publish.action.submit");
    case "livechg": return t("workshop.publish.action.submitUpdate");
    case "rejected": case "liverej": case "returned": return t("workshop.publish.action.resubmit");
  }
  return "";
});
const canWithdraw = computed(() => props.state === "review" || props.state === "liveup");
const canAppeal = computed(() => (props.state === "returned" || props.state === "hidden") && !props.appeal);
/** 送新版（含退件後重送）要寫更新說明：只要有已發布的版本，送出去的就是新版 */
const needsNote = computed(() => Boolean(submitLabel.value) && Boolean(props.draft.published));

const CHECK_KEY: Record<ChecklistItem["key"], string> = {
  basics: "workshop.publish.check.basics",
  cover: "workshop.publish.check.cover",
  rating: "workshop.publish.check.rating",
  content: "workshop.publish.check.content",
  constant: "workshop.publish.check.resident",
  note: "workshop.publish.check.note",
};
const shownChecks = computed(() => props.checklist.filter((c) => c.key !== "note" || needsNote.value));
const blocked = computed(() => shownChecks.value.some((c) => !c.ok));
const ownerIsMe = computed(() => props.draft.card.ownerIsMe);
</script>

<template>
  <div class="pub">
    <!-- 狀態區 -->
    <div class="panel pub__status" data-pub-state :data-state="state">
      <p class="pub__head">
        <span class="chip pub__chip ws-text" :class="tone" data-pub-title>{{ title }}</span>
        <span v-if="appealPending" class="chip ws-chip--warn" data-pub-appeal>{{ $t("workshop.status.appeal") }}</span>
      </p>
      <p v-if="desc" class="muted pub__desc ws-text">{{ desc }}</p>
      <p v-if="appealPending" class="muted pub__desc ws-text">{{ $t("workshop.publish.appeal.pending") }}</p>
      <p v-if="(state === 'rejected' || state === 'liverej') && rejectNote" class="ws-reason" data-pub-reject>{{ $t("workshop.publish.rejectNote", { note: rejectNote }) }}</p>
      <p v-if="(state === 'returned' || state === 'hidden') && ownerReason" class="ws-reason" data-pub-owner-reason>{{ $t("workshop.publish.ownerReason", { reason: ownerReason }) }}</p>
      <p v-if="state === 'rejected' || state === 'liverej'" class="notice notice--error ws-text">{{ $t("workshop.publish.rejected.note") }}</p>
    </div>

    <p v-if="ownerIsMe" class="notice ws-text" data-pub-owner-note>{{ $t("workshop.publish.ownerNote") }}</p>

    <!-- 送審前檢查：只在還能送審的狀態給；「已試玩過」只提醒 -->
    <div v-if="submitLabel" class="panel pub__checks">
      <h3>{{ $t("workshop.publish.check.title") }}</h3>
      <ul>
        <li v-for="c in shownChecks" :key="c.key" :class="{ ok: c.ok }" :data-check="c.key" :data-ok="c.ok">
          <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path v-if="c.ok" d="M3.5 8.5l3 3 6-7" /><circle v-else cx="8" cy="8" r="5.5" />
          </svg>
          <span class="ws-text">{{ $t(CHECK_KEY[c.key], c.key === "note" ? { min: UPDATE_NOTE_MIN, max: UPDATE_NOTE_MAX } : {}) }}</span>
        </li>
        <li :class="{ ok: tried }" data-check="tried">
          <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path v-if="tried" d="M3.5 8.5l3 3 6-7" /><circle v-else cx="8" cy="8" r="5.5" stroke-dasharray="2 2" />
          </svg>
          <span class="ws-text">{{ $t("workshop.publish.check.tried") }}</span>
        </li>
      </ul>
    </div>

    <div v-if="needsNote" class="field">
      <label for="ws-update-note">{{ $t("workshop.publish.note.label") }}</label>
      <textarea id="ws-update-note" autocomplete="off" class="input" rows="3" maxlength="200" :value="draft.updateNote"
                @input="emit('update:note', ($event.target as HTMLTextAreaElement).value)" />
      <span class="field__foot">
        <span class="subtle ws-text">{{ $t("workshop.publish.note.hint") }}</span>
        <span class="subtle count">{{ Array.from(draft.updateNote).length }} / 200</span>
      </span>
    </div>

    <div v-if="submitLabel || canWithdraw || canAppeal" class="pub__acts">
      <button v-if="submitLabel" type="button" class="btn btn--primary btn--lg" :disabled="busy || blocked" data-pub-submit @click="emit('submit')">{{ submitLabel }}</button>
      <button v-if="canWithdraw" type="button" class="btn btn--lg" :disabled="busy" data-pub-withdraw @click="emit('withdraw')">{{ $t("workshop.publish.action.cancelReview") }}</button>
      <button v-if="canAppeal" type="button" class="btn btn--lg" :disabled="busy" data-pub-appeal-btn @click="emit('appeal')">{{ $t("workshop.appeal.title") }}</button>
    </div>

    <!-- 刪除：放最後、跟其他動作隔開，紅色只用在這一顆 -->
    <div class="panel pub__danger">
      <h3>{{ $t("workshop.delete.button") }}</h3>
      <p class="muted ws-text">{{ $t("workshop.delete.hint") }}</p>
      <button type="button" class="btn btn--danger" :disabled="busy" data-pub-delete @click="emit('delete')">
        {{ $t("workshop.delete.button") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.pub { display: grid; gap: var(--s-4); }
.pub .panel { padding: var(--s-4); display: grid; gap: var(--s-2); }
.pub h3 { margin: 0; font-size: 15px; }
.pub__head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); margin: 0; }
/* 狀態名含版號（「已發布・v3，有修改尚未提交」），英文會比 chip 長：允許換行，不截字 */
.pub__chip { height: auto; min-height: 26px; padding-block: 3px; white-space: normal; font-size: 13px; font-weight: 600; line-height: 1.35; }
.pub__desc { margin: 0; font-size: 13.5px; line-height: 1.6; }
.pub .notice { margin: 0; }
.pub__checks ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 14px; color: var(--text-3); }
.pub__checks li { display: flex; align-items: flex-start; gap: var(--s-2); }
.pub__checks li.ok { color: var(--text-2); }
.pub__checks li svg { width: 16px; height: 16px; flex: none; margin-top: 2px; }
.pub__checks li.ok svg { color: var(--success); }
.pub .field { margin: 0; }
.pub textarea.input { resize: vertical; min-height: calc(3 * 1.7em + 26px); }
.count { font-variant-numeric: tabular-nums; }
.pub__acts { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.pub__danger { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 40%, transparent); }
.pub__danger .muted { margin: 0; }
.pub__danger .btn { justify-self: start; }
@media (max-width: 480px) {
  .pub__acts { flex-direction: column; }
  .pub__acts .btn { width: 100%; }
}
</style>
