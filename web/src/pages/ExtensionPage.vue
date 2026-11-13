<script setup lang="ts">
/**
 * 擴充詳情（ui.md §3.3、§4.2）：獨立路由、可分享、不登入也能看。
 *
 *   返回「工坊」→ 16:9 橫圖 → 名稱 → 作者・人數・版本・更新時間 → 類型 chip（成人內容另標）
 *   → 「為《卡名》製作」→ 狀態提示（隱藏、下架）→ 主按鈕列 → 分頁「介紹｜更新紀錄｜評論 N」
 *
 * 主按鈕列四種：未加入（加入）、已加入（綠 chip＋管理＋移除）、已下架（停用鈕，在清單裡多「移除」）、
 * 被隱藏（停用鈕「暫不開放加入」）。能不能加入照伺服器的 availability 畫，網頁不自己判斷；
 * 已加入的玩家伺服器回 open，所以「隱藏」只會出現在沒加入的人面前。
 * 加入、成人門、登入、toast 都走 useExtensionJoin，跟卡片頁工坊分頁同一套。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute, useRouter } from "vue-router";
import NotFoundPage from "@/pages/NotFoundPage.vue";
import CommentPanel from "@/components/CommentPanel.vue";
import ReadmeView from "@/components/ReadmeView.vue";
import AdultConsentDialog from "@/components/AdultConsentDialog.vue";
import ExtensionCover from "@/components/workshop/ExtensionCover.vue";
import ExtensionVersionList from "@/components/workshop/ExtensionVersionList.vue";
import KindChips from "@/components/workshop/KindChips.vue";
import LineTabs from "@/components/workshop/LineTabs.vue";
import ManageDialog from "@/components/workshop/ManageDialog.vue";
import UndoToast from "@/components/workshop/UndoToast.vue";
import WorkshopIcon from "@/components/workshop/WorkshopIcon.vue";
import { ApiError } from "@/lib/api";
import { cardThumb } from "@/lib/card-thumb";
import { renderReadme } from "@/lib/card-readme";
import { cardWorkshop, isJoined, loadCardWorkshop } from "@/lib/card-workshop";
import { displayHtml, displayName } from "@/lib/display-name";
import { compact, dateOnly, hueFrom } from "@/lib/format";
import { pageTitle } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useExtensionJoin } from "@/lib/use-extension-join";
import { useLocalePath } from "@/lib/use-locale";
import { fetchWorkshop, type ExtensionDetail } from "@/lib/workshop";

const route = useRoute();
const router = useRouter();
const { locale, lp } = useLocalePath();
const { t } = useI18n();
const session = useSession();

const id = computed(() => String(route.params.id ?? ""));
const ext = ref<ExtensionDetail | null>(null);
const loading = ref(true);
const missing = ref(false);
const error = ref("");
const commentCount = ref(0);

// 「加入了沒」「能不能加入」是看人的：身分常在第一幀之後才到，到了要帶 token 重讀一次。
// 同時可能有好幾次讀取在路上（進頁、身分到、換網址），只認最後一次。
let generation = 0;
async function load() {
  const g = ++generation;
  const wid = id.value;
  const shown = ext.value?.id === wid;
  if (!shown) { ext.value = null; loading.value = true; }
  missing.value = false;
  error.value = "";
  try {
    const token = session.me ? await session.accessToken() : null;
    const got = await fetchWorkshop(wid, token);
    if (g !== generation) return;
    ext.value = got;
    commentCount.value = got.commentCount;
    void loadSelection();
  } catch (err) {
    if (g !== generation) return;
    // 已經畫出來的那份（身分到了的重讀失敗）留著，不換成錯誤
    if (shown && ext.value) return;
    if (err instanceof ApiError && err.status === 404) missing.value = true;
    else error.value = t("workshop.detail.loadFailed");
  } finally {
    if (g === generation) loading.value = false;
  }
}
watch([id, () => session.me?.accountNumId ?? null], () => { void load(); }, { immediate: true });

const shownName = computed(() => displayName(ext.value?.name ?? "", locale.value));
watch(shownName, (name) => { if (name) document.title = pageTitle(name); }, { immediate: true });

// ── 玩家自己的清單（登入才有）────────────────────────────────────────
// 跟卡片頁共用同一份（照 roleId 存在模組裡）：在這裡按了加入，回卡片頁不必重讀
const wsState = computed(() => (ext.value && session.me ? cardWorkshop(ext.value.card.roleId) : null));
async function loadSelection() {
  const s = wsState.value;
  if (!s || s.status === "loading" || s.status === "ready") return;
  const token = await session.accessToken();
  if (token) await loadCardWorkshop(s, token);
}
/** 清單讀到之後以清單為準（移除後要立刻變回「加入」）；讀到之前先用詳情帶的旗標 */
const joined = computed(() => {
  const e = ext.value, s = wsState.value;
  if (!e) return false;
  return s?.selection ? isJoined(s, e.id) : !!e.joined;
});
type Mode = "join" | "joined" | "removed" | "hidden";
const mode = computed<Mode>(() => {
  const e = ext.value;
  if (e?.availability === "removed") return "removed";
  if (joined.value) return "joined";
  if (e?.availability === "hidden") return "hidden";
  return "join";
});

