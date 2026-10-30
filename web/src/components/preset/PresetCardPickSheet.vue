<script setup lang="ts">
/**
 * 「套用到某張卡」（PM 2026-10-30）：從我玩過的卡裡選一張，把這份預設設成那張卡的預設——
 * 卡片層的綁定，這張卡的所有存檔下一次回覆開始都用它。
 *
 * 卡的清單用「對話與收藏」那一頁同一支（本站的 /v1/me/conversations），同一張卡多個存檔只列一次。
 * 每張卡目前用哪份預設逐張讀（上游 /player/preset-default），讀不到就不寫那一行，不擋選擇。
 * 套用前再讀一次綁定拿 bindingVersion；別處剛改過（409 preset_revision_conflict）就重讀、再送一次。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/lib/api";
import { contentLang } from "@/lib/i18n";
import { hueFrom } from "@/lib/format";
import { fetchConversations, type ConversationSummary } from "@/lib/library";
import { applyPresetToCard, fetchCardPreset, presetErrorText, resultUnknown, type CardPresetBinding } from "@/lib/presets";
import { useSession } from "@/lib/session";
import { operationKeys } from "@/lib/use-preset-access";
import PresetSheet from "./PresetSheet.vue";

const props = defineProps<{ presetId: string; presetName: string; token: () => Promise<string> }>();
const emit = defineEmits<{ close: []; applied: [card: string]; consent: [err: unknown] }>();
const { t, locale } = useI18n();
const session = useSession();
const ops = operationKeys();

/** 讀幾頁對話：最近玩過的卡通常都在前兩頁，再多就請他用搜尋（搜尋只在讀到的卡裡找） */
const PAGES = 2;
const BINDING_READS = 30;

interface Card { roleId: string; name: string; avatar: string }
const cards = ref<Card[]>([]);
const bindings = ref(new Map<string, CardPresetBinding>());
const loading = ref(true);
const failed = ref(false);
const query = ref("");
const chosen = ref("");
const busy = ref(false);
const error = ref("");

const shown = computed(() => {
  const q = query.value.trim().toLocaleLowerCase();
  return q ? cards.value.filter((c) => c.name.toLocaleLowerCase().includes(q)) : cards.value;
});
const chosenCard = computed(() => cards.value.find((c) => c.roleId === chosen.value) ?? null);
/** 沒有預設的卡不是「換掉」：用另一句（文案 §20 note.fresh） */
const note = computed(() => {
  const b = chosenCard.value && bindings.value.get(chosenCard.value.roleId);
  return b && b.mode === "card_default" ? t("preset.share.cardPick.note.fresh") : t("preset.share.cardPick.note.replace");
});
const usingLine = (roleId: string) => {
  const b = bindings.value.get(roleId);
  if (!b) return "";
  return b.mode === "card_default" || !b.presetId ? t("preset.share.cardPick.row.none") : t("preset.share.cardPick.row.using", { name: b.presetTitle || "" });
};

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const seen = new Map<string, Card>();
    for (let page = 1; page <= PAGES; page++) {
      const res = await fetchConversations(token, contentLang(locale.value), page);
      for (const c of res.conversations as ConversationSummary[]) {
        if (c.canGenerate === false || !c.conversationRoleId || seen.has(c.conversationRoleId)) continue;
        seen.set(c.conversationRoleId, { roleId: c.conversationRoleId, name: c.roleName, avatar: c.roleAvatar });
      }
      if (!res.hasNextPage) break;
    }
    cards.value = [...seen.values()];
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
  void readBindings();
}

/** 每張卡目前的預設：同時送，讀不到的那張就不顯示那一行 */
async function readBindings() {
  let tk: string;
  try { tk = await props.token(); } catch { return; }
  await Promise.all(cards.value.slice(0, BINDING_READS).map(async (c) => {
    try {
      const b = await fetchCardPreset(tk, c.roleId);
      bindings.value = new Map(bindings.value).set(c.roleId, b);
    } catch { /* 這一行不寫，照樣能選 */ }
  }));
}

