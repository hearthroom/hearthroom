<script setup lang="ts">
/**
 * 使用者設定：標準 App 的設定列表（owner 2026-11-03；規格 docs/studio/tasks/2026-11-03-settings-ia/ui.md）。
 *
 * 第一層是三群列表，點進去是 /settings/<區>。版面看這一頁自己的寬度（容器查詢），不看視窗：
 *   - ≤760：/settings 只有列表；/settings/<區> 換成該區的二級頁，最上面一顆返回鈕回列表。
 *   - ≥761：左邊列表、右邊面板；/settings 沒指定區時右邊預設第一區，網址不改寫。
 * 同一條路由記錄，換區不重新掛載，捲動位置不動（router.ts 的 scrollFor）。
 * 各區的內容在 components/settings/，行為與改版前一樣，只是從一整頁拆開。
 * 「通知」是另一整頁，列在列表裡但點了直接離開設定。
 * 舊的 /settings#hidden 這類深連結在 router.ts 的 settingsRedirect 換到新的區。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch, type Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import AccountIcon from "@/components/AccountIcon.vue";
import { can } from "@/lib/provider";
import { pageTitle } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import { isSettingsSection, type SettingsSection } from "@/lib/settings-sections";
import SettingsProfile from "@/components/settings/SettingsProfile.vue";
import SettingsPlay from "@/components/settings/SettingsPlay.vue";
import SettingsContent from "@/components/settings/SettingsContent.vue";
import SettingsAppearance from "@/components/settings/SettingsAppearance.vue";
import SettingsLinks from "@/components/settings/SettingsLinks.vue";
import SettingsHelp from "@/components/settings/SettingsHelp.vue";

type Icon = InstanceType<typeof AccountIcon>["$props"]["name"];
type Row = { id: SettingsSection | "notifications"; icon: Icon; label: string; hint: string; to: string; external?: boolean };

const { t } = useI18n();
const { lp } = useLocalePath();
const route = useRoute();
const router = useRouter();

const PANES: Record<SettingsSection, Component> = {
  profile: SettingsProfile, play: SettingsPlay, content: SettingsContent,
  appearance: SettingsAppearance, links: SettingsLinks, help: SettingsHelp,
};
const LABELS: Record<SettingsSection, string> = {
  profile: "settings.section.profile", play: "settings.section.play", content: "settings.content.title",
  appearance: "settings.section.appearance", links: "settings.section.links", help: "settings.section.help",
};
const label = (s: SettingsSection) => t(LABELS[s]);

/** 網址上的區；沒有就是列表本身 */
const section = computed<SettingsSection | null>(() => (isSettingsSection(route.params.section) ? route.params.section : null));
/** 右邊（或二級頁）顯示的區：桌機沒指定時預設第一區 */
const active = computed<SettingsSection>(() => section.value ?? "profile");

const groups = computed<Row[][]>(() => [
  [
    { id: "profile", icon: "person", label: label("profile"), hint: t("settings.section.profileHint"), to: lp("/settings/profile") },
    { id: "notifications", icon: "bell", label: t("nav.notifications"), hint: t("settings.section.notificationsHint"), to: lp("/me/notifications"), external: true },
    { id: "links", icon: "link", label: label("links"), hint: t("settings.section.linksHint"), to: lp("/settings/links") },
  ],
  [
    // 這一家沒有遊玩人設：整列不畫，不放一個空的區
    ...(can("persona") ? [{ id: "play", icon: "chat", label: label("play"), hint: t("settings.persona.title"), to: lp("/settings/play") } as Row] : []),
    { id: "content", icon: "eye", label: label("content"), hint: t("settings.section.contentHint"), to: lp("/settings/content") },
    { id: "appearance", icon: "contrast", label: label("appearance"), hint: t("settings.section.appearanceHint"), to: lp("/settings/appearance") },
  ],
  [{ id: "help", icon: "lifebuoy", label: label("help"), hint: t("settings.section.helpHint"), to: lp("/settings/help") }],
]);

