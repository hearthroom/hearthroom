<script setup lang="ts">
/**
 * 檢舉一則留言：五個理由選一個、可以補一句說明。送出失敗留在框裡，選的理由與說明都還在。
 * 由留言面板開關（v-if）；送出成功回 reported，面板負責說謝謝。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { REPORT_REASONS, reportComment, type ReportReason } from "@/lib/api";
import { useSession } from "@/lib/session";
import { wrapTab } from "@/lib/focus-trap";

const props = defineProps<{ commentId: string }>();
const emit = defineEmits<{ close: []; reported: [folded: boolean] }>();
const { t } = useI18n();
const session = useSession();

const reason = ref<ReportReason | null>(null);
const note = ref("");
const sending = ref(false);
const error = ref("");
const box = ref<HTMLElement | null>(null);
const NOTE_MAX = 300;

async function submit() {
  if (!reason.value || sending.value) return;
  sending.value = true;
  error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const res = await reportComment(props.commentId, { reason: reason.value, note: note.value.trim() }, token);
    emit("reported", !!res.folded);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    sending.value = false;
  }
}

/** 開啟前的焦點：關掉時還回去 */
let restore: HTMLElement | null = null;
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); emit("close"); return; }
  wrapTab(e, box.value);
}
onMounted(async () => {
  restore = document.activeElement as HTMLElement | null;
  document.addEventListener("keydown", onKey);
  await nextTick();
  box.value?.querySelector<HTMLElement>("input")?.focus();
});
onBeforeUnmount(() => { document.removeEventListener("keydown", onKey); restore?.focus?.(); });
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <form ref="box" class="modal panel" role="dialog" aria-modal="true" aria-labelledby="report-title" @submit.prevent="submit">
        <h2 id="report-title" class="modal__title">{{ $t("comment.reportTitle") }}</h2>
        <fieldset class="report__reasons">
          <legend class="sr-only">{{ $t("comment.reportTitle") }}</legend>
          <label v-for="r in REPORT_REASONS" :key="r" class="report__reason">
            <input v-model="reason" type="radio" name="report-reason" :value="r" />
            <span>{{ $t(`comment.reportReason.${r}`) }}</span>
          </label>
        </fieldset>
        <label class="report__note">
          <span class="subtle">{{ $t("comment.reportNote") }}</span>
          <textarea v-model="note" class="input" rows="3" :maxlength="NOTE_MAX" />
        </label>
        <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
        <div class="modal__actions">
          <button type="button" class="btn" @click="emit('close')">{{ $t("dialog.cancel") }}</button>
          <button type="submit" class="btn btn--primary" :disabled="!reason || sending">{{ $t("comment.reportSubmit") }}</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.report__reasons { margin: 0; padding: 0; border: 0; display: grid; gap: var(--s-1); }
.report__reason { display: flex; align-items: center; gap: var(--s-2); min-height: 40px; padding: 0 var(--s-3); border-radius: var(--r-sm); font-size: 14px; cursor: pointer; }
.report__reason:hover { background: var(--surface-2); }
.report__reason input { margin: 0; accent-color: var(--accent); }
.report__note { display: grid; gap: 6px; }
</style>