const toast = ref<InstanceType<typeof UndoToast> | null>(null);
// 已下架的擴充移除後不給「復原」：它已經不能再加入，復原只會換來一個錯誤
const say = (text: string, undo?: () => void) => toast.value?.say(text, ext.value?.availability === "removed" ? undefined : undo);
const joiner = useExtensionJoin(() => wsState.value, say);
const busy = computed(() => !!ext.value && joiner.busy.value === ext.value.id);
const manageOpen = ref(false);
function join() { if (ext.value) void joiner.join(ext.value); }
function leave() { if (ext.value) void joiner.leave(ext.value); }

// ── 分頁：記在網址（?tab=log|comments），介紹不帶參數 ───────────────────
type Tab = "about" | "log" | "comments";
const tab = computed<Tab>(() => (route.query.tab === "log" ? "log" : route.query.tab === "comments" ? "comments" : "about"));
const tabs = computed(() => [
  { key: "about" as const, label: t("workshop.detail.tab.about") },
  { key: "log" as const, label: t("workshop.detail.tab.versions") },
  { key: "comments" as const, label: t("workshop.detail.tab.comments", { n: compact(commentCount.value) }) },
]);
function setTab(next: Tab) {
  if (next === tab.value) return;
  // 推一筆歷史：手機返回鍵回到上一個分頁
  void router.push({ query: { ...route.query, tab: next === "about" ? undefined : next } });
}
const commentTarget = computed(() => (ext.value ? { kind: "workshop" as const, workshopId: ext.value.id } : null));

// ── 版面上的字 ──────────────────────────────────────────────────────
const cardPath = computed(() => (ext.value ? `/cards/${ext.value.card.num || ext.value.card.id}` : "/"));
const meta = computed(() => {
  const e = ext.value;
  if (!e) return "";
  return t("workshop.detail.meta", {
    by: e.author.name, count: compact(e.joinCount), ver: e.version ? `v${e.version}` : "", time: dateOnly(e.updatedAt / 1000),
  });
});
const cardName = computed(() => displayName(ext.value?.card.name ?? "", locale.value));
const cardArt = computed(() => (ext.value?.card.avatarUrl ? cardThumb(ext.value.card.avatarUrl) : ""));
const cardArtFailed = ref(false);
watch(cardArt, () => { cardArtFailed.value = false; });
const readmeHtml = computed(() => {
  const source = ext.value?.readme ?? "";
  return source.trim() ? displayHtml(renderReadme(source), locale.value) : "";
});
const ICONS = { lore: "book", regex: "ui", opening: "open" } as const;
const includes = computed(() => {
  const c = ext.value?.contents;
  if (!c) return [];
  return ([["lore", c.loreCount], ["regex", c.ruleCount], ["opening", c.openingCount]] as const)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => ({ key, icon: ICONS[key], label: t(`workshop.detail.includes.${key}`, { n }, n), desc: t(`workshop.detail.includes.${key}.desc`) }));
});
const resident = computed(() => {
  const n = ext.value?.residentChars ?? 0;
  return n > 0 ? t("workshop.detail.resident", { chars: new Intl.NumberFormat(locale.value).format(n) }) : t("workshop.detail.resident.none");
});
</script>