async function apply() {
  const card = chosenCard.value;
  if (!card || busy.value) return;
  busy.value = true;
  error.value = "";
  const action = `apply:${props.presetId}:${card.roleId}`;
  try {
    const tk = await props.token();
    const send = async () => {
      const current = await fetchCardPreset(tk, card.roleId);
      return applyPresetToCard(tk, { roleId: card.roleId, presetId: props.presetId, expectedVersion: current.bindingVersion }, ops.key(action));
    };
    let result: CardPresetBinding;
    try {
      result = await send();
    } catch (err) {
      // 別處（例如畫布）剛改過這張卡：讀新的版本再送一次，只重試這一次
      if (!(err instanceof ApiError && err.reason === "preset_revision_conflict")) throw err;
      ops.done(action);
      result = await send();
    }
    ops.done(action);
    bindings.value = new Map(bindings.value).set(card.roleId, result);
    emit("applied", card.name);
  } catch (err) {
    if (!resultUnknown(err)) ops.done(action);
    emit("consent", err);
    error.value = resultUnknown(err) ? t("preset.error.unknown") : (err instanceof ApiError && presetErrorText(err)) || t("preset.error.unavailable");
  } finally {
    busy.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <PresetSheet :title="t('preset.share.cardPick.title', { name: presetName })" testid="card-pick-sheet" @close="emit('close')">
    <label class="pick__search">
      <span class="sr-only">{{ $t("preset.share.cardPick.search.label") }}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
      <input v-model="query" type="search" autocomplete="off" class="input" :placeholder="$t('preset.share.cardPick.search.placeholder')" data-testid="card-pick-search" />
    </label>

    <ul v-if="loading" class="pick__list" aria-busy="true">
      <li v-for="n in 3" :key="n" class="pick__ghost ghost" />
    </ul>
    <div v-else-if="failed" class="pick__state" role="alert">
      <p>{{ $t("library.loadFailed") }}</p>
      <button type="button" class="btn btn--sm" @click="load()">{{ $t("library.retry") }}</button>
    </div>
    <div v-else-if="!cards.length" class="pick__state" data-testid="card-pick-empty">
      <p class="pick__stateTitle">{{ $t("preset.share.cardPick.empty.title") }}</p>
      <p class="muted">{{ $t("preset.share.cardPick.empty.body") }}</p>
    </div>
    <p v-else-if="!shown.length" class="muted pick__state" data-testid="card-pick-no-results">{{ $t("preset.share.cardPick.noResults") }}</p>
    <ul v-else class="pick__list" role="radiogroup" :aria-label="$t('preset.share.cardPick.list.label')" data-testid="card-pick-list">
      <li v-for="c in shown" :key="c.roleId">
        <button
          type="button" role="radio" class="pick__row" :class="{ 'pick__row--on': chosen === c.roleId }" :aria-checked="chosen === c.roleId"
          data-testid="card-pick-row" @click="chosen = c.roleId"
        >
          <img v-if="c.avatar" :src="c.avatar" alt="" class="pick__avatar" loading="lazy" />
          <span v-else class="mono pick__avatar" :style="{ '--h': hueFrom(c.name) }" aria-hidden="true">{{ c.name.slice(0, 1) }}</span>
          <span class="pick__text">
            <span class="pick__name">{{ c.name }}</span>
            <span v-if="usingLine(c.roleId)" class="pick__using">{{ usingLine(c.roleId) }}</span>
          </span>
          <span class="pick__radio" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <p v-if="error" class="notice notice--error" role="alert" data-testid="card-pick-error">{{ error }}</p>

    <div class="pick__submit">
      <button type="button" class="btn btn--primary btn--lg" :disabled="!chosenCard || busy" data-testid="card-pick-apply" @click="apply">
        {{ chosenCard ? $t("preset.share.cardPick.apply", { card: chosenCard.name }) : $t("preset.share.detail.applyAction") }}
      </button>
      <p v-if="chosenCard" class="subtle pick__note" data-testid="card-pick-note">{{ note }}</p>
    </div>
  </PresetSheet>
</template>

<style scoped>
.pick__search { position: relative; display: block; }
.pick__search svg { position: absolute; left: 12px; top: 50%; translate: 0 -50%; color: var(--text-3); pointer-events: none; }
.pick__search .input { width: 100%; height: var(--h-lg); padding-left: 36px; }
/* 卡多的時候只在清單裡捲，搜尋框與套用鈕留在原位 */
.pick__list { list-style: none; margin: 0 calc(-1 * var(--s-2)); padding: 0; display: grid; gap: 2px; max-height: min(44dvh, 320px); overflow-y: auto; overscroll-behavior: contain; }
.pick__ghost { height: 56px; margin: 0 var(--s-2); border-radius: var(--r-md); }
.pick__row {
  width: 100%; min-height: 56px; display: flex; align-items: center; gap: var(--s-3); padding: var(--s-2);
  border: 0; border-radius: var(--r-md); background: none; color: inherit; font: inherit; text-align: start; cursor: pointer;
}
.pick__row:hover { background: var(--surface-2); }
.pick__row--on, .pick__row--on:hover { background: var(--accent-tint); }
.pick__avatar { width: 40px; height: 40px; flex: none; border-radius: var(--r-pill); object-fit: cover; font-size: 16px; }
.pick__text { flex: 1; min-width: 0; display: grid; gap: 2px; }
.pick__name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick__using { font-size: 12.5px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick__radio { flex: none; width: 20px; height: 20px; border-radius: var(--r-pill); border: 1.5px solid var(--border-strong); }
.pick__row--on .pick__radio { border: 6px solid var(--accent-text); }
.pick__state { display: grid; gap: var(--s-2); justify-items: start; padding: var(--s-3) 0; }
.pick__state p { margin: 0; }
.pick__stateTitle { font-weight: 600; }
.pick__submit { display: grid; gap: var(--s-2); }
.pick__submit .btn { width: 100%; }
.pick__note { font-size: 12.5px; line-height: 1.6; }
:lang(ko) .pick__note, :lang(ko) .pick__state p { word-break: keep-all; }
</style>
