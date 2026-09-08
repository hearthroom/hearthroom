<script setup lang="ts">
/**
 * /game/:roleId — 把一張卡當 3D 遊戲玩。
 *
 * 三層分工：
 *   世界（game/world.ts，three.js）：可走動的校園、NPC、日夜光照、傳送、對話鏡頭、小地圖。確定性的東西都在這裡。
 *   狀態（game/zz-parse.ts）：AI 每輪吐的 zzt / zzhud / zzroles 讀成資料——好感、心情、目標、行動、時間、地點。
 *   敘事（game/chat-client.ts，開放 API v1）：玩家走到 NPC 面前說話，AI 回敘事與新狀態。
 * 頁面只做翻譯：狀態 → 世界方法；世界事件（靠近了誰）→ 對話入口。
 *
 * 開場白是公開資料，遊客就能進校園逛；第一次開口才需要登入。登入的人一進來就接上這張卡的對話，
 * 把最近的 AI 回覆依序合併回來——重新整理不會丟存檔。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { fetchGameSpec, fetchRoleDetail } from "@/lib/api";
import { UPSTREAM_API } from "@/lib/config";
import { loginPath } from "@/lib/login-return";
import { pageTitle } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { fetchRecentAiMessages, sendTurn, startConversation } from "@/game/chat-client";
import { HERO_FIELDS, SCENE_FIELDS, WORLD_SPECS, defaultWorldFor, tintOf, worldFromSpec } from "@/game/specs";
import { F, isUnset, mergeTurn, parseTurn, speakerOf, type GameTurn } from "@/game/zz-parse";
import type { World } from "@/game/world";
import { GameAudio } from "@/game/audio";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { locale, lp } = useLocalePath();
const { t } = useI18n();

const roleId = computed(() => String(route.params.roleId || ""));
const canvas = ref<HTMLCanvasElement | null>(null);
const labels = ref<HTMLDivElement | null>(null);
const minimap = ref<HTMLCanvasElement | null>(null);
let world: World | null = null;
const worldReady = ref(false);
const audio = new GameAudio();
if (import.meta.env.DEV) (window as unknown as { __audio?: GameAudio }).__audio = audio;
const muted = ref(false);
/** 目前頭上掛著任務標記的角色：新出現才響一聲 */
const questNames = new Set<string>();
/** 瀏覽器要先有互動才能出聲：第一次點擊／按鍵解鎖 */
function unlockAudio() { audio.unlock(); void audio.setAmbience(tintOf(turn.value.scene[F.time] || "")); }
window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("keydown", unlockAudio, { once: true });

const role = ref<{ name: string } | null>(null);
const loadError = ref("");
const turn = ref<GameTurn>(parseTurn(""));
const live = ref("");
const streaming = ref(false);
const playerLine = ref("");
const error = ref("");
const draft = ref("");
const conversationId = ref("");
let abort: (() => void) | null = null;

/** 靠近的 NPC（世界回報）與正在對話的 NPC */
const near = ref<string | null>(null);
const talking = ref<string | null>(null);
const toast = ref("");
let toastTimer = 0;
const fading = ref(false);
const showLog = ref(false);
/** 劇情日誌：每一輪的標題與目標，加上玩家說過的話 */
const log = ref<{ kind: "turn" | "you"; title: string; text: string }[]>([]);
const narr = ref<HTMLDivElement | null>(null);

const signedIn = computed(() => !!session.me);
const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const prose = computed(() => (streaming.value ? parseTurn(live.value).prose : turn.value.prose));
const paragraphs = computed(() => prose.value.split(/\n+/).map((s) => s.trim()).filter(Boolean));
const speaker = computed(() => speakerOf(prose.value, turn.value.roles.map((r) => r.name)) || talking.value || "");
const heroRows = computed(() => HERO_FIELDS.map((f) => ({ ...f, value: turn.value.hero[f.key] || "" })).filter((f) => f.value));
const sceneRows = computed(() => SCENE_FIELDS.map((f) => ({ ...f, value: turn.value.scene[f.key] || "" })).filter((f) => f.value));
const round = computed(() => Number(turn.value.scene[F.round]) || 0);
const objective = computed(() => turn.value.scene[F.objective] || "");
const heroName = computed(() => {
  const n = turn.value.hero[HERO_FIELDS[0].key];
  return isUnset(n) ? t("game.you") : n;
});