<template>
  <NotFoundPage v-if="missing" :title="$t('workshop.detail.notFound.title')" :hint="$t('workshop.detail.notFound.hint')" />

  <div v-else class="page ext">
    <!-- 骨架照真的版面畫：返回、橫圖、名稱、資訊、按鈕、分頁 -->
    <div v-if="loading" class="ext__skeleton" aria-hidden="true" data-ext-skeleton>
      <div class="ghost" style="height: 20px; width: 72px" />
      <div class="ghost ext__cover" />
      <div class="ghost" style="height: 30px; width: 60%" />
      <div class="ghost" style="height: 16px; width: 80%" />
      <div class="ghost" style="height: 56px; border-radius: var(--r-lg)" />
      <div class="ghost" style="height: 44px; width: 120px; border-radius: var(--r-pill)" />
      <div class="ghost" style="height: 44px" />
      <div class="ghost" style="height: 200px; border-radius: var(--r-lg)" />
    </div>

    <div v-else-if="error" class="notice notice--error ext__error" role="alert">
      <span class="ws-text">{{ error }}</span>
      <button type="button" class="btn btn--sm" @click="load">{{ $t("library.retry") }}</button>
    </div>

    <template v-else-if="ext">
      <RouterLink :to="lp(`${cardPath}?tab=workshop`)" class="ext__back" :aria-label="$t('workshop.detail.back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        <span>{{ $t("workshop.tab.workshop") }}</span>
      </RouterLink>

      <ExtensionCover class="ext__cover" :src="ext.coverUrl" :name="ext.name" :adult="ext.adult" />

      <header class="ext__head">
        <h1 class="ext__name ws-text">{{ shownName }}</h1>
        <p class="ext__meta">{{ meta }}</p>
        <div class="ext__chips">
          <span v-if="ext.adult" class="chip ws-chip--bad" data-ext-adult>{{ $t("workshop.badge.adult") }}</span>
          <KindChips :kinds="ext.kinds" />
        </div>
      </header>

      <RouterLink :to="lp(cardPath)" class="panel ext__card">
        <img v-if="cardArt && !cardArtFailed" class="ext__card-art" :src="cardArt" alt="" loading="lazy" @error="cardArtFailed = true" />
        <span v-else class="mono ext__card-art" :style="{ '--h': hueFrom(ext.card.name || '?') }" aria-hidden="true">{{ [...(cardName || "?")][0] }}</span>
        <span class="ext__card-text ws-text">{{ $t("workshop.detail.forCard", { card: cardName }) }}</span>
        <svg class="ext__card-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
      </RouterLink>

      <p v-if="mode === 'hidden'" class="notice ext__notice" role="status" data-ext-note="hidden">
        <WorkshopIcon name="lock" /><span class="ws-text">{{ $t("workshop.detail.hidden.note") }}</span>
      </p>
      <p v-else-if="mode === 'removed'" class="notice notice--error ext__notice" role="status" data-ext-note="removed">
        <WorkshopIcon name="warn" /><span class="ws-text">{{ $t(joined ? "workshop.detail.removed.noteAdded" : "workshop.detail.removed.note") }}</span>
      </p>

      <div class="ext__actions" :data-ext-mode="mode">
        <template v-if="mode === 'join'">
          <button type="button" class="btn btn--primary btn--lg ext__primary" data-ext-join :disabled="busy" :aria-busy="busy || undefined" @click="join">{{ $t("workshop.detail.join") }}</button>
        </template>
        <template v-else-if="mode === 'joined'">
          <span class="chip ws-chip--ok ext__joined" data-ext-joined>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
            {{ $t("workshop.detail.joined") }}
          </span>
          <button v-if="wsState" type="button" class="btn btn--lg" data-ext-manage @click="manageOpen = true">{{ $t("workshop.strip.manage") }}</button>
          <button type="button" class="btn btn--ghost btn--lg" data-ext-leave :disabled="busy" @click="leave">{{ $t("workshop.detail.remove") }}</button>
        </template>
        <template v-else-if="mode === 'removed'">
          <button type="button" class="btn btn--lg" disabled data-ext-disabled>{{ $t("workshop.detail.removed.chip") }}</button>
          <button v-if="joined" type="button" class="btn btn--lg" data-ext-leave :disabled="busy" @click="leave">{{ $t("workshop.detail.remove") }}</button>
        </template>
        <template v-else>
          <button type="button" class="btn btn--lg" disabled data-ext-disabled>{{ $t("workshop.detail.hidden.button") }}</button>
        </template>
      </div>

      <LineTabs class="ext__tabs" :tabs="tabs" :model-value="tab" :label="$t('workshop.detail.tabs')" id-prefix="ext" @update:model-value="setTab" />

      <div id="ext-panel" class="ext__panel" role="tabpanel" :aria-labelledby="`ext-tab-${tab}`">
        <template v-if="tab === 'about'">
          <section class="panel ext__section" aria-labelledby="ext-about-h">
            <h2 id="ext-about-h" class="sr-only">{{ $t("workshop.detail.tab.about") }}</h2>
            <ReadmeView v-if="readmeHtml" :html="readmeHtml" />
            <p v-else class="ext__summary">{{ displayName(ext.summary, locale) }}</p>
          </section>

          <section class="panel ext__section" aria-labelledby="ext-includes-h">
            <h2 id="ext-includes-h" class="ext__h2">{{ $t("workshop.detail.includes") }}</h2>
            <ul v-if="includes.length" class="ext__includes">
              <li v-for="item in includes" :key="item.key" :data-include="item.key">
                <span class="ext__inc-icon"><WorkshopIcon :name="item.icon" /></span>
                <span class="ext__inc-text">
                  <strong>{{ item.label }}</strong>
                  <span class="ws-text">{{ item.desc }}</span>
                </span>
              </li>
            </ul>
            <p class="notice ext__resident" data-ext-resident>
              <WorkshopIcon name="info" /><span class="ws-text">{{ resident }}</span>
            </p>
          </section>

          <div class="ext__report">
            <RouterLink class="btn btn--ghost btn--sm" :to="lp(`/me?reportWorkshop=${encodeURIComponent(ext.id)}`)">{{ $t("workshop.detail.report") }}</RouterLink>
          </div>
        </template>

        <ExtensionVersionList v-else-if="tab === 'log'" :key="ext.id" class="panel ext__section" :workshop-id="ext.id" />

        <div v-else-if="commentTarget" class="panel ext__section ext__comments">
          <CommentPanel :key="ext.id" :target="commentTarget" @count="commentCount = $event" />
        </div>
      </div>
    </template>

    <ManageDialog v-if="manageOpen && wsState" :state="wsState" @close="manageOpen = false" @toast="say" />
    <AdultConsentDialog v-if="joiner.askingAdult.value" @close="joiner.askingAdult.value = null" @done="joiner.adultDone" />
    <UndoToast ref="toast" />
  </div>
