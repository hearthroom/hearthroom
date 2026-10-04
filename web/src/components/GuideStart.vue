<script setup lang="ts">
/**
 * 寫卡指南開頭的「開始寫卡」：兩條路挑一條，照三四步做完。
 *
 * 預設停在 AI Agent：Agent 照官方寫卡技能起草，再用 Hearthroom CLI 推成試玩卡、檢查、試玩、修改，
 * 這是我們想帶作者走的路。CLI 不另外當一條路：它是給 Agent 操作本站的介面（owner 2026-10-04：
 * 像 GitHub CLI 一樣，真正在用的是 Agent，不用它就只能讓 Agent 去點網頁，又慢又不穩），
 * 所以放在 Agent 這條路裡當「它用的工具」。另一條是網頁編輯器，給想自己手寫的人。
 * 兩條路寫出來的是同一種卡，下方參考都用得到，這裡只講「怎麼開始」。
 *
 * 分頁照 WAI-ARIA tabs：方向鍵在三個選項間移動，只有選中的那個在 Tab 順序裡。
 */
import { ref } from "vue";
import { RouterLink } from "vue-router";
import AgentOnboard from "./AgentOnboard.vue";
import { GUIDE_WAYS, SKILLS_REPO, cliSiteUrl, type GuideWay } from "@/lib/agent-setup";
import { useLocalePath } from "@/lib/use-locale";

/** fieldsAnchor：參考第一節（卡片的組成）的錨點；markdownHref：這一頁的 Markdown 孿生檔 */
defineProps<{ fieldsAnchor: string; markdownHref: string }>();
/** way：選了哪一種寫法，由頁面持有（下方的說明跟著換，也寫進網址） */
const way = defineModel<GuideWay>("way", { required: true });
const WAYS = GUIDE_WAYS;
const agentCopied = ref(false);
const { lp } = useLocalePath();

const cliSite = cliSiteUrl();

const tabs = ref<HTMLButtonElement[]>([]);
function onKey(e: KeyboardEvent) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  const edge = e.key === "Home" ? 0 : e.key === "End" ? WAYS.length - 1 : undefined;
  if (step === undefined && edge === undefined) return;
  e.preventDefault();
  const next = edge ?? (WAYS.indexOf(way.value) + step! + WAYS.length) % WAYS.length;
  way.value = WAYS[next]!;
  tabs.value[next]?.focus();
}
</script>

<template>
  <section class="start" aria-labelledby="start">
    <h2 id="start" class="start__title">{{ $t("guide.start.title") }}</h2>

    <div class="ways" role="tablist" :aria-label="$t('guide.start.label')" @keydown="onKey">
      <button
        v-for="w in WAYS" :id="`start-tab-${w}`" :key="w" ref="tabs"
        type="button" role="tab" class="way" :class="{ 'way--on': way === w }"
        :aria-selected="way === w ? 'true' : 'false'" aria-controls="start-panel" :tabindex="way === w ? 0 : -1"
        @click="way = w"
      >
        <svg class="way__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path v-if="w === 'agent'" d="M12 3.5c.4 3.9 2.6 6.1 6.5 6.5-3.9.4-6.1 2.6-6.5 6.5-.4-3.9-2.6-6.1-6.5-6.5 3.9-.4 6.1-2.6 6.5-6.5ZM18.5 15.5c.2 1.6 1 2.4 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.1 2.3-.9 2.5-2.5Z" />
          <template v-else><path d="M4 20h4.5L19 9.5a3.2 3.2 0 0 0-4.5-4.5L4 15.5V20Z" /><path d="m13 6.5 4.5 4.5" /></template>
        </svg>
        <span class="way__name">{{ $t(`guide.start.${w}.tab`) }}</span>
        <span class="way__note" :class="{ 'way__note--rec': w === 'agent' }">{{ $t(`guide.start.${w}.note`) }}</span>
      </button>
    </div>

    <div id="start-panel" class="panel start__panel" role="tabpanel" :aria-labelledby="`start-tab-${way}`">
      <p class="start__lead">{{ $t(`guide.start.${way}.lead`) }}</p>

      <ol v-if="way === 'agent'" class="steps">
        <li class="step" :class="{ 'step--done': agentCopied }">
          <h3 class="step__title">{{ $t("guide.start.agent.copy") }}</h3>
          <div class="step__body"><AgentOnboard from="guide" large inline :steps-link="false" @copied="agentCopied = true" /></div>
        </li>
        <li class="step">
          <h3 class="step__title">{{ $t("guide.start.agent.paste") }}</h3>
          <p class="step__body">{{ $t("guide.start.agent.pasteNote") }}</p>
        </li>
        <li class="step">
          <h3 class="step__title">{{ $t("guide.start.agent.signin") }}</h3>
          <p class="step__body">{{ $t("guide.start.agent.signinNote") }}</p>
        </li>
        <li class="step">
          <h3 class="step__title">{{ $t("guide.start.agent.ask") }}</h3>
          <p class="step__body step__quote">{{ $t("guide.start.agent.askExample") }}</p>
        </li>
      </ol>


      <ol v-else class="steps">
        <li class="step">
          <h3 class="step__title">{{ $t("guide.start.web.open") }}</h3>
          <div class="step__body"><RouterLink :to="lp('/create')" class="btn btn--primary">{{ $t("mine.create") }}</RouterLink></div>
        </li>
        <li class="step">
          <h3 class="step__title">{{ $t("guide.start.web.fill") }}</h3>
          <p class="step__body">{{ $t("guide.start.web.fillNote") }}</p>
        </li>
        <li class="step">
          <h3 class="step__title">{{ $t("guide.start.web.try") }}</h3>
          <p class="step__body">{{ $t("guide.start.web.tryNote") }}</p>
        </li>
      </ol>

      <p v-if="way === 'agent'" class="start__more">
        <a :href="SKILLS_REPO" class="link" target="_blank" rel="noopener">{{ $t("guide.start.agent.more") }} →</a>
        <a :href="cliSite" class="link" target="_blank" rel="noopener">{{ $t("guide.start.agent.cli") }} →</a>
      </p>
      <p v-else class="start__more"><a :href="`#${fieldsAnchor}`" class="link">{{ $t("guide.start.web.more") }} →</a></p>
    </div>

    <p class="start__ai">
      {{ $t("guide.start.forAi") }}
      <a :href="markdownHref" class="link">Markdown</a>
      <span class="start__dot" aria-hidden="true">·</span>
      <a href="/llms.txt" class="link">llms.txt</a>
    </p>
  </section>