watch(role, (r) => { document.title = pageTitle(r ? r.name : t("game.title")); }, { immediate: true });
watch(speaker, (s) => { if (streaming.value) world?.setSpeaking(s || talking.value); });
watch(paragraphs, () => { void nextTick(() => { if (narr.value) narr.value.scrollTop = narr.value.scrollHeight; }); });

/** 狀態 → 世界 */
function syncWorld() {
  if (!world) return;
  const tint = tintOf(turn.value.scene[F.time] || "");
  world.setTint(tint);
  void audio.setAmbience(tint);
  world.setPlayerName(heroName.value);
  const goal = objective.value;
  let newQuest = false;
  for (const r of turn.value.roles) {
    const quest = !!goal && goal.includes(r.name);
    if (quest && !questNames.has(r.name)) newQuest = true;
    if (quest) questNames.add(r.name); else questNames.delete(r.name);
    world.setNpcState(r.name, { affection: r.affection, mood: r.fields[F.mood] || "", quest });
  }
  if (newQuest) void audio.play("quest", { volume: 0.7 });
}

function say(text: string) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.value = ""; }, 2600);
}

/** 一輪回覆進來：合併狀態、記日誌、把差異變成世界裡看得到的反饋 */
function applyTurn(full: string, announce: boolean) {
  const before = turn.value;
  const next = mergeTurn(before, parseTurn(full));
  turn.value = next;
  if (next.title.length || next.scene[F.objective]) {
    log.value.push({ kind: "turn", title: next.title.join(" · "), text: next.scene[F.objective] || "" });
  }
  syncWorld();
  if (!announce) return;
  for (const r of next.roles) {
    const prev = before.roles.find((p) => p.name === r.name);
    if (prev && prev.affection !== null && r.affection !== null && r.affection !== prev.affection) {
      const d = r.affection - prev.affection;
      void audio.play(d > 0 ? "affection-up" : "affection-down");
      world?.floatText(r.name, d > 0 ? t("game.affUp", { n: d }) : t("game.affDown", { n: d }), d > 0 ? "w-float--up" : "w-float--down");
    }
  }
  const from = before.scene[F.place] || "", to = next.scene[F.place] || "";
  if (to && to !== from) {
    const label = world?.travelTo(to) || "";
    if (label) {
      void audio.play("travel");
      fading.value = true;
      setTimeout(() => { fading.value = false; }, 700);
      say(t("game.travel", { place: label }));
    }
  }
}

/** 登入的人：接上這張卡的對話，把最近的回覆依序合併回來（存檔） */
async function restore(token: string) {
  const s = await startConversation(UPSTREAM_API, token, roleId.value, locale.value);
  conversationId.value = s.conversationId;
  if (!s.hasHistory) return;
  const msgs = await fetchRecentAiMessages(UPSTREAM_API, token, conversationId.value, locale.value).catch(() => [] as string[]);
  if (!msgs.length) return;
  for (const m of msgs) applyTurn(m, false);
  say(t("game.resumed"));
}

onMounted(async () => {
  void session.restore();
  try {
    const token = (await session.accessToken()) || undefined;
    const d = await fetchRoleDetail(roleId.value, token, locale.value);
    role.value = { name: String(d.roleName || "") };
    const welcome = String(d.roleWelcome || "");
    turn.value = parseTurn(welcome);
    if (!canvas.value || !labels.value) return;
    // 作者存的配置優先；沒有就用站內精修的（示範卡）；再沒有就從角色名單生通用校園
    const names = turn.value.roles.map((r) => r.name);
    const saved = await fetchGameSpec(roleId.value).catch(() => null);
    const spec = saved?.spec && saved.spec.enabled !== false ? worldFromSpec(saved.spec, names) : (WORLD_SPECS[roleId.value] || defaultWorldFor(names));
    audio.setSources(spec.audio);
    const { World } = await import("@/game/world");
    world = new World(canvas.value, labels.value, spec, { onNear: (name) => { near.value = name; }, onFootstep: () => audio.footstep() });
    world.attachMinimap(minimap.value);
    worldReady.value = true;
    syncWorld();
    installTestHooks();
    if (token) await restore(token).catch((e) => console.error("[game] restore failed", e));
  } catch (e) {
    console.error("[game] load failed", e);
    loadError.value = t("game.loadFailed");
  }
});

onBeforeUnmount(() => { abort?.(); world?.dispose(); world = null; audio.dispose(); window.removeEventListener("pointerdown", unlockAudio); window.removeEventListener("keydown", unlockAudio); });

