<script setup lang="ts">
/**
 * 「讓 AI Agent 幫你寫卡」：一顆膠囊按鈕，按下就把設定指令複製起來，旁邊浮出一張小卡說下一步。
 *
 * 照 Cloudflare 主控台的「Onboard your agent」：比起叫人選取一長串字，一顆按鈕更容易被按。
 * 複製的是一句讀者語言的話（Agent 會用同一種語言回話），內容只是叫 Agent 去讀 /agent-setup.md 照做；
 * 小卡把那句話也秀出來，剪貼簿拿不到時讀者自己選取就好。
 *
 * 浮動小卡傳送到 body、用 fixed 貼著按鈕並夾在視窗內，按鈕捲到頁首底下就收起來。
 * inline：小卡直接展開在按鈕下方、把後面的內容往下推（指南的步驟裡用，浮起來會蓋住第 2、3 步）。
 *
 * 標誌放 Claude 與 Gemini（simple-icons 的圖形），再加一個終端機符號代表其他能執行指令的 Agent；
 * OpenAI 的標誌已不在 simple-icons 裡，Codex 就用文字點名，不放圖。
 */
import { computed, onBeforeUnmount, ref } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import { agentSetupUrl } from "@/lib/agent-setup";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";

/** from：按鈕放在哪一頁，埋點用（guide／mine） */
const props = withDefaults(defineProps<{ from: "guide" | "mine"; large?: boolean; inline?: boolean; stepsLink?: boolean }>(), { large: false, inline: false, stepsLink: true });
const emit = defineEmits<{ copied: [] }>();
const { t } = useI18n();
const { lp } = useLocalePath();

const prompt = computed(() => t("onboard.prompt", { url: agentSetupUrl() }));
const state = ref<"" | "copied" | "manual">("");
const pill = ref<HTMLButtonElement | null>(null);
const pop = ref<HTMLElement | null>(null);
const place = ref<Record<string, string>>({});

const GUTTER = 16;
function position() {
  const r = pill.value?.getBoundingClientRect();
  if (!r) return;
  const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 0;
  if (r.bottom < header || r.top > window.innerHeight) return close();
  const width = Math.min(360, window.innerWidth - GUTTER * 2);
  const left = Math.min(Math.max(r.left, GUTTER), window.innerWidth - width - GUTTER);
  place.value = { top: `${r.bottom + 8}px`, left: `${left}px`, width: `${width}px` };
}

async function copy() {
  try {
    await navigator.clipboard.writeText(prompt.value);
    state.value = "copied";
    emit("copied");
  } catch {
    state.value = "manual";
  }
  track("agent_onboard", { detail: state.value === "copied" ? "onboard_copied" : "onboard_manual", subject: props.from, ok: state.value === "copied" });
  if (props.inline) return listenKey(true);
  position();
  listen(true);
}

function close() {
  state.value = "";
  listen(false);
  listenKey(false);
}
function onKey(e: KeyboardEvent) { if (e.key === "Escape") close(); }
function onDown(e: PointerEvent) {
  const target = e.target as Node;
  if (!pop.value?.contains(target) && !pill.value?.contains(target)) close();
}
let listening = false;
function listen(on: boolean) {
  if (on === listening) return;
  listening = on;
  listenKey(on);
  if (on) {
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, { capture: true, passive: true });
  } else {
    document.removeEventListener("pointerdown", onDown);
    window.removeEventListener("resize", position);
    window.removeEventListener("scroll", position, { capture: true });
  }
}
let keyed = false;
function listenKey(on: boolean) {
  if (on === keyed) return;
  keyed = on;
  if (on) document.addEventListener("keydown", onKey);
  else document.removeEventListener("keydown", onKey);
}
onBeforeUnmount(() => { listen(false); listenKey(false); });
</script>