</template>

<style scoped>
/* 窄頁：.page--narrow 是 640，這頁要放 16:9 大圖，照原型用 720 */
.ext { max-width: 720px; display: grid; gap: var(--s-4); align-content: start; }
.ext__skeleton { display: grid; gap: var(--s-4); }
.ext__error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); }

.ext__back { display: inline-flex; align-items: center; gap: 2px; justify-self: start; min-height: var(--h-sm); padding-inline-end: var(--s-2); font-size: 14px; font-weight: 500; color: var(--text-2); }
.ext__back:hover { color: var(--text); }
.ext__back svg { width: 18px; height: 18px; }

/* 橫圖：16:9，但 720 寬時會有 405 高，壓在 300 以內（置中裁切） */
.ext__cover { width: 100%; aspect-ratio: 16 / 9; max-height: 300px; border-radius: var(--r-lg); }

.ext__head { display: grid; gap: var(--s-2); min-width: 0; }
.ext__name { margin: 0; font-size: 24px; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
.ext__meta { margin: 0; font-size: 13px; color: var(--text-3); overflow-wrap: anywhere; }
.ext__chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }

.ext__card { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-2) var(--s-3); color: var(--text); border-radius: var(--r-lg); transition: background var(--dur) var(--ease); }
.ext__card:hover { background: var(--surface-2); }
.ext__card-art { width: 40px; height: 40px; flex: none; border-radius: var(--r-sm); object-fit: cover; font-size: 16px; }
.ext__card-text { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.ext__card-go { width: 18px; height: 18px; flex: none; color: var(--text-3); }

.ext__notice { display: flex; align-items: flex-start; gap: var(--s-2); margin: 0; line-height: 1.6; }
.ext__notice svg, .ext__resident svg { width: 16px; height: 16px; flex: none; margin-top: 3px; }

.ext__actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.ext__primary { min-width: 8em; }
.ext__joined { height: var(--h-lg); padding: 0 var(--s-4); font-size: 14px; font-weight: 600; }
.ext__joined svg { width: 16px; height: 16px; }

.ext__tabs { margin-top: var(--s-2); }
.ext__panel { display: grid; gap: var(--s-4); min-width: 0; }
.ext__section { padding: var(--s-5); min-width: 0; }
.ext__summary { margin: 0; font-size: 15px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
.ext__h2 { margin: 0 0 var(--s-3); font-size: 15px; font-weight: 600; }
.ext__includes { display: grid; gap: var(--s-3); margin: 0 0 var(--s-4); padding: 0; list-style: none; }
.ext__includes li { display: flex; align-items: flex-start; gap: var(--s-3); }
.ext__inc-icon { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex: none; border-radius: var(--r-sm); background: var(--accent-tint); color: var(--accent-text); }
.ext__inc-icon svg { width: 16px; height: 16px; }
.ext__inc-text { display: grid; gap: 2px; min-width: 0; }
.ext__inc-text strong { font-size: 14px; font-weight: 600; }
.ext__inc-text span { font-size: 13px; line-height: 1.6; color: var(--text-2); }
.ext__resident { display: flex; align-items: flex-start; gap: var(--s-2); margin: 0; line-height: 1.6; }
.ext__report { display: flex; justify-content: center; }

@media (max-width: 760px) {
  .ext__section { padding: var(--s-4); }
  .ext__actions .btn--lg { flex: 1 1 auto; }
  .ext__joined { flex: none; }
}
@media (max-width: 480px) {
  .ext__name { font-size: 22px; }
}
</style>