</template>

<style scoped>
/* 跟下方參考同寬（.doc 的 80ch），但不套參考的標題與段落樣式：這裡是操作區，不是文章 */
.start { max-width: 80ch; margin-bottom: var(--s-6); font-size: 15px; }
.start__title { font-size: 20px; line-height: 1.3; margin: 0 0 var(--s-3); scroll-margin-top: calc(var(--header-h) + var(--s-4)); }

/* 兩個選項：圖示、名稱、一句提示。選中的那個用強調色框住，跟下面的面板是同一件事 */
.ways { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-2); margin-bottom: var(--s-3); }
.way {
  display: grid; justify-items: start; align-content: start; gap: 2px;
  padding: var(--s-3);
  font: inherit; text-align: left; color: var(--text);
  background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--r-md);
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.way:hover { border-color: var(--border-strong); }
.way:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.way--on, .way--on:hover { border-color: var(--accent); background: var(--accent-tint); box-shadow: inset 0 0 0 1px var(--accent); }
.way__icon { width: 20px; height: 20px; margin-bottom: var(--s-1); fill: none; stroke: var(--text-2); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.way--on .way__icon { stroke: var(--accent-text); }
.way__name { font-size: 14px; font-weight: 600; line-height: 1.35; word-break: keep-all; overflow-wrap: anywhere; }
.way__note { font-size: 12px; color: var(--text-3); }
.way__note--rec { color: var(--accent-text); font-weight: 600; }

.start__panel { padding: var(--s-5); }
.start__lead { margin: 0 0 var(--s-5); font-size: 15px; line-height: 1.7; color: var(--text); text-wrap: pretty; }

/* 步驟：編號圓點連一條直線，看得出先後；做完的那步換成勾 */
.steps { list-style: none; margin: 0; padding: 0; counter-reset: step; display: grid; gap: var(--s-5); }
.step { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr); column-gap: var(--s-3); counter-increment: step; }
.step::before {
  content: counter(step); grid-row: 1 / span 2;
  width: 28px; height: 28px; border-radius: 50%;
  display: grid; place-items: center;
  font-size: 13px; font-weight: 600; color: var(--text-2);
  background: var(--surface-2); box-shadow: 0 0 0 1px var(--line);
}
.step:not(:last-child)::after {
  content: ""; position: absolute; left: 13.5px; top: 34px; bottom: calc(-1 * var(--s-5) + 6px);
  width: 1px; background: var(--line-strong);
}
.step--done::before { content: "✓"; color: var(--success); background: var(--success-soft); box-shadow: none; }
.step__title { grid-column: 2; margin: 3px 0 var(--s-2); font-size: 15px; font-weight: 600; line-height: 1.4; }
.step__body { grid-column: 2; margin: 0; font-size: 14px; line-height: 1.7; color: var(--text-2); min-width: 0; text-wrap: pretty; }
.step__quote { padding-left: var(--s-3); border-left: 2px solid var(--accent); color: var(--text); }


.start__more { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-5); margin: var(--s-5) 0 0; font-size: 14px; }
.start__ai { margin: var(--s-3) 0 0; font-size: 13px; color: var(--text-3); }
.start__ai .link { color: var(--text-2); }
.start__ai .link:first-of-type { margin-left: 4px; }
.start__dot { margin: 0 6px; }

@media (max-width: 520px) {
  .way { padding: var(--s-3) var(--s-2); }
  .start__panel { padding: var(--s-4); }
}
</style>