function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.key.toLowerCase() === "e" && near.value && !talking.value) { e.preventDefault(); openTalk(near.value); }
  if (e.key.toLowerCase() === "l") showLog.value = !showLog.value;
  if (e.key.toLowerCase() === "m") { muted.value = !muted.value; audio.setMuted(muted.value); }
  if (e.key === "Escape" && talking.value && !streaming.value) closeTalk();
}
window.addEventListener("keydown", onKey);
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

function openTalk(name: string) {
  void audio.play("ui-open", { volume: 0.6 });
  talking.value = name;
  error.value = "";
  world?.lock(true, name);
  void nextTick(() => document.querySelector<HTMLInputElement>(".panel__input input")?.focus());
}
function closeTalk() {
  void audio.play("ui-close", { volume: 0.6 });
  talking.value = null;
  world?.lock(false);
}
function toLogin() { void router.push(lp(loginPath(route.fullPath))); }

async function act(text: string) {
  const message = text.trim();
  if (!message || streaming.value || !talking.value) return;
  error.value = "";
  const token = await session.accessToken();
  if (!token) { toLogin(); return; }
  try {
    if (!conversationId.value) await restore(token);
  } catch (e) {
    console.error("[game] start failed", e);
    error.value = t("game.error");
    return;
  }
  playerLine.value = message;
  log.value.push({ kind: "you", title: heroName.value, text: message });
  draft.value = "";
  live.value = "";
  streaming.value = true;
  world?.setSpeaking(talking.value);
  // 讓 AI 知道玩家是走到誰面前說的：這一句是舞台事實
  const wire = t("game.wireApproach", { name: talking.value }) + message;
  abort = sendTurn({ base: UPSTREAM_API, token, conversationId: conversationId.value, message: wire, lang: locale.value }, {
    onDelta: (full) => { live.value = full; },
    onDone: (full) => {
      streaming.value = false;
      abort = null;
      world?.setSpeaking(null);
      if (full.trim()) applyTurn(full, true);
    },
    onError: (why) => {
      streaming.value = false;
      abort = null;
      world?.setSpeaking(null);
      console.error("[game] turn failed:", why);
      error.value = why === "insufficient_credits" ? t("game.credits") : t("game.error");
    },
  });
}

function stop() { abort?.(); }

/**
 * 開發用的檢查掛鉤（threejs 畫布檢查器的契約）：setState 把場景擺到指定狀態並回 {state}，
 * setPausedForScreenshot 停模擬不停渲染。正式 build 不掛。
 */
function installTestHooks() {
  if (!import.meta.env.DEV || !world) return;
  const w = world;
  const states: Record<string, () => void> = {
    "active-play": () => { closeTalk(); },
    night: () => { closeTalk(); w.setTint("night"); },
    dusk: () => { closeTalk(); w.setTint("dusk"); },
    talking: () => { const n = w.npcNames()[0]; if (!n) throw new Error("no npc"); const st = w as unknown as { step(dt: number): void }; w.goTo(n); for (let i = 0; i < 300; i++) st.step(1 / 60); openTalk(n); for (let i = 0; i < 120; i++) st.step(1 / 60); },
  };
  (window as unknown as { __THREE_GAME_TEST_HOOKS__: unknown }).__THREE_GAME_TEST_HOOKS__ = {
    setState: (name: string) => { const fn = states[name]; if (!fn) throw new Error(`unknown state ${name}`); fn(); return { state: name }; },
    setPausedForScreenshot: (v: boolean) => { w.paused = v; },
    seed: () => {},
  };
}
</script>

