<script setup lang="ts">
/**
 * 工坊列表裡的一格（ui.md §3.2）：橫式背景圖、名稱（兩行）、作者·加入人數·版本、內容、更新時間、加入。
 * 作者 DLC 列出內容類型（世界書／正則／開場）；玩家擴充只有「世界書 N 條」。
 * 整格點了進詳情（名稱是那個連結，延伸到整格）；「加入」是格上另一個動作，自己是按鈕、不觸發進詳情。
 * 加入後按鈕換成綠色「已加入」chip（不是按鈕）：要移除走詳情或管理。手機（窄於 600）改成左圖右字的橫排。
 * 原卡作者看玩家擴充時多一顆「隱藏」；已隱藏的格淡掉、多「已隱藏」chip，按鈕換成「取消隱藏」。
 */
import { computed } from "vue";
import { RouterLink } from "vue-router";
import ExtensionCover from "./ExtensionCover.vue";
import KindChips from "./KindChips.vue";
import WorkshopIcon from "./WorkshopIcon.vue";
import { useLocalePath } from "@/lib/use-locale";
import { compact, dateOnly } from "@/lib/format";
import type { ExtensionSummary } from "@/lib/workshop";

const props = defineProps<{ ext: ExtensionSummary; joined: boolean; busy?: boolean; canHide?: boolean }>();
const emit = defineEmits<{ join: [ExtensionSummary]; hide: [ExtensionSummary]; unhide: [ExtensionSummary] }>();
const { lp } = useLocalePath();
const to = computed(() => lp(`/workshops/${encodeURIComponent(props.ext.id)}`));
const hidden = computed(() => !!props.canHide && props.ext.ownerState === "hidden");
</script>

<template>
  <article class="ext-tile panel" :class="{ 'ext-tile--hidden': hidden }" :data-ext-kind="ext.kind">
    <ExtensionCover class="ext-tile__cover" :src="ext.coverUrl" :name="ext.name" :adult="ext.adult" />
    <div class="ext-tile__body">
      <h3 class="ext-tile__name"><RouterLink :to="to" class="ext-tile__link">{{ ext.name }}</RouterLink></h3>
      <p class="ext-tile__meta"><span>{{ ext.author.name }}</span><span>{{ $t("workshop.card.installs", { count: compact(ext.joinCount) }) }}</span><span v-if="ext.version">v{{ ext.version }}</span></p>
      <KindChips v-if="ext.kind === 'dlc'" :kinds="ext.kinds" class="ext-tile__kinds" />
      <ul v-else class="ext-tile__kinds ext-tile__chips">
        <li class="chip"><WorkshopIcon name="book" />{{ typeof ext.loreCount === "number" ? $t("workshop.kind.loreCount", { n: ext.loreCount }, ext.loreCount) : $t("workshop.kind.lore") }}</li>
        <li v-if="hidden" class="chip ws-chip--warn" data-ext-hidden>{{ $t("workshop.badge.hidden") }}</li>
      </ul>
      <div class="ext-tile__foot">
        <span class="subtle">{{ $t("workshop.card.updated", { time: dateOnly(ext.updatedAt / 1000) }) }}</span>
        <span class="ext-tile__acts">
          <button v-if="hidden" type="button" class="btn btn--sm" :disabled="busy" data-ext-unhide @click.stop="emit('unhide', ext)">{{ $t("workshop.action.unhide") }}</button>
          <template v-else>
            <span v-if="joined" class="chip ws-chip--ok ext-tile__joined"><WorkshopIcon name="layers" />{{ $t("workshop.detail.joined") }}</span>
            <button v-else type="button" class="btn btn--sm ext-tile__join" :disabled="busy" @click.stop="emit('join', ext)">{{ $t("workshop.detail.join") }}</button>
            <button v-if="canHide" type="button" class="btn btn--sm btn--ghost" :disabled="busy" data-ext-hide @click.stop="emit('hide', ext)">{{ $t("workshop.action.hide") }}</button>
          </template>
        </span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.ext-tile { position: relative; display: grid; grid-template-rows: auto 1fr; overflow: hidden; border-radius: var(--r-md); transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
.ext-tile:hover { transform: translateY(-3px); box-shadow: 0 0 0 1px var(--line), var(--shadow-md); }
.ext-tile--hidden .ext-tile__cover, .ext-tile--hidden .ext-tile__name, .ext-tile--hidden .ext-tile__meta { opacity: .6; }
.ext-tile__body { display: grid; gap: 6px; align-content: start; padding: var(--s-3); min-width: 0; }
.ext-tile__name { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.35; min-height: 2.7em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.ext-tile__link { color: var(--text); }
/* 名稱連結延伸到整格：整格可點進詳情，格上的按鈕疊在它上面 */
.ext-tile__link::after { content: ""; position: absolute; inset: 0; z-index: 1; }
.ext-tile__meta > span + span::before { content: " · "; }
.ext-tile__meta { margin: 0; font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ext-tile__chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; padding: 0; list-style: none; }
.ext-tile__chips .chip { cursor: default; }
.ext-tile__chips .chip:not([class*="ws-chip--"]):hover { background: var(--surface-2); color: var(--text-2); }
.ext-tile__chips .chip svg { width: 13px; height: 13px; }
.ext-tile__foot { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); margin-top: var(--s-1); }
.ext-tile__acts { position: relative; z-index: 2; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; flex: none; }
.ext-tile__joined :deep(svg), .ext-tile__joined svg { width: 13px; height: 13px; }
@media (max-width: 600px) {
  .ext-tile { grid-template-columns: 128px minmax(0, 1fr); grid-template-rows: none; align-items: stretch; }
  /* 圖片不撐高：格子的高度由右側文字決定，圖片鋪滿左欄（直式的圖也不會把格子拉長） */
  .ext-tile__cover { position: relative; height: auto; aspect-ratio: auto; min-height: 96px; }
  .ext-tile__cover :deep(img), .ext-tile__cover :deep(.ext-cover__void) { position: absolute; inset: 0; }
  .ext-tile__name { min-height: 0; font-size: 14px; }
  .ext-tile__foot { flex-wrap: wrap; }
  .ext-tile__chips .chip { height: 22px; font-size: 11px; padding: 0 8px; }
}
</style>
