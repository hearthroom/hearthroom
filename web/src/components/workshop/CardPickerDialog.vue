<script setup lang="ts">
/**
 * 建立擴充的第一步：選一張卡（ui.md §3.6、原型 mine·picker）。桌機 480 寬的視窗，手機從底部升起的 sheet。
 *
 *   搜尋框（卡名或卡號，停手 300 ms 才查）→ 每列封面、卡名、作者・#卡號 → 選了直接進編輯頁。
 *
 * 原作者暫停新增（allowNew=false）的卡照樣列出來但灰掉，寫原因；不藏起來，免得作者以為搜尋壞了。
 * 灰掉的列用 aria-disabled 而不是 disabled：讀屏器還讀得到原因。沒有頁尾：選了就走，關閉在右上。
 * 灰掉的列旁多一顆「重新開放時通知我」（§3.9 ③）：點了直接登記，不再開確認框（已經在彈層裡，少一層）。
 * 這顆鍵不能放進列的 <button> 裡（按鈕不能套按鈕），所以灰列由外層 li 畫框，列本身與登記鍵並排。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import ExtensionCover from "./ExtensionCover.vue";
import WorkshopIcon from "./WorkshopIcon.vue";
import UndoToast from "./UndoToast.vue";
import { wrapTab } from "@/lib/focus-trap";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { fetchWorkshopCards, type WorkshopCardChoice } from "@/lib/workshop";
import { knownInterest, registerWorkshopInterest, rememberInterest, type WorkshopCardChoiceWithInterest } from "@/lib/workshop-moderation";

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const session = useSession();
const router = useRouter();
const { lp } = useLocalePath();
const box = ref<HTMLElement | null>(null);
const search = ref<HTMLInputElement | null>(null);

const query = ref("");
const items = ref<WorkshopCardChoice[]>([]);
const loading = ref(true);
const failed = ref(false);

let seq = 0;
async function load() {
  const n = ++seq;
  loading.value = true;
  failed.value = false;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const got = await fetchWorkshopCards(query.value, token);
    if (n === seq) items.value = got.items;
  } catch {
    if (n === seq) failed.value = true;
  } finally {
    if (n === seq) loading.value = false;
  }
}
let typing: ReturnType<typeof setTimeout> | undefined;
watch(query, () => { clearTimeout(typing); typing = setTimeout(load, 300); });

function pick(card: WorkshopCardChoice) {
  if (!card.allowNew) return;
  emit("close");
  void router.push({ path: lp("/mine/workshops/new"), query: { card: card.cardId } });
}

// ── 重新開放時通知我 ──────────────────────────────────────────────
const toast = ref<InstanceType<typeof UndoToast> | null>(null);
const interestBusy = ref<string | null>(null);
function interested(card: WorkshopCardChoiceWithInterest): boolean {
  const me = session.me;
  return !!me && (knownInterest(me.accountNumId, card.cardId) ?? !!card.viewerInterested);
}
async function register(card: WorkshopCardChoice) {
  const me = session.me;
  if (!me || interestBusy.value) return;
  interestBusy.value = card.cardId;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const got = await registerWorkshopInterest(card.cardId, "", token);
    rememberInterest(me.accountNumId, card.cardId, got.interested);
    toast.value?.say(t("workshop.interest.toast.on"));
  } catch {
    toast.value?.say(t("workshop.interest.error"));
  } finally { interestBusy.value = null; }
}

let restore: HTMLElement | null = null;
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); emit("close"); return; }
  wrapTab(e, box.value);
}
onMounted(async () => {
  restore = document.activeElement as HTMLElement | null;
  document.addEventListener("keydown", onKey);
  void load();
  await nextTick();
  search.value?.focus();
});
onBeforeUnmount(() => { clearTimeout(typing); document.removeEventListener("keydown", onKey); restore?.focus?.(); });
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop ws-pick-backdrop" @click.self="emit('close')">
      <section ref="box" class="modal panel ws-pick" role="dialog" aria-modal="true" aria-labelledby="ws-pick-title">
        <header class="ws-pick__head">
          <h2 id="ws-pick-title" class="modal__title">{{ $t("workshop.mine.pick.title") }}</h2>
          <button type="button" class="btn btn--ghost btn--icon" :aria-label="$t('dialog.close')" @click="emit('close')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <label class="ws-pick__search">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M13 13l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
          <span class="sr-only">{{ $t("workshop.mine.pick.search") }}</span>
          <input ref="search" v-model="query" type="search" class="input" :placeholder="$t('workshop.mine.pick.search')" maxlength="100" enterkeyhint="search" />
        </label>

        <div v-if="loading && !items.length" class="ws-pick__list" aria-hidden="true">
          <div v-for="i in 4" :key="i" class="ghost ws-pick__ghost" />
        </div>
        <div v-else-if="failed" class="notice notice--error ws-pick__error" role="alert">
          <span class="ws-text">{{ $t("workshop.mine.pick.error") }}</span>
          <button type="button" class="btn btn--sm" @click="load">{{ $t("library.retry") }}</button>
        </div>
        <p v-else-if="!items.length" class="subtle ws-pick__none">{{ $t("workshop.mine.pick.empty") }}</p>
        <ul v-else class="ws-pick__list" :aria-busy="loading || undefined">
          <li v-for="card in items" :key="card.cardId" :class="{ 'ws-pick__item--off': !card.allowNew }">
            <button
              type="button" class="ws-pick__row" :class="{ 'ws-pick__row--off': !card.allowNew }" :data-ws-pick="card.cardId"
              :aria-disabled="card.allowNew ? undefined : 'true'" @click="pick(card)"
            >
              <ExtensionCover class="ws-pick__cover" :src="card.avatarUrl ?? ''" :name="card.name" square />
              <span class="ws-pick__text">
                <strong>{{ card.name }}</strong>
                <span v-if="card.allowNew" class="subtle">{{ card.author.name }} · #{{ card.num }}</span>
                <span v-else class="subtle ws-text">{{ $t("workshop.mine.pick.closed") }}</span>
              </span>
              <svg v-if="card.allowNew" class="ws-pick__go" viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5l5 5-5 5" /></svg>
              <WorkshopIcon v-else name="lock" class="ws-pick__go" />
            </button>
            <template v-if="!card.allowNew && session.me">
              <span v-if="interested(card)" class="chip ws-chip--ok ws-pick__interest" :data-ws-pick-interested="card.cardId">{{ $t("workshop.interest.registered") }}</span>
              <button
                v-else type="button" class="btn btn--sm btn--ghost ws-pick__interest" :data-ws-pick-interest="card.cardId"
                :disabled="interestBusy === card.cardId" @click="register(card)"
              >{{ $t("workshop.interest.button") }}</button>
            </template>
          </li>
        </ul>
      </section>
    </div>
    <UndoToast ref="toast" />
  </Teleport>
</template>

<style scoped>
.ws-pick { width: min(480px, 100%); max-height: min(640px, 88dvh); gap: var(--s-3); }
.ws-pick__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.ws-pick__head .modal__title { margin: 0; }
.ws-pick__search { position: relative; display: block; }
.ws-pick__search svg { position: absolute; left: var(--s-3); top: 50%; width: 16px; height: 16px; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }
.ws-pick__search .input { width: 100%; padding-left: calc(var(--s-3) * 2 + 16px); border-radius: var(--r-pill); }
.ws-pick__list { display: grid; gap: var(--s-2); margin: 0; padding: 0; list-style: none; overflow-y: auto; min-height: 0; }
.ws-pick__ghost { height: 60px; border-radius: var(--r-md); }
.ws-pick__error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); }
.ws-pick__none { margin: 0; padding: var(--s-5) 0; text-align: center; }
.ws-pick__row {
  display: grid; grid-template-columns: 44px minmax(0, 1fr) 16px; align-items: center; gap: var(--s-3);
  width: 100%; padding: var(--s-2) var(--s-3); border: 1px solid var(--line); border-radius: var(--r-md);
  background: var(--surface); text-align: start; cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.ws-pick__row:hover { border-color: var(--accent); background: var(--accent-tint); }
.ws-pick__row--off { cursor: not-allowed; }
.ws-pick__row--off:hover { border-color: var(--line); background: var(--surface); }
.ws-pick__row--off .ws-pick__cover, .ws-pick__row--off .ws-pick__text strong { opacity: 0.55; }
.ws-pick__cover { width: 44px; border-radius: var(--r-sm); }
/* 灰列：外層畫框，列與登記鍵並排；放不下時登記鍵換到下一行靠右 */
.ws-pick__item--off { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--s-2); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); }
.ws-pick__item--off .ws-pick__row { flex: 1 1 220px; min-width: 0; border: 0; background: transparent; }
.ws-pick__interest { flex: none; margin: 0 var(--s-2) var(--s-2) auto; }
.ws-pick__item--off .ws-pick__row + .ws-pick__interest { margin-top: var(--s-2); }
.ws-pick__text { display: grid; gap: 2px; min-width: 0; }
.ws-pick__text strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-pick__text .subtle { overflow-wrap: anywhere; }
.ws-pick__go { width: 16px; height: 16px; color: var(--text-3); fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
@media (max-width: 480px) {
  /* 手機：從底部升起的 sheet，頂角 24（圓角表外唯一的例外） */
  .ws-pick-backdrop { padding: 0; }
  .ws-pick { width: 100%; max-height: 88dvh; border-radius: 24px 24px 0 0; padding-bottom: calc(var(--s-4) + env(safe-area-inset-bottom)); }
}
</style>