/** 這一頁夠寬（兩欄）時才算「桌機」：只用來決定標題層級與預設選中的那列；顯示與否交給 CSS 容器查詢 */
const root = ref<HTMLElement | null>(null);
const wide = ref(false);
let observer: ResizeObserver | null = null;
onMounted(() => {
  if (typeof ResizeObserver === "undefined" || !root.value) return;
  observer = new ResizeObserver(([entry]) => { wide.value = (entry?.contentRect.width ?? 0) > 760; });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

const isCurrent = (row: Row) => row.id === section.value || (wide.value && !section.value && row.id === "profile");
const paneTitle = useId();

/** 返回列表：從列表點進來的就退一步（瀏覽器的上一頁也是同一個結果），從深連結直接進來的換到列表 */
function back() {
  const list = lp("/settings");
  const from = router.options.history.state.back;
  if (typeof from === "string" && from.split(/[?#]/)[0] === list) router.back();
  else void router.push(list);
}

/** 帶 # 進來（舊深連結轉過來的、榜單「已隱藏 N 類」）：捲到那張卡 */
watch(() => [route.path, route.hash] as const, ([, hash]) => {
  if (!hash) return;
  void nextTick(() => requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" })));
}, { immediate: true });

watch(section, (s) => { document.title = pageTitle(s ? `${label(s)} · ${t("settings.title")}` : t("settings.title")); }, { immediate: true });
</script>

<template>
  <div ref="root" class="settings" :class="{ 'settings--root': !section }">
    <div class="page settings__page">
      <nav class="settings__nav" data-settings-nav :aria-label="$t('settings.title')">
        <h1 class="settings__title display">{{ $t("settings.title") }}</h1>
        <div v-for="(group, i) in groups" :key="i" class="panel settings__group">
          <RouterLink
            v-for="row in group"
            :key="row.id"
            :to="row.to"
            class="srow"
            :class="{ 'is-on': isCurrent(row), 'is-default': !section && row.id === 'profile' }"
            :aria-current="isCurrent(row) ? 'page' : undefined"
          >
            <span class="srow__ic"><AccountIcon :name="row.icon" /></span>
            <span class="srow__text"><strong class="srow__label">{{ row.label }}</strong><span class="srow__hint">{{ row.hint }}</span></span>
            <svg v-if="row.external" class="srow__go" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11l6-6M6 5h5v5" /></svg>
            <svg v-else class="srow__go" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
          </RouterLink>
        </div>
      </nav>

      <section class="settings__pane" :data-settings-section="active" :aria-labelledby="paneTitle">
        <button type="button" class="settings__back" @click="back">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          {{ $t("settings.title") }}
        </button>
        <component :is="wide ? 'h2' : 'h1'" :id="paneTitle" class="settings__pane-title display">{{ label(active) }}</component>
        <component :is="PANES[active]" :key="active" />
      </section>
    </div>
  </div>
</template>

<style scoped>
/* 容器查詢的容器：整個主內容寬，手機／桌機的切換點 760／761 跟其他頁的手機版切換對齊 */
.settings { container-type: inline-size; }
.settings__page { display: grid; gap: var(--s-5); }
.settings__title, .settings__pane-title { font-size: clamp(20px, 2.6vw, 24px); margin: 0; }
.settings__title { margin-bottom: var(--s-4); }
.settings__pane-title { margin-bottom: var(--s-4); }

.settings__group { display: grid; padding: 4px; }
.settings__group + .settings__group { margin-top: var(--s-4); }
.srow {
  display: flex; align-items: center; gap: var(--s-3);
  min-height: 56px; padding: var(--s-2) var(--s-3);
  border-radius: var(--r-md); color: var(--text);
  transition: background var(--dur) var(--ease);
}
.srow:hover { background: var(--surface-2); }
.srow__ic {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 32px; height: 32px; border-radius: var(--r-sm);
  background: var(--accent-tint); color: var(--accent-text);
}
.srow__ic svg { width: 18px; height: 18px; stroke-width: 1.6; }
.srow__text { display: grid; gap: 2px; min-width: 0; flex: 1; }
.srow__label { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.srow__hint { font-size: 12.5px; color: var(--text-3); overflow-wrap: anywhere; }
.srow__go { width: 16px; height: 16px; flex: none; fill: none; stroke: var(--text-3); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

.settings__back {
  display: inline-flex; align-items: center; gap: 2px;
  min-height: 44px; margin-inline-start: -8px; padding: 0 var(--s-2) 0 0;
  background: none; border: 0; border-radius: var(--r-sm);
  font: inherit; font-size: 15px; font-weight: 500; color: var(--accent-text); cursor: pointer;
}
.settings__back svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

.settings__pane { min-width: 0; }

/* 手機：列表與二級頁二選一 */
@container (max-width: 760px) {
  .settings--root .settings__pane { display: none; }
  .settings:not(.settings--root) .settings__nav { display: none; }
}
/* 桌機：左列表（sticky）＋右面板 */
@container (min-width: 761px) {
  .settings__page { grid-template-columns: clamp(220px, 28%, 280px) minmax(0, 1fr); align-items: start; }
  .settings__nav { position: sticky; top: calc(var(--header-h) + 16px); }
  .settings__pane { max-width: 680px; }
  .settings__back { display: none; }
  .srow.is-on, .settings--root .srow.is-default { background: var(--accent-tint); }
  .srow.is-on .srow__go, .settings--root .srow.is-default .srow__go { stroke: var(--accent-text); }
}
:lang(ko) .srow__text, :lang(ko) .settings__pane { word-break: keep-all; }
</style>

<!-- 各區共用的列、開關、卡：改版前整頁共用的那一套，拆成六個元件後放在這裡一份 -->
<style>
.settings .set-card { padding: var(--s-4); display: grid; gap: var(--s-3); }
.settings .set-card + .set-card { margin-top: var(--s-4); }
.settings .set-card__head { display: flex; align-items: center; gap: var(--s-2); margin: 0; }
.settings .content__row { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); cursor: pointer; }
.settings .content__text { display: grid; gap: 2px; min-width: 0; }
.settings .content__row--plain { cursor: default; }
.settings .content__pretty { text-wrap: pretty; }
.settings .content__nowrap { white-space: nowrap; flex-shrink: 0; }
.settings .content__verified { color: var(--accent-text); }
.settings .content__switch { width: 22px; height: 22px; flex: none; accent-color: var(--accent); }
.settings .content__link { color: inherit; }
.settings .content__link svg { width: 16px; height: 16px; flex: none; color: var(--text-3); }
.settings .content__rule { margin: 0; border: 0; border-top: 1px solid var(--line); }
.settings .set-chip {
  display: inline-flex; align-items: center; height: 20px; padding: 0 8px; flex: none;
  border-radius: var(--r-pill); background: var(--surface-2);
  font-size: 11px; font-weight: 600; color: var(--text-3); white-space: nowrap;
}
.settings [id] { scroll-margin-top: calc(var(--header-h, 56px) + var(--s-3)); }
</style>
