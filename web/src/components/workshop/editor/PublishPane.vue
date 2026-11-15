<script setup lang="ts">
/**
 * 編輯頁「發布」分區（docs studio/tasks/2026-11-15-workshop-v2-dlc-and-lorebook/ui.md §3.4）：
 * 狀態區 → 發布前檢查 →（有未發布的修改時）選填的更新說明 → 動作 → 刪除。
 *
 * 三種狀態：草稿（發布＝直接上架）｜已發布（下架＝回到草稿）｜已發布有修改（發布更新、放棄修改）。
 * 沒有審核、退回、申訴。原作者隱藏（玩家擴充）與原卡工坊關閉是另外的標記，常駐在狀態區，沒有動作。
 *
 * 只吃 props、只發事件，請求都在編輯器裡。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ChecklistItem, ExtensionLayer, OwnerState, PublishState, WorkshopDraft } from "@/lib/workshop";
import { UPDATE_NOTE_MAX } from "@/lib/workshop";

const props = defineProps<{
  state: PublishState;
  kind: ExtensionLayer;
  draft: Pick<WorkshopDraft, "published" | "updateNote" | "card">;
  checklist: ChecklistItem[];
  ownerState: OwnerState;
  /** 原卡作者關了這張卡的工坊：不能發布，已發布的暫停套用 */
  workshopClosed: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{
  "update:note": [string];
  publish: [];
  unpublish: [];
  discard: [];
  delete: [];
}>();
const { t } = useI18n();

const live = computed(() => props.draft.published?.version ?? 0);
const hidden = computed(() => props.kind === "lorebook" && props.ownerState === "hidden");
const desc = computed(() => {
  switch (props.state) {
    case "draft": return t("workshop.publish.draft.desc");
    // 被隱藏或工坊關閉時新玩家加不了：不說「玩家可以加入」，由下面那一行說明
    case "live": return hidden.value || props.workshopClosed ? "" : t("workshop.publish.published.desc");
    case "livechg": return t("workshop.publish.dirty.desc", { ver: live.value ? `v${live.value}` : "" });
  }
  return "";
});
const own = computed(() => props.draft.card.ownerIsMe);

const CHECK_KEY: Record<ChecklistItem["key"], string> = {
  basics: "workshop.publish.check.basics",
  rating: "workshop.publish.check.rating",
  content: "workshop.publish.check.content",
  constant: "workshop.publish.check.resident",
};
const checkLabel = (key: ChecklistItem["key"]) => (key === "content" && props.kind === "lorebook" ? t("workshop.publish.check.contentLore") : t(CHECK_KEY[key]));
const blocked = computed(() => props.checklist.some((c) => !c.ok));
/** 草稿一直給檢查清單；發布更新時只在有沒過的項目才出現 */
const showChecks = computed(() => props.state === "draft" || (props.state === "livechg" && blocked.value));
const canPublish = computed(() => props.state !== "live" && !props.workshopClosed);
</script>

<template>
  <div class="pub">
    <!-- 狀態區 -->
    <div class="panel pub__status" data-pub-state :data-state="state">
      <p class="pub__head">
        <span class="chip pub__chip ws-text" :class="{ 'ws-chip--ok': state !== 'draft' }" data-pub-title>
          {{ state === "draft" ? $t("workshop.status.draft") : $t("workshop.status.published") }}<template v-if="state !== 'draft' && live"> · v{{ live }}</template>
        </span>
        <span v-if="state === 'livechg'" class="chip ws-chip--warn" data-pub-changed>{{ $t("workshop.status.hasUnpublishedChanges") }}</span>
        <span v-if="workshopClosed" class="chip ws-chip--warn" data-pub-closed>{{ own ? $t("workshop.status.ownWorkshopClosed") : $t("workshop.status.cardWorkshopClosed") }}</span>
        <span v-if="hidden" class="chip ws-chip--warn" data-pub-hidden>{{ $t("workshop.status.hiddenByOwner") }}</span>
      </p>
      <p v-if="desc" class="muted pub__desc ws-text">{{ desc }}</p>
      <p v-if="workshopClosed" class="muted pub__desc ws-text" data-pub-closed-note>{{ own ? $t("workshop.mine.row.ownWorkshopClosed") : $t("workshop.editor.error.workshopClosed") }}</p>
      <p v-if="hidden" class="muted pub__desc ws-text" data-pub-hidden-note>{{ $t("workshop.mine.row.hiddenByOwner") }}</p>
    </div>

    <div v-if="showChecks" class="panel pub__checks">
      <h3>{{ $t("workshop.publish.check.title") }}</h3>
      <ul>
        <li v-for="c in checklist" :key="c.key" :class="{ ok: c.ok, over: !c.ok && c.key === 'constant' }" :data-check="c.key" :data-ok="c.ok">
          <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path v-if="c.ok" d="M3.5 8.5l3 3 6-7" /><path v-else-if="c.key === 'constant'" d="M4.5 4.5l7 7M11.5 4.5l-7 7" /><circle v-else cx="8" cy="8" r="5.5" />
          </svg>
          <span class="ws-text">{{ checkLabel(c.key) }}</span>
        </li>
      </ul>
    </div>

    <div v-if="state === 'livechg'" class="field">
      <label for="ws-update-note">{{ $t("workshop.publish.note.label") }}</label>
      <textarea id="ws-update-note" autocomplete="off" class="input" rows="3" :maxlength="UPDATE_NOTE_MAX" :value="draft.updateNote"
                @input="emit('update:note', ($event.target as HTMLTextAreaElement).value)" />
      <span class="field__foot">
        <span class="subtle ws-text">{{ $t("workshop.publish.note.hint") }}</span>
        <span class="subtle count">{{ Array.from(draft.updateNote).length }} / {{ UPDATE_NOTE_MAX }}</span>
      </span>
    </div>

    <div v-if="canPublish || state !== 'draft'" class="pub__acts">
      <button v-if="canPublish" type="button" class="btn btn--primary btn--lg" :disabled="busy || blocked" data-pub-publish @click="emit('publish')">
        {{ state === "livechg" ? $t("workshop.publish.action.publishUpdate") : $t("workshop.publish.action.publish") }}
      </button>
      <button v-if="state === 'livechg'" type="button" class="btn btn--lg" :disabled="busy" data-pub-discard @click="emit('discard')">{{ $t("workshop.publish.action.discardChanges") }}</button>
      <button v-if="state === 'live'" type="button" class="btn btn--lg" :disabled="busy" data-pub-unpublish @click="emit('unpublish')">{{ $t("workshop.publish.action.unpublish") }}</button>
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
.pub__chip { height: auto; min-height: 26px; padding-block: 3px; white-space: normal; font-size: 13px; font-weight: 600; line-height: 1.35; }
.pub__desc { margin: 0; font-size: 13.5px; line-height: 1.6; }
.pub .notice { margin: 0; }
.pub__checks ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 14px; color: var(--text-3); }
.pub__checks li { display: flex; align-items: flex-start; gap: var(--s-2); }
.pub__checks li.ok { color: var(--text-2); }
.pub__checks li svg { width: 16px; height: 16px; flex: none; margin-top: 2px; }
.pub__checks li.ok svg { color: var(--success); }
/* 常駐超過上限是「錯了」，不是「還沒填」：紅色叉 */
.pub__checks li.over { color: var(--danger); }
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