<template>
  <span class="onboard" :class="{ 'onboard--inline': inline }">
    <button
      ref="pill" type="button" class="btn onboard__pill" :class="{ 'btn--lg': large }"
      aria-haspopup="dialog" :aria-expanded="state ? 'true' : 'false'" @click="copy"
    >
      {{ $t("onboard.pill") }}
      <span class="onboard__logos" aria-hidden="true">
        <svg viewBox="0 0 24 24" class="onboard__logo onboard__logo--claude"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" /></svg>
        <svg viewBox="0 0 24 24" class="onboard__logo onboard__logo--gemini"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" /></svg>
        <svg viewBox="0 0 24 24" class="onboard__logo onboard__logo--term"><rect x="2.5" y="4" width="19" height="16" rx="4" /><path d="m7 9.5 3 2.5-3 2.5M12.5 15H17" /></svg>
      </span>
    </button>
    <Teleport to="body" :disabled="inline">
      <div v-if="state" ref="pop" class="onboard__pop panel" :class="{ 'onboard__pop--inline': inline }" :style="inline ? undefined : place" role="dialog" :aria-label="$t('onboard.pill')">
        <p class="onboard__title" role="status">
          <svg v-if="state === 'copied'" viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.5 3.5 3.5 7.5-8" /></svg>
          {{ state === "copied" ? $t("onboard.copied") : $t("onboard.copyFailed") }}
        </p>
        <!-- 指南裡下一步就寫在下面，不重複 -->
        <p v-if="!inline" class="onboard__next">{{ $t("onboard.next") }}</p>
        <p class="onboard__prompt">{{ prompt }}</p>
        <RouterLink v-if="stepsLink" :to="`${lp('/guide')}#start`" class="link onboard__more" @click="close">{{ $t("onboard.steps") }} →</RouterLink>
        <button type="button" class="btn btn--ghost btn--icon btn--sm onboard__close" :aria-label="$t('dialog.close')" @click="close">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
        </button>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.onboard { display: inline-flex; }
.onboard--inline { display: flex; flex-direction: column; align-items: flex-start; gap: var(--s-3); }
/* 不讓按鈕撐出版面：放得下就一行，放不下就折行，不超出畫面 */
.onboard__pill {
  max-width: 100%; height: auto; min-height: var(--h-md); padding-block: 6px; padding-right: var(--s-3);
  gap: 8px; white-space: normal; text-align: left;
  font-weight: 600; border-color: var(--line-strong); box-shadow: var(--shadow-sm);
}
.onboard__pill.btn--lg { min-height: var(--h-lg); padding-left: var(--s-4); }
.onboard__pill:hover { border-color: var(--border-strong); }
.onboard__pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.onboard__logos { display: inline-flex; align-items: center; gap: 5px; }
.onboard__pill .onboard__logo { width: 16px; height: 16px; }
.onboard__pill.btn--lg .onboard__logo { width: 17px; height: 17px; }
.onboard__logos { flex: none; }
.onboard__logo--claude { fill: #d97757; }
.onboard__logo--gemini { fill: #8e75b2; }
.onboard__logo--term { fill: none; stroke: var(--text-2); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

.onboard__pop {
  position: fixed; z-index: 60;
  display: grid; gap: var(--s-2);
  padding: var(--s-4) var(--s-7) var(--s-4) var(--s-4);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
}
.onboard__pop--inline { position: relative; width: 100%; max-width: 420px; box-shadow: 0 0 0 1px var(--line); background: var(--surface-2); }
.onboard__pop--inline .onboard__prompt { background: var(--surface); }
.onboard__title { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; }
.onboard__title svg { width: 16px; height: 16px; flex: none; fill: none; stroke: var(--success); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.onboard__next { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text-2); }
.onboard__prompt {
  margin: var(--s-1) calc(-1 * var(--s-6)) 0 0; padding: var(--s-2) var(--s-3);
  border-radius: var(--r-sm); background: var(--surface-2);
  font-size: 12.5px; line-height: 1.6; color: var(--text-2);
  user-select: all; overflow-wrap: anywhere;
}
.onboard__more { justify-self: start; margin-top: var(--s-1); font-size: 13px; }
.onboard__close { position: absolute; top: var(--s-2); right: var(--s-2); }
.onboard__close svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
</style>
