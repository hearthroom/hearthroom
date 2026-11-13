<script setup lang="ts">
/**
 * 管理已加入的擴充（ui.md §3.4）：桌機 560 寬的視窗，手機從底部升起的 sheet。
 *
 *   一句規則（越下面越優先）→ 字數與建議檔位（只講字數與檔位，不講點數）→ 清單（開關、↑↓）→ 完成。
 *
 * 開關與排序按下就存（伺服器回什麼畫什麼），沒有「儲存」；主行動是「完成」。↑↓ 是基準線（拖曳之後再加），
 * 移動後焦點留在移動後那一列的同一顆鍵。放不下時，最上面那一列標「改為關鍵詞觸發」（照樣開始時會降的那一件）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import ExtensionCover from "./ExtensionCover.vue";
import WorkshopIcon from "./WorkshopIcon.vue";
import { wrapTab } from "@/lib/focus-trap";
import { useSession } from "@/lib/session";
import { firstDemoted, tierLabel, usageState } from "@/lib/workshop";
import { leaveExtension, moveExtension, setEnabled, switchToRecommended, type CardWorkshopState } from "@/lib/card-workshop";

const props = defineProps<{ state: CardWorkshopState }>();
const emit = defineEmits<{ close: []; toast: [string] }>();
const { t, locale } = useI18n();
const session = useSession();
const box = ref<HTMLElement | null>(null);
const error = ref("");

const items = computed(() => props.state.selection?.items ?? []);
const usage = computed(() => props.state.usage);
const level = computed(() => (usage.value ? usageState(usage.value) : null));
const demoted = computed(() => (level.value === "over" ? firstDemoted(items.value) : null));
const recTier = computed(() => tierLabel(usage.value?.recommendedContextTokens));
const curTier = computed(() => tierLabel(usage.value?.currentContextTokens));
const canSwitch = computed(() => level.value !== "ok" && !!usage.value?.recommendedContextTier && usage.value.recommendedContextTier !== usage.value.currentContextTier);
// 類型清單照各語言的列舉寫法（中文、日文用頓號，英文、韓文用逗號）
const kindList = (kinds: string[]) => new Intl.ListFormat(locale.value, { style: "narrow", type: "unit" }).format(kinds.map((k) => t(`workshop.kind.${k}`)));
const chars = (v: number | undefined) => new Intl.NumberFormat(locale.value).format(v ?? 0);

async function run(job: (token: string) => Promise<unknown>) {
  error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    await job(token);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.actionFailed");
  }
}
const toggle = (id: string, on: boolean) => run((tk) => setEnabled(props.state, id, on, tk));
async function move(id: string, delta: -1 | 1) {
  await run((tk) => moveExtension(props.state, id, delta, tk));
  await nextTick();
  // 焦點跟著那一列走：同一顆鍵還能按就留在它上面，到頂（底）了換到另一顆
  const row = box.value?.querySelector<HTMLElement>(`[data-ws-row="${CSS.escape(id)}"]`);
  const same = row?.querySelector<HTMLButtonElement>(delta < 0 ? "[data-move=up]" : "[data-move=down]");
  (same && !same.disabled ? same : row?.querySelector<HTMLButtonElement>(delta < 0 ? "[data-move=down]" : "[data-move=up]"))?.focus();
}
const remove = (id: string, name: string) => run(async (tk) => { await leaveExtension(props.state, id, tk); emit("toast", t("workshop.toast.removed", { name })); });
const switchTier = () => run(async (tk) => { if (await switchToRecommended(props.state, tk)) emit("toast", t("workshop.toast.switched", { tier: curTier.value })); });

let restore: HTMLElement | null = null;
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); emit("close"); return; }
  wrapTab(e, box.value);
}
onMounted(async () => {
  restore = document.activeElement as HTMLElement | null;
  document.addEventListener("keydown", onKey);
  await nextTick();
  box.value?.querySelector<HTMLElement>(".ws-manage__done")?.focus();
});
onBeforeUnmount(() => { document.removeEventListener("keydown", onKey); restore?.focus?.(); });
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop ws-manage-backdrop" @click.self="emit('close')">
      <section ref="box" class="modal panel ws-manage" role="dialog" aria-modal="true" aria-labelledby="ws-manage-title">
        <header class="ws-manage__head">
          <h2 id="ws-manage-title" class="modal__title">{{ $t("workshop.manage.title") }}</h2>
          <button type="button" class="btn btn--ghost btn--icon" :aria-label="$t('dialog.close')" @click="emit('close')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <template v-if="items.length">
          <p class="ws-manage__rule ws-text">{{ $t("workshop.manage.rule") }}</p>

          <div v-if="usage" class="ws-manage__usage" :data-level="level">
            <p class="ws-text">{{ $t("workshop.manage.usage", { extChars: chars(usage.enabledWorkshopConstantChars), cardChars: chars(usage.baseConstantChars), total: chars(usage.totalConstantChars) }) }}</p>
            <div class="ws-manage__tier">
              <strong v-if="recTier">{{ $t("workshop.manage.recommend", { tier: recTier }) }}</strong>
              <span v-if="level === 'ok'" class="chip ws-chip--ok">{{ $t("workshop.manage.status.ok", { tier: curTier }) }}</span>
              <span v-else-if="level === 'soft'" class="chip">{{ $t("workshop.manage.status.low", { tier: curTier }) }}</span>
              <span v-else class="chip ws-chip--warn">{{ $t("workshop.manage.status.over", { tier: curTier }) }}</span>
              <button v-if="canSwitch" type="button" class="btn btn--sm ws-manage__switch" :disabled="state.busy" @click="switchTier">{{ $t("workshop.manage.switch", { tier: recTier }) }}</button>
            </div>
            <p v-if="level === 'soft'" class="subtle ws-text">{{ $t("workshop.manage.low.note") }}</p>
            <p v-else-if="level === 'over'" class="subtle ws-text">{{ $t("workshop.manage.over.note") }}</p>
          </div>

          <ol class="ws-manage__list">
            <li v-for="(item, i) in items" :key="item.workshopId" class="ws-row" :class="{ 'ws-row--off': !item.enabled || item.availability === 'removed' }" :data-ws-row="item.workshopId">
              <span class="ws-row__n">{{ i + 1 }}</span>
              <ExtensionCover class="ws-row__ico" :src="item.coverUrl" :name="item.name" square />
              <span class="ws-row__text">
                <strong>{{ item.name }}</strong>
                <span class="subtle">
                  {{ kindList(item.kinds) }}
                  <template v-if="item.residentChars"> · {{ $t("workshop.manage.row.resident", { chars: chars(item.residentChars) }) }}</template>
                </span>
                <span v-if="item.workshopId === demoted" class="chip ws-chip--warn ws-row__flag"><WorkshopIcon name="warn" />{{ $t("workshop.manage.row.demoted") }}</span>
              </span>
              <span v-if="item.availability === 'removed'" class="ws-row__ctl">
                <span class="chip ws-chip--bad">{{ $t("workshop.manage.row.removed") }}</span>
                <button type="button" class="btn btn--sm" :disabled="state.busy" @click="remove(item.workshopId, item.name)">{{ $t("workshop.detail.remove") }}</button>
              </span>
              <span v-else class="ws-row__ctl">
                <button type="button" class="ws-switch" role="switch" :aria-checked="item.enabled" :aria-label="$t('workshop.manage.a11y.toggle', { name: item.name })" :disabled="state.busy" @click="toggle(item.workshopId, !item.enabled)" />
                <button type="button" class="btn btn--ghost btn--icon btn--sm" data-move="up" :aria-label="$t('workshop.manage.a11y.up', { name: item.name })" :disabled="state.busy || i === 0" @click="move(item.workshopId, -1)"><WorkshopIcon name="up" /></button>
                <button type="button" class="btn btn--ghost btn--icon btn--sm" data-move="down" :aria-label="$t('workshop.manage.a11y.down', { name: item.name })" :disabled="state.busy || i === items.length - 1" @click="move(item.workshopId, 1)"><WorkshopIcon name="down" /></button>
              </span>
            </li>
          </ol>
        </template>
        <div v-else class="ws-manage__empty">
          <strong>{{ $t("workshop.manage.empty.title") }}</strong>
          <p class="subtle ws-text">{{ $t("workshop.manage.empty.body") }}</p>
        </div>

        <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
        <div class="modal__actions">
          <button type="button" class="btn btn--primary ws-manage__done" @click="emit('close')">{{ $t("workshop.manage.done") }}</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.ws-manage { width: min(560px, 100%); gap: var(--s-4); }
.ws-manage__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.ws-manage__head .modal__title { margin: 0; }
.ws-manage__rule { margin: 0; font-size: 13.5px; color: var(--text-2); line-height: 1.6; }
.ws-manage__usage { display: grid; gap: var(--s-2); padding: var(--s-3) var(--s-4); border-radius: var(--r-md); background: var(--surface-2); font-size: 13.5px; }
.ws-manage__usage p { margin: 0; line-height: 1.6; }
.ws-manage__tier { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.ws-manage__switch { margin-inline-start: auto; }
.ws-manage__list { display: grid; gap: var(--s-2); margin: 0; padding: 0; list-style: none; }
.ws-row { display: grid; grid-template-columns: 20px 40px minmax(0, 1fr) auto; align-items: center; gap: var(--s-3); padding: var(--s-2) var(--s-3); border-radius: var(--r-md); background: var(--surface-2); }
.ws-row--off .ws-row__n, .ws-row--off .ws-row__ico, .ws-row--off .ws-row__text { opacity: 0.62; }
.ws-row__n { font-size: 13px; color: var(--text-3); text-align: center; font-variant-numeric: tabular-nums; }
.ws-row__ico { width: 40px; border-radius: var(--r-sm); }
.ws-row__text { display: grid; gap: 2px; min-width: 0; }
.ws-row__text strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-row__text .subtle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-row__flag { justify-self: start; margin-top: 2px; }
.ws-row__ctl { display: flex; align-items: center; gap: 2px; }
.ws-row__ctl .ws-switch { margin-inline-end: var(--s-2); }
.ws-row__ctl svg { width: 16px; height: 16px; }
.ws-manage__empty { display: grid; gap: var(--s-1); padding: var(--s-5) 0; text-align: center; }
.ws-manage__empty p { margin: 0; }
@media (max-width: 480px) {
  /* 手機：從底部升起的 sheet，頂角 24（圓角表外唯一的例外） */
  .ws-manage-backdrop { padding: 0; }
  .ws-manage { width: 100%; max-height: 88dvh; border-radius: 24px 24px 0 0; padding-bottom: calc(var(--s-4) + env(safe-area-inset-bottom)); }
  .ws-manage__switch { margin-inline-start: 0; }
  .ws-row { grid-template-columns: 16px 36px minmax(0, 1fr); }
  .ws-row__ico { width: 36px; }
  .ws-row__ctl { grid-column: 2 / -1; justify-content: flex-end; }
}
</style>