<template>
  <div class="game" :class="{ 'game--talking': talking }">
    <div class="game__view">
      <canvas ref="canvas" class="game__canvas"></canvas>
      <div ref="labels" class="game__labels" aria-hidden="true"></div>
    </div>
    <div class="game__fade" :class="{ 'game__fade--on': fading }" aria-hidden="true"></div>

    <div v-if="!worldReady && !loadError" class="game__boot" aria-live="polite">
      <div class="game__boot-ring"></div>
      <p>{{ $t("game.loadingWorld") }}</p>
    </div>

    <header class="game__top">
      <RouterLink class="btn btn--ghost btn--sm game__back" :to="lp(`/cards/${roleId}`)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        <span class="game__role">{{ role?.name || $t("game.title") }}</span>
      </RouterLink>
      <div class="game__title" v-if="turn.title.length">
        <span v-for="(chip, i) in turn.title" :key="i" class="game__chip">{{ chip }}</span>
      </div>
      <div class="game__scene">
        <span v-for="r in sceneRows" :key="r.key" class="game__scene-item"><small>{{ $t(r.label) }}</small>{{ r.value }}</span>
        <span v-if="round" class="game__scene-item game__scene-item--round">{{ $t("game.round", { n: round }) }}</span>
        <button type="button" class="btn btn--ghost btn--sm game__logbtn" :class="{ 'game__logbtn--on': showLog }" @click="showLog = !showLog">{{ $t("game.log") }}</button>
        <button type="button" class="btn btn--ghost btn--sm btn--icon game__logbtn" :title="$t(muted ? 'game.unmute' : 'game.mute')" :aria-label="$t(muted ? 'game.unmute' : 'game.mute')" @click="muted = !muted; audio.setMuted(muted)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path v-if="!muted" d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/><path v-else d="m22 9-6 6M16 9l6 6"/></svg>
        </button>
      </div>
    </header>

    <aside class="hud">
      <div v-if="objective" class="hud__block hud__block--goal">
        <div class="hud__eyebrow">{{ $t("game.objective") }}</div>
        <p>{{ objective }}</p>
      </div>
      <div v-if="heroRows.length" class="hud__block">
        <div class="hud__eyebrow">{{ $t("game.hero") }}</div>
        <dl class="hud__rows">
          <template v-for="r in heroRows" :key="r.key"><dt>{{ $t(r.label) }}</dt><dd>{{ r.value }}</dd></template>
        </dl>
      </div>
      <div v-if="turn.roles.length" class="hud__block">
        <div class="hud__eyebrow">{{ $t("game.npcs") }}</div>
        <ul class="hud__npcs">
          <li v-for="r in turn.roles" :key="r.name">
            <button type="button" class="hud__npc" :title="$t('game.goTo', { name: r.name })" @click="world?.goTo(r.name)">
              <b>{{ r.name }}</b>
              <span v-if="r.affection !== null" class="hud__aff"><i :style="{ width: Math.max(0, Math.min(100, r.affection)) + '%' }"></i></span>
            </button>
          </li>
        </ul>
      </div>
    </aside>

    <canvas ref="minimap" class="minimap" width="150" height="150" aria-hidden="true"></canvas>

    <aside v-if="showLog" class="logpanel">
      <div class="logpanel__head"><b>{{ $t("game.log") }}</b><button type="button" class="btn btn--ghost btn--sm" @click="showLog = false">✕</button></div>
      <p v-if="!log.length" class="logpanel__empty">{{ $t("game.noLog") }}</p>
      <ol v-else class="logpanel__list">
        <li v-for="(e, i) in log" :key="i" :class="`logpanel__item logpanel__item--${e.kind}`">
          <b>{{ e.title }}</b>
          <span v-if="e.text">{{ e.text }}</span>
        </li>
      </ol>
    </aside>

    <p v-if="loadError" class="game__fatal" role="alert">{{ loadError }}</p>
    <div v-if="toast" class="game__toast">{{ toast }}</div>

    <!-- 靠近 NPC：提示按 E（手機給一顆鍵） -->
    <div v-if="near && !talking" class="game__hint">
      <button type="button" class="btn btn--primary btn--lg" @click="openTalk(near)">{{ $t("game.talkTo", { name: near }) }}</button>
      <small>{{ $t("game.talkKey") }}</small>
    </div>
    <div v-else-if="!talking && worldReady" class="game__hint game__hint--move"><small>{{ touch ? $t("game.tapHint") : $t("game.moveHint") + " · " + $t("game.dragHint") }}</small></div>

    <!-- 對話框：走到 NPC 面前才出現 -->
    <footer v-if="talking" class="panel">
      <div class="panel__head">
        <b class="panel__who">{{ speaker }}</b>
        <button type="button" class="btn btn--ghost btn--sm panel__close" :disabled="streaming" @click="closeTalk">{{ $t("game.close") }}</button>
      </div>
      <div ref="narr" class="panel__narr">
        <p v-if="playerLine" class="panel__you"><span>{{ heroName }}</span>{{ playerLine }}</p>
        <p v-for="(p, i) in paragraphs" :key="i" class="panel__p">{{ p }}</p>
        <p v-if="streaming && !paragraphs.length" class="panel__p panel__p--wait">{{ $t("game.thinking") }}</p>
        <span v-if="streaming" class="panel__caret" aria-hidden="true"></span>
        <p v-if="error" class="panel__error" role="alert">{{ error }}</p>
      </div>
      <div v-if="!signedIn" class="panel__login">
        <span>{{ $t("game.loginToTalk") }}</span>
        <button type="button" class="btn btn--primary" @click="toLogin">{{ $t("game.login") }}</button>
      </div>
      <template v-else>
        <div class="panel__actions" v-if="turn.actions.length">
          <button v-for="a in turn.actions" :key="a.full" type="button" class="btn act" :title="a.full" :disabled="streaming" @click="act(a.full)">
            {{ a.short }}
          </button>
        </div>
        <form class="panel__input" @submit.prevent="act(draft)">
          <input v-model="draft" class="input" :placeholder="$t('game.placeholder')" :disabled="streaming" autocomplete="off" />
          <button v-if="streaming" type="button" class="btn" @click="stop">{{ $t("game.stop") }}</button>
          <button v-else type="submit" class="btn btn--primary" :disabled="!draft.trim()">{{ $t("game.send") }}</button>
        </form>
      </template>
    </footer>
  </div>
