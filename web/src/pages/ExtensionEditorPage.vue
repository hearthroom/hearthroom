<script setup lang="ts">
/**
 * 建立／編輯擴充（ui.md §3.6、§4.6）。這一頁只是外殼：
 *
 * - /mine/workshops/new?card=<卡號>：替那張卡建立一個空的擴充，成功就換到它的編輯網址。
 *   建立沒有冪等鍵，所以同一時間只送一次，失敗只從按鈕重試，不自動重送（重送可能多出一個空擴充）。
 *   原作者暫停了新的擴充（workshop_closed）時說明並給回卡片頁。
 * - /mine/workshops/:id/edit：交給 WorkshopEditor。以 workshopId 當 key：兩條路由用同一個頁面元件，
 *   從 new 換到 edit 時 Vue 可能沿用這個實例，編輯器得是全新的一個（離開確認、載入都跟著它）。
 */
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, fetchCard } from "@/lib/api";
import { createWorkshop, fetchWorkshopCards } from "@/lib/workshop";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import WorkshopEditor from "@/components/workshop/editor/WorkshopEditor.vue";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { lp, locale } = useLocalePath();
const { t } = useI18n();

const workshopId = computed(() => (typeof route.params.id === "string" ? route.params.id : ""));
const cardParam = computed(() => (typeof route.query.card === "string" ? route.query.card.trim() : ""));

const phase = ref<"creating" | "closed" | "error">("creating");
const error = ref("");
/** 回卡片頁用的卡號：查到才有，沒查到就用網址上帶來的 */
const cardNum = ref("");
let creating = false;

/** 卡號 → 原卡的 roleId（跟卡片頁打工坊端點用的同一個）。先問「能建立擴充的卡」，順便知道有沒有暫停。 */
async function resolveRole(card: string, token: string): Promise<{ roleId: string; closed: boolean }> {
  try {
    const { items } = await fetchWorkshopCards(card, token);
    const hit = items.find((i) => i.cardId === card || String(i.num) === card);
    if (hit) {
      cardNum.value = String(hit.num || hit.cardId);
      return { roleId: hit.roleId, closed: !hit.allowNew };
    }
  } catch { /* 清單讀不到就直接查卡 */ }
  const found = await fetchCard(card, String(locale.value));
  cardNum.value = String(found.num ?? found.id);
  return { roleId: found.roleId, closed: false };
}

async function create() {
  const card = cardParam.value;
  if (creating || workshopId.value) return;
  creating = true;
  phase.value = "creating";
  error.value = "";
  cardNum.value = card;
  try {
    if (!card) throw new Error(t("state.notFound"));
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const { roleId, closed } = await resolveRole(card, token);
    if (closed) { phase.value = "closed"; return; }
    const { workshopId: id } = await createWorkshop(roleId, token);
    await router.replace({ path: lp(`/mine/workshops/${encodeURIComponent(id)}/edit`), query: { section: "basic" } });
  } catch (err) {
    if (err instanceof ApiError && err.code === "workshop_closed") phase.value = "closed";
    else {
      phase.value = "error";
      error.value = err instanceof Error && err.message ? err.message : t("state.actionFailed");
    }
  } finally {
    creating = false;
  }
}

watch([workshopId, cardParam], () => { if (!workshopId.value) void create(); }, { immediate: true });
</script>

<template>
  <div class="page ws-page">
    <WorkshopEditor v-if="workshopId" :key="workshopId" :workshop-id="workshopId" />
    <template v-else>
      <header class="ws-page__head">
        <p class="eyebrow">{{ $t("mine.eyebrow") }}</p>
        <h1 class="display">{{ $t("workshop.create") }}</h1>
      </header>
      <div v-if="phase === 'creating'" class="ws-page__ghosts" aria-hidden="true">
        <div class="ghost" style="height: 40px" /><div class="ghost" style="height: 200px" />
      </div>
      <div v-else-if="phase === 'closed'" class="panel ws-page__closed" data-closed>
        <h2 class="ws-text">{{ $t("workshop.mine.pick.closed") }}</h2>
        <p class="muted ws-text">{{ $t("workshop.paused.closed") }}</p>
        <RouterLink class="btn" :to="lp(`/cards/${encodeURIComponent(cardNum)}`)">{{ $t("workshop.editor.backToCard") }}</RouterLink>
      </div>
      <div v-else class="notice notice--error ws-page__error" role="alert">
        <span class="ws-text">{{ error }}</span>
        <button type="button" class="btn btn--sm" @click="create">{{ $t("library.retry") }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ws-page { display: grid; gap: var(--s-4); }
.ws-page__head { display: grid; gap: var(--s-1); }
.ws-page__head h1 { margin: 0; font-size: 22px; }
.ws-page__head .eyebrow { margin: 0; }
.ws-page__ghosts { display: grid; gap: var(--s-4); max-width: 720px; }
.ws-page__closed { display: grid; gap: var(--s-2); justify-items: start; max-width: 34em; padding: var(--s-5); }
.ws-page__closed h2 { margin: 0; font-size: 17px; }
.ws-page__closed p { margin: 0 0 var(--s-2); }
.ws-page__error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3); max-width: 720px; }
.ws-page__error > span { flex: 1 1 220px; min-width: 0; }
</style>
