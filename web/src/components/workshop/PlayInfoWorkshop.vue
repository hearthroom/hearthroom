<script setup lang="ts">
/**
 * 對話頁資訊面板的「擴充」分頁（ui.md §3.5）：這場對話用了哪些擴充，唯讀。
 *
 * - 開場來自擴充時頂部一句；常駐因為上下文放不下而改成關鍵詞觸發時一條警示（舞台的資訊鍵上同時有小圓點）。
 * - 清單照這場對話定格的順序；每列標使用中／改為關鍵詞觸發／已關閉／已下架。
 * - 調整只影響新對話，所以面板裡不能改；「到工坊管理」開新分頁（面板裡不放會換掉這一頁的連結，換頁會卸載沙盒）。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import ExtensionCover from "./ExtensionCover.vue";
import WorkshopIcon from "./WorkshopIcon.vue";
import { mainSiteLinks } from "@/lib/site";
import { useLocalePath } from "@/lib/use-locale";
import type { WorkshopConversationView } from "@/lib/play-social";

const props = defineProps<{ view: WorkshopConversationView; cardId: string }>();
const { t, locale } = useI18n();
const { lp } = useLocalePath();
const links = computed(() => mainSiteLinks({ locale: String(locale.value), lp }));
const manageUrl = computed(() => `${links.value.origin}${links.value.lp(`/cards/${encodeURIComponent(props.cardId)}`)}?tab=workshop&manage=1`);
const opening = computed(() => (props.view.openingSource?.kind === "workshop" ? props.view.openingSource.workshopName ?? "" : ""));
const fmt = (n: number) => new Intl.NumberFormat(locale.value).format(n);
// 已下架那一列的 chip 只寫「已下架」，「之後的回覆不再套用」放在名稱下面（整句放進 chip 會被截掉）
const STATUS = { resident: "workshop.panel.row.inUse", triggered: "workshop.panel.row.demoted", disabled: "workshop.panel.row.off", removed: "workshop.manage.row.removed" } as const;
const CHIP = { resident: "", triggered: "ws-chip--warn", disabled: "", removed: "ws-chip--bad" } as const;
</script>

<template>
  <div class="pip-ws">
    <p v-if="opening" class="notice pip-ws__opening ws-text"><WorkshopIcon name="open" />{{ t("workshop.panel.openingFrom", { name: opening }) }}</p>
    <p v-if="view.triggeredCount > 0" class="notice pip-ws__warn ws-text" role="status"><WorkshopIcon name="warn" />{{ t("workshop.panel.demoted", { n: view.triggeredCount }) }}</p>
    <ol class="pip-ws__list">
      <li v-for="item in view.items" :key="item.workshopId" class="pip-ws__row" :class="{ 'pip-ws__row--off': item.status === 'disabled' || item.status === 'removed' }">
        <ExtensionCover class="pip-ws__ico" :src="item.coverUrl" :name="item.name" square />
        <span class="pip-ws__text">
          <strong>{{ item.name }}</strong>
          <span v-if="item.status === 'removed'" class="subtle ws-text">{{ t("workshop.panel.row.removed") }}</span>
          <span v-else-if="item.residentChars" class="subtle">{{ t("workshop.manage.row.resident", { chars: fmt(item.residentChars) }) }}</span>
        </span>
        <span class="chip pip-ws__chip" :class="CHIP[item.status]">{{ t(STATUS[item.status]) }}</span>
      </li>
    </ol>
    <p class="subtle ws-text">{{ t("workshop.panel.readonly") }}</p>
    <a class="btn pip-ws__manage" :href="manageUrl" target="_blank" rel="noopener noreferrer">{{ t("workshop.panel.manageLink") }}<span aria-hidden="true">↗</span><span class="sr-only">（{{ t("play.info.newTab") }}）</span></a>
  </div>
</template>

<style scoped>
.pip-ws { display: grid; gap: var(--s-3); }
.pip-ws > p { margin: 0; }
.pip-ws .notice { display: flex; align-items: flex-start; gap: var(--s-2); line-height: 1.6; }
.pip-ws .notice svg { width: 16px; height: 16px; flex: none; margin-top: 3px; }
.pip-ws__opening { background: var(--accent-tint); color: var(--text); }
.pip-ws__warn { background: color-mix(in srgb, var(--warning-text) 12%, var(--surface)); color: var(--text); }
.pip-ws__list { display: grid; gap: var(--s-2); margin: 0; padding: 0; list-style: none; }
.pip-ws__row { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: var(--s-3); padding: var(--s-2) var(--s-3); border-radius: var(--r-md); background: var(--surface-2); }
.pip-ws__row--off .pip-ws__ico, .pip-ws__row--off .pip-ws__text { opacity: 0.62; }
.pip-ws__ico { width: 36px; border-radius: var(--r-sm); }
.pip-ws__text { display: grid; gap: 2px; min-width: 0; }
.pip-ws__text strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pip-ws__chip { cursor: default; max-width: 12em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pip-ws__chip:hover { background: var(--surface-2); color: var(--text-2); }
.pip-ws__manage { justify-self: start; display: inline-flex; gap: 6px; }
</style>