</template>

<style scoped>
.game {
  --ink: #f4f6fb; --ink-2: rgba(244, 246, 251, 0.74); --ink-3: rgba(244, 246, 251, 0.52);
  --glass: rgba(12, 16, 32, 0.62); --glass-line: rgba(140, 200, 255, 0.22); --cyan: #8fd6ff;
  position: relative; height: 100vh; height: 100dvh; overflow: hidden; color: var(--ink); background: #0d1020;
}
.game__view { position: absolute; inset: 0; isolation: isolate; z-index: 1; }
.game__canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.game__labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.game__fade { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; transition: opacity 350ms var(--ease); z-index: 6; }
.game__fade--on { opacity: 1; }

.game__boot { position: absolute; inset: 0; z-index: 7; display: grid; place-content: center; gap: var(--s-3); justify-items: center; background: #0d1020; color: var(--ink-2); font-size: 13px; letter-spacing: 0.12em; }
.game__boot-ring { width: 46px; height: 46px; border-radius: 50%; border: 3px solid rgba(143, 214, 255, 0.2); border-top-color: var(--cyan); animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* 玻璃面板：藍邊、斜切角，跟世界裡的白牆藍邊同一套語言 */
.hud__block, .panel, .logpanel, .game__toast {
  background: var(--glass); border: 1px solid var(--glass-line); backdrop-filter: blur(14px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 10px 30px -14px rgba(0, 0, 0, 0.7);
}
.hud__block, .panel, .logpanel { clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px)); border-radius: 4px; }

.game__top {
  position: absolute; left: 0; right: 0; top: 0; z-index: 3;
  display: flex; align-items: center; gap: var(--s-4); flex-wrap: wrap;
  padding: var(--s-3) var(--s-4); background: linear-gradient(180deg, rgba(5, 6, 14, 0.55), transparent); pointer-events: none;
}
.game__top > * { pointer-events: auto; }
.game__back { color: var(--ink); padding-left: var(--s-2); text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6); }
.game__back:hover { background: rgba(255, 255, 255, 0.12); color: var(--ink); }
.game__role { font-weight: 600; max-width: 40vw; overflow: hidden; text-overflow: ellipsis; }
.game__title { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.game__chip { font-size: 12px; letter-spacing: 0.06em; padding: 3px 10px; background: var(--glass); border: 1px solid var(--glass-line); backdrop-filter: blur(8px); clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%); }
.game__scene { margin-left: auto; display: flex; gap: var(--s-4); align-items: flex-end; font-size: 13px; color: var(--ink); flex-wrap: wrap; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7); }
.game__scene-item small { display: block; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--cyan); opacity: 0.85; }
.game__scene-item--round { font-variant-numeric: tabular-nums; margin-right: var(--s-2); }
.game__logbtn { color: var(--ink); border: 1px solid var(--glass-line); background: var(--glass); }
.game__logbtn--on, .game__logbtn:hover { background: rgba(143, 214, 255, 0.18); color: var(--ink); }

.hud { position: absolute; left: var(--s-4); top: 76px; width: min(260px, 32vw); display: grid; gap: var(--s-2); z-index: 3; transition: opacity var(--dur) var(--ease); }
.game--talking .hud { opacity: 0.35; pointer-events: none; }
.hud__block { padding: var(--s-3) var(--s-4); font-size: 13px; line-height: 1.55; }
.hud__block p { margin: 0; color: var(--ink); }
.hud__block--goal { border-color: rgba(255, 213, 74, 0.55); }
.hud__block--goal .hud__eyebrow { color: #ffd54a; }
.hud__eyebrow { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--cyan); margin-bottom: var(--s-1); }
.hud__rows { display: grid; grid-template-columns: auto 1fr; gap: 2px var(--s-3); margin: 0; }
.hud__rows dt { color: var(--ink-3); white-space: nowrap; }
.hud__rows dd { margin: 0; overflow-wrap: anywhere; }
.hud__npcs { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.hud__npc { all: unset; display: grid; grid-template-columns: 1fr 64px; align-items: center; gap: var(--s-2); cursor: pointer; padding: 4px 6px; margin: 0 -6px; border-radius: 4px; }
.hud__npc:hover { background: rgba(143, 214, 255, 0.12); }
.hud__aff { height: 5px; border-radius: 3px; background: rgba(255, 255, 255, 0.18); overflow: hidden; }
.hud__aff i { display: block; height: 100%; background: linear-gradient(90deg, #ff9ab5, #ff5c8a); transition: width var(--dur-slow) var(--ease); }

.minimap { position: absolute; right: var(--s-4); top: 76px; width: 150px; height: 150px; z-index: 3; filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.5)); }

.logpanel { position: absolute; right: var(--s-4); top: 240px; width: min(320px, 40vw); max-height: 44vh; overflow-y: auto; z-index: 4; padding: var(--s-3) var(--s-4); font-size: 13px; }
.logpanel__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--s-2); color: var(--cyan); letter-spacing: 0.1em; text-transform: uppercase; font-size: 11px; }
.logpanel__empty { color: var(--ink-3); margin: 0; }
.logpanel__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.logpanel__item { display: grid; gap: 2px; padding-left: var(--s-3); border-left: 2px solid var(--glass-line); }
.logpanel__item--turn { border-left-color: #ffd54a; }
.logpanel__item--you { border-left-color: var(--cyan); color: var(--ink-2); }
.logpanel__item b { font-size: 12px; }

.game__fatal { position: absolute; left: 50%; top: 40%; transform: translateX(-50%); z-index: 4; background: var(--glass); padding: var(--s-4) var(--s-5); border-radius: 4px; }
.game__toast { position: absolute; left: 50%; top: 72px; transform: translateX(-50%); z-index: 4; padding: 6px 16px; font-size: 13px; letter-spacing: 0.04em; }

.game__hint { position: absolute; left: 50%; bottom: 6vh; transform: translateX(-50%); z-index: 3; display: grid; justify-items: center; gap: 6px; text-align: center; }
.game__hint small { color: var(--ink-2); font-size: 12px; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7); white-space: nowrap; }
.game__hint--move { bottom: 3vh; }
.game__hint .btn--primary { box-shadow: 0 0 0 4px rgba(143, 214, 255, 0.18), 0 8px 24px -8px rgba(0, 0, 0, 0.7); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { box-shadow: 0 0 0 9px rgba(143, 214, 255, 0.08), 0 8px 24px -8px rgba(0, 0, 0, 0.7); } }

.panel {
  position: absolute; left: 50%; bottom: var(--s-4); transform: translateX(-50%); z-index: 5;
  width: min(920px, calc(100% - 2 * var(--s-4))); display: grid; gap: var(--s-3);
  padding: var(--s-4) var(--s-5) var(--s-4) calc(var(--s-5) + 6px);
  animation: rise 260ms var(--ease);
}
.panel::before { content: ""; position: absolute; left: 0; top: 14px; bottom: 14px; width: 3px; background: var(--cyan); }
@keyframes rise { from { transform: translate(-50%, 12px); opacity: 0; } }
.panel__head { display: flex; align-items: center; justify-content: space-between; }
.panel__who { font-size: 16px; letter-spacing: 0.04em; color: var(--cyan); }
.panel__who::before { content: "▸ "; opacity: 0.7; }
.panel__close { color: var(--ink-2); }
.panel__close:hover { color: var(--ink); background: rgba(255, 255, 255, 0.1); }
.panel__narr { position: relative; max-height: 20vh; overflow-y: auto; font-size: 15px; line-height: 1.75; scroll-behavior: smooth; }
.panel__p { margin: 0 0 0.6em; }
.panel__p--wait { color: var(--ink-3); }
.panel__you { margin: 0 0 var(--s-2); font-size: 13px; color: var(--ink-2); }
.panel__you span { display: inline-block; margin-right: var(--s-2); padding: 0 8px; border-radius: 3px; background: rgba(143, 214, 255, 0.16); color: var(--cyan); font-size: 11px; }
.panel__caret { display: inline-block; width: 8px; height: 1em; vertical-align: -2px; background: var(--ink); animation: caret 0.9s steps(2) infinite; }
@keyframes caret { 50% { opacity: 0; } }
.panel__error { margin: var(--s-2) 0 0; color: #ff9b96; font-size: 13px; }
.panel__login { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); padding: var(--s-2) var(--s-3); background: rgba(143, 214, 255, 0.1); border: 1px dashed var(--glass-line); font-size: 13px; }
.panel__actions { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.act { color: var(--ink); background: rgba(143, 214, 255, 0.1); border-color: var(--glass-line); border-radius: 3px; clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); padding: 0 var(--s-5); }
.act:hover { background: rgba(143, 214, 255, 0.24); }
.panel__input { display: flex; gap: var(--s-2); }
.panel__input .input { background: rgba(255, 255, 255, 0.08); border-color: var(--glass-line); color: var(--ink); border-radius: 3px; }
.panel__input .input::placeholder { color: var(--ink-3); }

@media (max-width: 860px) {
  /* 手機：頂列只留返回鍵與日誌鍵，場景資料收進日誌；標題碎片單獨一行 */
  .game__scene { position: absolute; right: var(--s-3); top: var(--s-3); margin: 0; width: auto; gap: 0; }
  .game__scene-item { display: none; }
  .game__title { width: 100%; }
  .hud { top: 108px; width: 52vw; }
  .hud__block:not(.hud__block--goal) { display: none; }
  .game--talking .hud, .game--talking .minimap { display: none; }
  .minimap { top: 96px; width: 96px; height: 96px; }
  .logpanel { top: 200px; width: calc(100% - 2 * var(--s-4)); }
  .panel { bottom: var(--s-3); width: calc(100% - 2 * var(--s-3)); padding: var(--s-3) var(--s-4) var(--s-3) calc(var(--s-4) + 6px); }
  .panel__narr { max-height: 28vh; font-size: 14px; }
  .game__hint small { white-space: normal; max-width: 80vw; }
}
</style>

<!-- 世界裡的標籤（CSS2DRenderer 產生的 DOM 不在 scoped 範圍內） -->
<style>
.w-label { font: 600 13px/1.2 var(--font); color: #fff; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7), 0 0 12px rgba(0, 0, 0, 0.4); white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
.w-label--you { color: #ffe9a8; font-size: 12px; }
.w-label--place { color: rgba(255, 255, 255, 0.9); font-size: 12px; font-weight: 500; letter-spacing: 0.08em; padding: 2px 8px; border: 1px solid rgba(143, 214, 255, 0.35); background: rgba(12, 16, 32, 0.45); clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%); }
.w-label--npc b { color: var(--c, #fff); font-size: 14px; }
.w-hearts { font-size: 11px; color: #ff7fa5; letter-spacing: 1px; }
.w-quest[hidden], .w-mood[hidden] { display: none; }
.w-quest { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: #ffd54a; color: #3a2a00; font-size: 13px; font-weight: 800; animation: w-bounce 1.2s ease-in-out infinite; }
@keyframes w-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
.w-mood { max-width: 220px; white-space: normal; font: 12px/1.45 var(--font); color: #2a2c3a; background: rgba(255, 255, 255, 0.94); border-radius: 12px; padding: 6px 10px; position: relative; }
.w-mood::after { content: ""; position: absolute; left: 50%; bottom: -5px; width: 10px; height: 10px; background: inherit; transform: translateX(-50%) rotate(45deg); }
.w-float { font: 700 14px/1 var(--font); color: #fff; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7); animation: w-float 1.4s ease-out forwards; white-space: nowrap; }
.w-float--up { color: #ff8fb0; }
.w-float--down { color: #9fb6ff; }
@keyframes w-float { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-36px); opacity: 0; } }
</style>
