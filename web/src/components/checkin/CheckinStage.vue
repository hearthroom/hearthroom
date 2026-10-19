<script setup lang="ts">
/**
 * 開箱舞台（ui.md §6、art.md §2–§5、§16）：固定夜色的蘇綺小舞台，所有箱子共用。
 *
 * 結果由伺服器先抽好；滾輪用回應裡的 stripSeed 與那一版獎表排（lib/reel/v1），
 * 畫面每一幀只是時間 t 的函數（lib/reel/timeline）。中途離開也不會漏領：回應到的那一刻已入帳。
 * 舞台上不寫任何說明「擦過」的字（owner 2026-10-19）。
 */
import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { buildTrack, type ReelCell } from "@/lib/reel/v1";
import { newRound, phaseAt, posAt, reactionOf, skipAt, stopSoundOf, times, type Phase, type Round } from "@/lib/reel/timeline";
import { buzz, canVibrate, hapticOn, playOpen, playShine, playStop, playTick, prepareAudio, setHaptic, setSound, soundOn } from "@/lib/reel/audio";
import { chestTitle } from "@/lib/checkin";
import { boxKindOf, NEWCOMER_BADGE, poseUrl, preloadPoses, type CheckinPose } from "@/lib/checkin-art";
import { fetchPlan, type ClaimResult, type RewardPlan } from "@/lib/rewards";
import { isNight } from "@/lib/mascot-home";
import { monthDayOf, monthDayTime, whole } from "@/lib/format";
import { wrapTab } from "@/lib/focus-trap";
import { useLocalePath } from "@/lib/use-locale";
import CreditIcon from "./CreditIcon.vue";
import SukiCarry from "./SukiCarry.vue";

export interface StageOutcome { claims: ClaimResult[]; recap: boolean; streak?: number; replayed?: boolean }
export type StageMood = "win" | "miss" | "ok";

const props = defineProps<{
  /** 要開的箱子（依序）；送出前就知道，舞台一打開就畫對的箱子與標題 */
  chests: string[];
  plan: RewardPlan | null;
  request: () => Promise<StageOutcome>;
  /** 簽到的結果卡底部要列連續天數與保底；任務箱不列 */
  checkin: boolean;
  pity?: number;
}>();
const emit = defineEmits<{ close: [mood: StageMood | null]; settled: [outcome: StageOutcome] }>();
const { t } = useI18n();
const { lp } = useLocalePath();

type Step = "waiting" | "error" | "recap" | "pending" | "round";
const step = ref<Step>("waiting");
const slow = ref(false);
const errorKind = ref<"network" | "busy">("network");
const outcome = shallowRef<StageOutcome | null>(null);
const rounds = shallowRef<{ claim: ClaimResult; round: Round; plan: RewardPlan; chest: string }[]>([]);
const idx = ref(0);
const phase = ref<Phase | "idle">("idle");
const done = ref<number[]>([]);
const sound = ref(soundOn());
const haptic = ref(hapticOn());
const vibrates = canVibrate();
const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const night = isNight(new Date());

const root = ref<HTMLElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const trackEl = ref<HTMLElement | null>(null);
const reelEl = ref<HTMLElement | null>(null);
const zoneEl = ref<HTMLElement | null>(null);
const carryEl = ref<{ box: HTMLElement | null; lid: HTMLElement | null } | null>(null);
const mascotEl = ref<HTMLElement | null>(null);
const heartsEl = ref<HTMLElement | null>(null);
const mainBtn = ref<HTMLButtonElement | null>(null);

const current = computed(() => rounds.value[idx.value] ?? null);
const chestKey = computed(() => current.value?.chest ?? props.chests[idx.value] ?? props.chests[0] ?? "daily");
const titleOf = (chest: string) => { const c = chestTitle(chest, props.plan); return t(c.key, c.params ?? {}); };
const total = computed(() => (rounds.value.length ? rounds.value.length : props.chests.length || 1));
const busy = computed(() => step.value === "round" && (phase.value === "open" || phase.value === "spin" || phase.value === "hold"));
const showResult = computed(() => step.value === "round" && phase.value === "result");
const lastRound = computed(() => idx.value >= rounds.value.length - 1);
const pose = computed<CheckinPose>(() => {
  if (step.value !== "round" || phase.value !== "result" || !current.value) return "carry";
  const r = reactionOf(current.value.round);
  return r === "cheer" ? "cheer" : r === "miss" ? "miss" : "coins";
});
const poseSrc = computed(() => poseUrl(pose.value));

// ---- 送出與回應 ----
let pressedAt = 0;
/** 送出中的那一次：逾時後再試一次時接著等它，不另送一次（同一件事不重複送） */
let inflight: Promise<StageOutcome> | null = null;
let posesReady: Promise<void> = Promise.resolve();
let timer = 0;
async function send() {
  step.value = "waiting";
  // 按「再試一次」的那顆鍵會消失：焦點留在舞台上，鍵盤才不會掉到頁面
  void nextTick(() => panelEl.value?.focus());
  slow.value = false;
  pressedAt = performance.now();
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { slow.value = true; }, 600);
  const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 8000));
  try {
    if (!inflight) {
      inflight = props.request().finally(() => { inflight = null; });
      // 逾時後關掉舞台、沒人再等它：吞掉之後的失敗，不在主控台留下未處理的錯誤
      inflight.catch(() => undefined);
    }
    const res = await Promise.race([inflight, timeout]);
    outcome.value = res;
    emit("settled", res);
    await prepareRounds(res);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 0;
    errorKind.value = status >= 400 && status !== 408 && status !== 429 && status < 500 ? "busy" : status >= 500 ? "busy" : "network";
    step.value = "error";
  } finally {
    window.clearTimeout(timer);
  }
}

async function prepareRounds(res: StageOutcome) {
  if (res.recap) { step.value = "recap"; return; }
  const drawable = res.claims.filter((c) => c.status === "granted" && c.tier != null && c.stripSeed != null && c.chest);
  if (!drawable.length) { step.value = "pending"; return; }
  const built = [];
  for (const c of drawable) {
    const plan = c.planVersion != null && props.plan?.version !== c.planVersion ? await fetchPlan(c.planVersion).catch(() => props.plan) : props.plan;
    const prizes = plan?.chests[c.chest!]?.prizes;
    if (!plan || !prizes?.length) continue;
    built.push({ claim: c, chest: c.chest!, plan, round: newRound(buildTrack({ prizes, tier: c.tier!, seed: c.stripSeed! >>> 0 }), reduced) });
  }
  if (!built.length) { step.value = "pending"; return; }
  // 圖還沒載好之前不能進滾輪：時間軸要等 startRound 才開始算
  startAt = Infinity;
  await posesReady;
  rounds.value = built;
  idx.value = 0;
  done.value = [];
  step.value = "round";
  // 前搖：從按下起至少 1 秒才開蓋，回應再快也留一下
  const wait = Math.max(0, 1000 - (performance.now() - pressedAt));
  await nextTick();
  startRound(wait);
}

// ---- 每一輪：時間軸、聲音、觸覺 ----
let raf = 0;
let startAt = Infinity;
let lastIdx = 0;
let lastPos = 0;
let lastFrame = 0;
let lastBuzz = 0;
let fired = { open: false, result: false };
let pitch = 92;
let fitCache = new Map<string, number>();

function geometry() {
  const zone = zoneEl.value;
  if (!zone) return;
  const cs = getComputedStyle(zone);
  pitch = (parseFloat(cs.getPropertyValue("--cw")) || 88) + (parseFloat(cs.getPropertyValue("--gap")) || 4);
}

function startRound(delay = 0) {
  const r = current.value?.round;
  if (!r) return;
  cancelAnimationFrame(raf);
  geometry();
  fitCache = new Map();
  lastIdx = Math.round(r.track.s0);
  lastPos = r.track.s0;
  lastFrame = 0;
  fired = { open: false, result: false };
  phase.value = "open";
  startAt = performance.now() + delay;
  raf = requestAnimationFrame(frame);
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

function frame(now: number) {
  raf = requestAnimationFrame(frame);
  const cur = current.value;
  if (!cur || step.value !== "round" || startAt === Infinity) { idle(now); return; }
  const r = cur.round;
  const t = now - startAt;
  if (t < 0) { idle(now); return; }
  const ph = phaseAt(r, t);
  if (ph !== phase.value) phase.value = ph;
  const tm = times(r);
  drawBox(t, tm.open);
  const pos = posAt(r, t);
  if (trackEl.value) trackEl.value.style.transform = `translate3d(${(-pos * pitch).toFixed(2)}px,0,0)`;
  drawMascot(r, t - tm.resultAt, now);
  // 聲音與觸覺：開蓋一聲；經過指針喀噠，第 5、6 級閃光；最後幾格輕震
  if (!fired.open) { fired.open = true; if (!r.reduced) { playOpen(); buzz(10); } }
  const dt = lastFrame ? now - lastFrame : 16;
  lastFrame = now;
  if (ph === "spin") {
    const i = Math.round(pos);
    if (i > lastIdx) {
      const norm = ((pos - lastPos) / Math.max(1, dt)) * 1000 / 16;
      let best = 0;
      for (let k = lastIdx + 1; k <= i; k++) best = Math.max(best, r.track.cells[k].tier);
      playTick(norm);
      if (best >= 5) playShine(best, norm);
      if (i > r.track.T - r.track.params.hapticCells && now - lastBuzz >= 70) { lastBuzz = now; buzz(best >= 5 ? 14 : 8); }
      lastIdx = i;
    }
    lastPos = pos;
  }
  if (ph === "result" && !fired.result) {
    fired.result = true;
    playStop(stopSoundOf(r));
    buzz(r.track.tier >= 5 ? [40, 50, 40, 50, 120] : 25);
    done.value = [...done.value, idx.value];
    void nextTick(() => mainBtn.value?.focus());
  }
  if (ph === "result" && t - tm.resultAt > 1600) { drawMascot(r, 1600, now); cancelAnimationFrame(raf); }
}

function idle(now: number) {
  const b = carryEl.value?.box;
  if (b && !reduced) b.style.transform = `scale(${1 + Math.sin(now / 520) * 0.02})`;
  if (mascotEl.value && !reduced) mascotEl.value.style.transform = `translate3d(0,${Math.sin(now / 700) * 2}px,0)`;
}

/** 開蓋：整疊在她手上抖兩下，蓋彈起（上移、轉、淡出），箱身與箱內留在手上；滾輪從箱口展開。 */
function drawBox(t: number, openMs: number) {
  const box = carryEl.value?.box, lid = carryEl.value?.lid, reel = reelEl.value;
  if (!reel) return;
  if (!openMs) { if (lid) lid.style.opacity = "0"; reel.style.opacity = String(easeOut(clamp01(t / 300))); reel.style.transform = "none"; return; }
  const u = clamp01(t / openMs);
  const shake = u < 0.42 ? Math.sin((u / 0.42) * Math.PI * 4) * 5 * (1 - (u / 0.42) * 0.3) : 0;
  const lu = clamp01((u - 0.5) / 0.5);
  if (box) box.style.transform = `rotate(${shake}deg)`;
  if (lid) { lid.style.transform = `translate3d(0,${-lu * 11}%,0) rotate(${-lu * 24}deg)`; lid.style.opacity = String(1 - clamp01((lu - 0.6) / 0.4)); }
  const ru = clamp01((u - 0.55) / 0.45);
  reel.style.opacity = String(easeOut(ru));
  reel.style.transform = `translate3d(0,${-(1 - easeOut(ru)) * 26}px,0) scaleX(${0.18 + 0.82 * easeOut(ru)})`;
}

const HEARTS = 15;
function drawMascot(r: Round, rt: number, now: number) {
  const m = mascotEl.value;
  if (!m) return;
  let my = 0, mx = 0, mr = 0, ms = 1;
  if (rt < 0) { if (!r.reduced) my = Math.sin(now / 700) * 2; }
  else if (!r.reduced) {
    const kind = reactionOf(r);
    const u = clamp01(rt / 1400);
    if (kind === "cheer") { my = -Math.abs(Math.sin(u * Math.PI * 3)) * 36 * (1 - 0.5 * u); ms = 1 + 0.03 * Math.sin(u * Math.PI); }
    else if (kind === "miss") { mx = Math.sin(u * 38) * 5 * (1 - u); my = 8 * easeOut(clamp01(u * 2)); mr = -3 * easeOut(clamp01(u * 2)); }
    else my = -Math.sin(u * Math.PI * 2) * 8 * (1 - u);
  }
  m.style.transform = `translate3d(${mx}px,${my}px,0) rotate(${mr}deg) scale(${ms})`;
  // 愛心紙花（第 5、6 級）：從蘇綺出發，圖層在滾輪與結果後面；插圖自帶紙花，程式的只留一半
  const hearts = heartsEl.value?.children;
  if (!hearts) return;
  const n = r.track.tier >= 6 ? 15 : r.track.tier >= 5 ? 9 : 0;
  for (let k = 0; k < HEARTS; k++) {
    const h = hearts[k] as HTMLElement;
    if (!n || k >= n || rt < 0 || r.reduced) { h.style.opacity = "0"; continue; }
    const seed = (k * 9301 + 49297) % 233280 / 233280;
    const a = -Math.PI * (0.12 + 0.76 * seed), sp = 150 + 260 * ((k * 7919) % 97) / 97, rot = (seed - 0.5) * 540, sz = 14 + 14 * ((k * 31) % 11) / 11;
    const u = (rt / 1000 - (k % 4) * 0.025) / 1.1;
    if (u < 0 || u > 1) { h.style.opacity = "0"; continue; }
    const sec = u * 1.1;
    const x = Math.cos(a) * sp * 0.55 * sec, y = Math.sin(a) * sp * 0.55 * sec + 200 * sec * sec;
    h.style.opacity = String(1 - u * u);
    h.style.transform = `translate3d(${x - 10}px,${y - 10}px,0) rotate(${rot * u}deg) scale(${sz / 20})`;
  }
}

// ---- 操作 ----
function skip() {
  const cur = current.value;
  if (!cur || !busy.value) return;
  if (skipAt(cur.round, performance.now() - startAt)) phase.value = phaseAt(cur.round, performance.now() - startAt);
}
function next() {
  if (lastRound.value) return close();
  idx.value += 1;
  startAt = Infinity;
  void nextTick(() => { panelEl.value?.focus(); startRound(0); });
}
function moodOf(): StageMood | null {
  const list = rounds.value;
  if (!list.length) return null;
  if (list.some((x) => x.round.track.tier >= 5)) return "win";
  if (list.some((x) => reactionOf(x.round) === "miss")) return "miss";
  return "ok";
}
function close() {
  if (busy.value) return;
  cancelAnimationFrame(raf);
  emit("close", step.value === "round" || step.value === "recap" || step.value === "pending" ? moodOf() : null);
}
function toggleSound() { sound.value = !sound.value; setSound(sound.value); }
function toggleHaptic() { haptic.value = !haptic.value; setHaptic(haptic.value); }
function onKey(e: KeyboardEvent) {
  if (e.key === "Tab" && panelEl.value) { wrapTab(e, panelEl.value); return; }
  if (busy.value && (e.key === " " || e.key === "Enter" || e.key === "Escape")) { e.preventDefault(); skip(); return; }
  // 等回應的時候 Esc 不做事（ui.md §6.4：結果出來才是關閉；要放棄等待用關閉鈕）
  if (e.key === "Escape" && step.value !== "waiting") { e.preventDefault(); close(); }
}
function onBackdrop(e: MouseEvent) { if (e.target === root.value && !busy.value && step.value !== "waiting") close(); }

// ---- 結果的字 ----
const prizeOf = (c: ClaimResult) => c.credits ?? 0;
/** 新住民寶箱附的徽章不是造型道具：結果卡在金額之外多一格徽章（ui.md §5） */
const isBadge = (c: ClaimResult) => c.chest === "newcomer" || (!!c.item && c.item.startsWith("hearth_newcomer"));
const cosmetic = (c: ClaimResult) => !!c.item && !c.duplicate && !isBadge(c);
const daysLeft = (iso: string) => Math.floor((Date.parse(iso) - Date.now()) / 86_400_000);
function expiryLine(c: ClaimResult): string {
  if (c.status === "pending") return c.releaseAt ? t("checkin.result.pending", { date: monthDayOf(c.releaseAt) }) : t("wallet.record.pending");
  if (cosmetic(c)) return t("checkin.result.cosmetic.added");
  if (!c.expiresAt) return "";
  const days = daysLeft(c.expiresAt);
  return days < 1 ? t("checkin.result.expires.today", { datetime: monthDayTime(c.expiresAt) }) : t("checkin.result.expires", { datetime: monthDayTime(c.expiresAt), days }, days);
}
const ariaLine = (c: ClaimResult) => (cosmetic(c)
  ? t("checkin.result.aria.cosmetic", { type: t("checkin.result.cosmetic.frame"), name: t("checkin.result.cosmetic.frame") })
  : t("checkin.result.aria.credits", { amount: whole(prizeOf(c)), datetime: c.expiresAt ? monthDayTime(c.expiresAt) : "" }));
const resultRows = computed(() => done.value.map((i) => rounds.value[i]).filter(Boolean));
const sum = computed(() => resultRows.value.reduce((s, x) => s + (cosmetic(x.claim) ? 0 : prizeOf(x.claim)), 0));
const twoDone = computed(() => rounds.value.length > 1 && done.value.length === rounds.value.length && showResult.value && lastRound.value);
const otherClaims = computed(() => (outcome.value?.claims ?? []).filter((c) => !(c.status === "granted" && c.stripSeed != null)));
const bubble = computed(() => {
  const cur = current.value;
  if (!cur || !showResult.value) return "";
  const kind = reactionOf(cur.round);
  const pick = (keys: string[]) => keys[(cur.claim.stripSeed ?? 0) % keys.length];
  if (kind === "cheer") return t(cur.round.track.tier >= 6 ? "checkin.suki.win.6" : "checkin.suki.win.5");
  if (kind === "miss") return t(pick(["checkin.suki.miss.a", "checkin.suki.miss.b"]));
  return t(night ? "checkin.suki.ok.night" : pick(["checkin.suki.ok.a", "checkin.suki.ok.b", "checkin.suki.ok.c"]));
});
const pityOut = computed(() => outcome.value?.claims.find((c) => c.pityRemaining != null)?.pityRemaining ?? props.pity);

// ---- 格子 ----
const fitCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
function amountSize(text: string): number {
  const hit = fitCache.get(text);
  if (hit) return hit;
  const cw = pitch - 4;
  let size = cw * 0.34;
  if (fitCtx) { fitCtx.font = `800 100px ${getComputedStyle(document.body).fontFamily}`; size = Math.min(cw * 0.34, (cw * 0.86) / fitCtx.measureText(text).width * 100); }
  size = Math.floor(size * 10) / 10;
  fitCache.set(text, size);
  return size;
}
const cellText = (c: ReelCell) => whole(c.prize.credits ?? 0);

// ---- 開關 ----
async function begin() {
  prepareAudio();
  document.documentElement.style.overflow = "hidden";
  raf = requestAnimationFrame(frame);
  posesReady = preloadPoses([...new Set(props.chests.map(boxKindOf))]);
  await send();
}
void (async () => {
  await nextTick();
  panelEl.value?.focus();
  await begin();
})();
onBeforeUnmount(() => { cancelAnimationFrame(raf); window.clearTimeout(timer); document.documentElement.style.overflow = ""; });
defineExpose({ skip });
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="stage-wrap" @click="onBackdrop">
      <div
        ref="panelEl" class="stage" role="dialog" aria-modal="true" :aria-label="t('checkin.stage.aria')" tabindex="-1"
        :data-step="step" :data-phase="phase" :data-boxes="total" :class="{ 'stage--reduced': reduced }" @keydown="onKey"
      >
        <div class="stage__in">
          <header class="st-head">
            <span class="st-count" aria-hidden="true">{{ total > 1 && step === 'round' ? t("checkin.stage.count", { i: idx + 1, n: total }) : "" }}</span>
            <span class="st-tools">
              <button type="button" class="icon-btn" :aria-pressed="!sound" :aria-label="sound ? t('checkin.stage.mute') : t('checkin.stage.unmute')" @click="toggleSound">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path v-if="sound" d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11" /><path v-else d="M17 9.5l5 5M22 9.5l-5 5" /></svg>
              </button>
              <button v-if="vibrates" type="button" class="icon-btn" :aria-pressed="haptic" :aria-label="t('checkin.stage.haptic')" @click="toggleHaptic">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="4" width="8" height="16" rx="1.5" /><path d="M4 8v8M20 8v8" /><path v-if="!haptic" d="M3 3l18 18" /></svg>
              </button>
              <button type="button" class="icon-btn" :class="{ 'icon-btn--away': busy }" :aria-label="t('checkin.stage.close')" :tabindex="busy ? -1 : 0" @click="close">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </span>
          </header>

          <!-- 出錯的是我們：錯誤畫面不放蘇綺（美術總監 r1 擋 2） -->
          <div v-if="step === 'error'" class="st-error" role="alert">
            <strong>{{ t("checkin.stage.error.title") }}</strong>
            <p>{{ errorKind === "busy" ? t("checkin.stage.error.busy") : t("checkin.stage.error.body") }}</p>
          </div>

          <div v-else class="core">
            <section class="mascot-zone">
              <div ref="mascotEl" class="mascot">
                <SukiCarry v-if="pose === 'carry'" ref="carryEl" class="mascot__carry" :kind="boxKindOf(chestKey)" />
                <img v-else class="mascot__pose" :src="poseSrc" alt="" draggable="false" />
              </div>
              <p v-if="bubble" class="bubble">{{ bubble }}</p>
            </section>

            <section v-if="step === 'round'" ref="zoneEl" class="reel-zone">
              <div ref="reelEl" class="reel" aria-hidden="true">
                <div class="reel-view">
                  <div ref="trackEl" class="track">
                    <div v-for="(c, i) in current?.round.track.cells ?? []" :key="`${idx}-${i}`" class="cell" :class="[`t${c.tier}`, { cos: c.prize.item, won: (phase === 'hold' || phase === 'result') && i === current?.round.track.T }]">
                      <template v-if="c.prize.item">
                        <svg class="cos-ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.5 18c1.2-2.6 3-3.5 5.5-3.5s4.3.9 5.5 3.5" /></svg>
                        <span class="cos-l">{{ t("checkin.result.cosmetic.frame") }}</span>
                      </template>
                      <template v-else>
                        <CreditIcon class="coin" />
                        <b class="amt" :style="{ fontSize: `${amountSize(cellText(c))}px` }">{{ cellText(c) }}</b>
                        <i class="unit">{{ t("checkin.result.unit") }}</i>
                      </template>
                      <template v-if="c.tier === 6"><span class="sp" /><span class="sp" /><span class="sp" /></template>
                    </div>
                  </div>
                </div>
                <i class="fade l" /><i class="fade r" />
                <div class="pointer top" /><div class="pointer bot" />
              </div>
            </section>

            <div class="st-title">{{ step === "recap" ? t("checkin.stage.recap.title") : titleOf(chestKey) }}</div>

            <section class="result-zone">
              <p v-if="step === 'waiting' && slow" class="st-wait">{{ t("checkin.stage.waiting") }}</p>

              <!-- 一箱：級名、大字金額、期限；兩箱的最後：兩份都列，加總 -->
              <div v-if="showResult && current && !twoDone" class="result" role="status">
                <span class="sr-only">{{ ariaLine(current.claim) }}</span>
                <div class="r-top" aria-hidden="true"><span class="dot" :class="`t${current.claim.tier}`" /><span>{{ t(`checkin.result.tier.${current.claim.tier}`) }}</span></div>
                <div v-if="cosmetic(current.claim)" class="r-amt r-amt--cos" aria-hidden="true">{{ t("checkin.result.cosmetic.frame") }}</div>
                <div v-else class="r-amt" aria-hidden="true">{{ t("checkin.result.amount", { amount: whole(prizeOf(current.claim)) }) }}<small>{{ t("checkin.result.unit") }}</small></div>
                <div class="r-exp">{{ current.claim.duplicate ? t("checkin.result.cosmetic.owned", { amount: whole(prizeOf(current.claim)) }) : expiryLine(current.claim) }}</div>
                <div v-if="checkin && rounds.length === 1" class="r-more">
                  <span v-if="outcome?.streak">{{ t("checkin.result.streak", { n: outcome.streak }) }}</span>
                  <span v-if="pityOut">{{ pityOut === 1 ? t("checkin.result.pity.next") : t("checkin.result.pity", { n: pityOut }) }}</span>
                </div>
                <div v-if="isBadge(current.claim)" class="r-badge"><img :src="NEWCOMER_BADGE" alt="" width="48" height="48" /><span><strong>{{ t("newcomer.badge.name") }}</strong><small>{{ t("newcomer.badge.desc") }}</small></span></div>
                <RouterLink v-if="cosmetic(current.claim)" :to="lp('/settings')" class="r-link">{{ t("checkin.result.cosmetic.equip") }}</RouterLink>
              </div>
              <div v-else-if="twoDone" class="rows" role="status">
                <div v-for="x in resultRows" :key="x.claim.rewardKey" class="row">
                  <span class="n">{{ titleOf(x.chest) }}</span>
                  <span class="a">{{ cosmetic(x.claim) ? t("checkin.result.cosmetic.frame") : t("checkin.done.amount", { amount: whole(prizeOf(x.claim)) }) }}</span>
                  <span class="br" />
                  <span class="t"><span class="dot" :class="`t${x.claim.tier}`" />{{ t(`checkin.result.tier.${x.claim.tier}`) }}</span>
                  <span class="e">{{ expiryLine(x.claim) }}</span>
                </div>
                <div class="row row--sum"><span class="n">{{ t("checkin.result.total", { sum: whole(sum) }) }}</span></div>
              </div>

              <!-- 已經簽過（另一台裝置）或還在處理中：不轉滾輪，直接講結果 -->
              <div v-else-if="step === 'recap' || step === 'pending'" class="rows" role="status">
                <div v-for="c in (outcome?.claims ?? []).filter((x) => x.status !== 'not_granted')" :key="c.rewardKey" class="row">
                  <span class="n">{{ titleOf(c.chest ?? chests[0] ?? 'daily') }}</span>
                  <span v-if="c.status === 'granted' && c.credits != null" class="a">{{ t("checkin.done.amount", { amount: whole(c.credits) }) }}</span>
                  <span class="br" />
                  <span v-if="c.tier" class="t"><span class="dot" :class="`t${c.tier}`" />{{ t(`checkin.result.tier.${c.tier}`) }}</span>
                  <span class="e">{{ expiryLine(c) }}</span>
                </div>
              </div>
              <div v-if="showResult && lastRound && otherClaims.length" class="rows">
                <div v-for="c in otherClaims.filter((x) => x.status === 'pending')" :key="c.rewardKey" class="row"><span class="n">{{ titleOf(c.chest ?? 'daily') }}</span><span class="e">{{ expiryLine(c) }}</span></div>
              </div>
            </section>
          </div>

          <footer class="st-foot">
            <div class="btns">
              <template v-if="step === 'error'">
                <button type="button" class="ghost" @click="close">{{ t("checkin.stage.error.later") }}</button>
                <button ref="mainBtn" type="button" class="primary" @click="send">{{ t("checkin.stage.error.retry") }}</button>
              </template>
              <button v-else-if="busy" type="button" class="ghost" @click="skip">{{ t("checkin.stage.skip") }}</button>
              <button v-else-if="step === 'recap'" ref="mainBtn" type="button" class="primary" @click="close">{{ t("checkin.stage.recap.ok") }}</button>
              <button v-else-if="step === 'pending'" ref="mainBtn" type="button" class="primary" @click="close">{{ t("checkin.stage.collect") }}</button>
              <button v-else-if="showResult" ref="mainBtn" type="button" class="primary" @click="next">{{ lastRound ? t("checkin.stage.collect") : t("checkin.stage.next") }}</button>
            </div>
            <span class="st-links">
              <RouterLink v-if="showResult && lastRound" :to="lp('/library')" class="odds" @click="close">{{ t("checkin.result.chat") }}</RouterLink>
              <a :href="lp('/checkin/odds')" target="_blank" rel="noopener" class="odds">{{ t("checkin.stage.odds") }}</a>
            </span>
          </footer>
          <div ref="heartsEl" class="hearts" aria-hidden="true">
            <svg v-for="k in HEARTS" :key="k" class="heart" :class="{ 'heart--gold': k % 2 === 0 }" viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.7 5 6 5c2.1 0 3.6 1.2 4.4 2.5h3.2C14.4 6.2 15.9 5 18 5c3.3 0 5.1 3.4 3.6 6.8C19.5 16.4 12 21 12 21z" fill="currentColor" /></svg>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 舞台專用 tokens：只在開箱舞台內出現，不給站台其他畫面用（art.md §2、§3） */
.stage {
  --stage-bg-1:#2B2F55; --stage-bg-2:#14162E; --stage-cream:#FFF6E6; --stage-rose:#E5506E; --stage-rose-deep:#C93A58;
  --stage-gold:#F2C14E; --stage-navy:#14162E; --stage-reel-bg:#191B38;
  --stage-tier-1:rgba(255,246,230,.07); --stage-tier-2:rgba(255,246,230,.15); --stage-tier-4:var(--stage-rose-deep);
  --stage-tier-5:linear-gradient(180deg,#FFE9A8,#F2C14E); --stage-tier-6:linear-gradient(180deg,#FFE9A8,#F2C14E);
  container:stage / size;
  position:fixed; inset:0; z-index:100; overflow:hidden; outline:none;
  background:linear-gradient(180deg, var(--stage-bg-1), var(--stage-bg-2)); color:var(--stage-cream);
}
.stage-wrap { position:fixed; inset:0; z-index:100; }
.stage__in { position:relative; height:100%; display:flex; flex-direction:column; padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom); }
@media (min-width: 761px) and (min-height: 520px) {
  .stage-wrap { display:grid; place-items:center; background:rgba(16,16,24,.45); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
  .stage { position:relative; inset:auto; width:min(720px, calc(100vw - 48px)); height:min(820px, calc(100dvh - 48px)); min-height:min(560px, calc(100dvh - 48px)); border-radius:var(--r-lg); box-shadow:var(--shadow-md); }
}
button { font:inherit; color:inherit; }
.st-head { position:relative; z-index:3; display:flex; align-items:center; justify-content:space-between; gap:4px; padding:8px 12px 0; min-height:52px; }
.st-count { min-width:44px; font-size:15px; font-weight:700; font-variant-numeric:tabular-nums; opacity:.9; }
.st-tools { display:flex; gap:4px; }
.icon-btn { width:44px; height:44px; border-radius:50%; border:0; background:rgba(255,246,230,.08); display:grid; place-items:center; cursor:pointer; }
.icon-btn svg { width:22px; height:22px; stroke:var(--stage-cream); fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.icon-btn--away { visibility:hidden; }
.icon-btn:focus-visible, .primary:focus-visible, .ghost:focus-visible, .odds:focus-visible, .r-link:focus-visible { outline:2px solid var(--stage-cream); outline-offset:2px; }
.st-title { flex:0 0 auto; min-height:20px; margin:4px 16px 0; font-size:15px; font-weight:600; letter-spacing:.02em; opacity:.92; text-align:center; position:relative; z-index:2; }
.st-error { flex:1 1 auto; display:grid; align-content:center; justify-items:center; gap:var(--s-2); padding:0 var(--s-6); text-align:center; }
.st-error strong { font-size:18px; }
.st-error p { margin:0; font-size:14px; line-height:1.6; opacity:.85; max-width:320px; text-wrap:pretty; }
.st-wait { margin:0; font-size:12px; opacity:.8; text-align:center; }

.core { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; justify-content:space-evenly; position:relative; z-index:2; }
.mascot-zone { --mascot-h:min(30cqh, 270px); flex:0 0 auto; height:var(--mascot-h); display:flex; justify-content:center; align-items:flex-end; position:relative; z-index:2; }
.mascot { position:relative; height:var(--mascot-h); aspect-ratio:0.6804; will-change:transform; }
.mascot__pose { position:absolute; left:50%; top:0; height:100%; width:auto; transform:translateX(-50%); display:block; user-select:none; pointer-events:none; }
.mascot__carry { position:absolute; inset:0; height:100%; }
.bubble { position:absolute; top:calc(var(--mascot-h) * .03); left:calc(50% + var(--mascot-h) * .10); width:max-content; max-width:min(60cqw, calc(50cqw - var(--mascot-h) * .10 - 8px)); margin:0; text-wrap:balance; background:#fff; color:#2a1d24; font-size:13.5px; line-height:1.35; font-weight:600; padding:6px 10px; border-radius:16px; z-index:4; animation:bubble-in var(--dur) var(--ease) both; }
.bubble::after { content:""; position:absolute; left:10px; bottom:-6px; border:6px solid transparent; border-top-color:#fff; border-bottom:0; }

.reel-zone { --cw:88px; --ch:104px; --gap:4px; --zone-h:calc(var(--ch) + 56px); position:relative; flex:0 0 auto; z-index:2; margin-top:1.5cqh; height:var(--zone-h); }
@media (min-width: 640px) { .reel-zone { --cw:112px; --ch:128px; --gap:8px; } }
.reel { position:absolute; left:0; right:0; top:50%; height:calc(var(--ch) + 30px); margin-top:calc((var(--ch) + 30px) / -2); opacity:0; transform-origin:50% 50%; }
.reel-view { position:absolute; inset:0; overflow:hidden; background:var(--stage-reel-bg); border-top:1px solid rgba(255,246,230,.16); border-bottom:1px solid rgba(255,246,230,.16); }
.track { position:absolute; top:15px; left:50%; margin-left:calc(var(--cw) / -2); display:flex; gap:var(--gap); will-change:transform; }
.fade { position:absolute; top:0; bottom:0; width:22%; pointer-events:none; z-index:3; }
.fade.l { left:0; background:linear-gradient(90deg, var(--stage-reel-bg) 8%, transparent); }
.fade.r { right:0; background:linear-gradient(270deg, var(--stage-reel-bg) 8%, transparent); }
.pointer { position:absolute; left:50%; width:2px; margin-left:-1px; height:10px; background:var(--stage-rose); z-index:4; border-radius:1px; }
.pointer.top { top:-8px; } .pointer.bot { bottom:-8px; }
.pointer::after { content:""; position:absolute; left:50%; margin-left:-7px; border:7px solid transparent; }
.pointer.top::after { top:9px; border-top:8px solid var(--stage-rose); border-bottom:0; }
.pointer.bot::after { bottom:9px; border-bottom:8px solid var(--stage-rose); border-top:0; }

/* 六級：只用玫瑰紅與金兩個色相做強度分級，每一步至少換一種東西（art.md §2、art-review-r2） */
.cell { position:relative; flex:0 0 var(--cw); width:var(--cw); height:var(--ch); border-radius:12px; overflow:hidden; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; color:var(--stage-cream); background:var(--stage-tier-1); transition:transform .2s; }
.cell > * { position:relative; z-index:1; }
.cell .coin { width:calc(var(--cw) * .30); height:calc(var(--cw) * .30); color:#F2B01E; filter:drop-shadow(0 1px 1px rgba(242,176,30,.4)); }
.cell.t5 .coin, .cell.t6 .coin { color:var(--stage-navy); filter:none; }
.cell .amt { font-weight:800; line-height:1; font-variant-numeric:tabular-nums; letter-spacing:-.01em; white-space:nowrap; }
.cell .unit { font-style:normal; font-size:calc(var(--cw) * .15); line-height:1; }
.cell.t2 { background:var(--stage-tier-2); box-shadow:inset 0 0 0 1px rgba(255,246,230,.40); }
.cell.t3 { background:rgba(255,246,230,.12); box-shadow:inset 0 0 0 3px var(--stage-rose); }
.cell.t4 { background:var(--stage-tier-4); box-shadow:inset 0 0 0 1px rgba(255,255,255,.25), 0 0 16px rgba(229,80,110,.65); color:#fff; }
.cell.t5 { background:var(--stage-tier-5); color:var(--stage-navy); box-shadow:inset 0 0 0 2px #FFF3C4, 0 0 20px rgba(242,193,78,.75); }
.cell.t6 { background:var(--stage-tier-6); color:var(--stage-navy); box-shadow:inset 0 0 0 6px var(--stage-rose), inset 0 0 0 8px #FFF3C4, 0 0 26px rgba(242,193,78,.95), 0 0 12px rgba(229,80,110,.85); }
.cell.t6::before { content:""; position:absolute; z-index:0; left:50%; top:50%; width:220%; aspect-ratio:1; margin:-110% 0 0 -110%; background:repeating-conic-gradient(rgba(255,255,255,.85) 0 10deg, transparent 10deg 30deg); opacity:.8; animation:rays 8s linear infinite; }
.cell .sp { position:absolute; z-index:2; width:10px; height:10px; background:#fff; transform:rotate(45deg) scale(0); animation:twinkle 1.7s ease-in-out infinite; }
.cell .sp:nth-of-type(1) { left:12%; top:12%; }
.cell .sp:nth-of-type(2) { right:14%; top:36%; animation-delay:.55s; }
.cell .sp:nth-of-type(3) { left:24%; bottom:12%; animation-delay:1.1s; }
.cell.won { transform:scale(1.07); outline:2px solid var(--stage-cream); outline-offset:3px; }
.cell.cos .cos-ic { width:calc(var(--cw) * .46); height:calc(var(--cw) * .46); fill:none; stroke:var(--stage-cream); stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; }
.cell.cos .cos-l { font-size:calc(var(--cw) * .17); font-weight:700; line-height:1; text-align:center; padding:0 4px; }
.cell.cos.t4 .cos-ic { stroke:#fff; } .cell.cos.t5 .cos-ic, .cell.cos.t6 .cos-ic { stroke:var(--stage-navy); }
@keyframes rays { to { transform:rotate(360deg); } }
@keyframes twinkle { 0%, 55%, 100% { transform:rotate(45deg) scale(0); opacity:0; } 25% { transform:rotate(45deg) scale(1); opacity:1; } }
@keyframes bubble-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }

.result-zone { flex:0 1 clamp(104px, 18cqh, 190px); min-height:56px; overflow-y:auto; overscroll-behavior:contain; position:relative; z-index:2; padding:10px 16px 0; display:flex; flex-direction:column; align-items:center; gap:8px; }
.stage[data-boxes="2"] .result-zone { flex-basis:clamp(150px, 27cqh, 214px); }
.result { width:min(100%, 420px); text-align:center; animation:result-in .25s var(--ease) both; }
@keyframes result-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
.r-top { display:inline-flex; align-items:center; gap:8px; font-size:14px; opacity:.9; }
.dot { width:10px; height:10px; border-radius:50%; background:var(--stage-cream); box-shadow:0 0 0 1px rgba(255,246,230,.5); flex:none; }
.dot.t1 { background:rgba(255,246,230,.45); } .dot.t2 { background:rgba(255,246,230,.8); }
.dot.t3 { background:#F08CA0; } .dot.t4 { background:var(--stage-rose); }
.dot.t5 { background:var(--stage-gold); } .dot.t6 { background:var(--stage-gold); box-shadow:0 0 0 2px var(--stage-rose); }
.r-amt { font-size:40px; font-weight:800; line-height:1.15; font-variant-numeric:tabular-nums; margin-top:4px; }
.r-amt--cos { font-size:28px; }
.r-amt small { font-size:16px; font-weight:600; opacity:.85; margin-left:4px; }
.r-exp { font-size:14px; opacity:.85; margin-top:2px; }
.r-more { display:flex; justify-content:center; flex-wrap:wrap; gap:4px 14px; margin-top:6px; font-size:12.5px; opacity:.75; }
.r-badge { display:inline-flex; align-items:center; gap:10px; margin-top:8px; padding:6px 12px 6px 6px; border-radius:14px; background:rgba(255,246,230,.08); text-align:left; }
.r-badge img { width:48px; height:48px; }
.r-badge span { display:grid; gap:2px; }
.r-badge strong { font-size:14px; }
.r-badge small { font-size:12px; opacity:.8; }
.r-link { display:inline-flex; min-height:44px; align-items:center; color:var(--stage-cream); text-decoration:underline; text-underline-offset:3px; font-size:13px; }
.rows { width:min(100%, 420px); display:grid; gap:4px; }
.row { display:flex; flex-wrap:wrap; align-items:center; column-gap:10px; padding:5px 12px; border-radius:12px; background:rgba(255,246,230,.07); text-align:left; animation:result-in .25s var(--ease) both; }
.row .n { font-size:13px; opacity:.85; flex:1 1 auto; min-width:0; }
.row .a { font-size:18px; font-weight:800; text-align:right; font-variant-numeric:tabular-nums; margin-left:auto; white-space:nowrap; flex:0 0 auto; }
.row .br { flex-basis:100%; height:0; }
.row .t { display:inline-flex; gap:6px; align-items:center; font-size:13px; white-space:nowrap; }
.row .e { font-size:12px; opacity:.8; text-align:right; margin-left:auto; white-space:nowrap; }
.row--sum { justify-content:center; font-weight:700; }
.row--sum .n { flex:none; font-size:14px; opacity:1; }

.st-foot { flex:0 0 auto; padding:8px 16px 6px; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100px; position:relative; z-index:3; }
.btns { display:flex; gap:10px; min-height:48px; }
.st-links { display:flex; gap:var(--s-2); }
.odds { display:inline-flex; align-items:center; justify-content:center; min-height:44px; padding:0 12px; font-size:13px; color:var(--stage-cream); opacity:.75; text-decoration:underline; text-underline-offset:3px; }
.primary { min-width:200px; height:48px; padding:0 28px; border:0; border-radius:24px; background:var(--stage-rose); color:#fff; font-size:17px; font-weight:700; cursor:pointer; box-shadow:0 6px 18px rgba(229,80,110,.35); }
.ghost { height:48px; min-width:200px; padding:0 28px; border-radius:24px; border:1px solid rgba(255,246,230,.4); background:transparent; font-size:15px; cursor:pointer; }
.st-error ~ .st-foot .ghost, .st-error ~ .st-foot .primary { min-width:0; flex:1 1 0; }
.hearts { position:absolute; left:50%; top:30%; width:0; height:0; pointer-events:none; z-index:1; }
.heart { position:absolute; left:0; top:0; width:20px; height:20px; opacity:0; color:var(--stage-rose); will-change:transform, opacity; }
.heart--gold { color:var(--stage-gold); }
:lang(ko) .bubble, :lang(ko) .st-error p { word-break:keep-all; }

/* 依舞台可用高度分段（art.md §16、ui.md §6.2.1） */
@container stage (max-height: 859px) and (min-width: 640px) {
  .mascot-zone { --mascot-h:min(17cqh, 130px); }
}
@container stage (max-height: 759px) {
  .mascot-zone { --mascot-h:min(22cqh, 150px); }
}
@container stage (max-height: 619px) {
  .mascot-zone { --mascot-h:96px; justify-content:flex-start; align-items:center; padding:0 16px; gap:10px; }
  .mascot { flex:0 0 auto; }
  .bubble { position:static; margin:0; flex:1 1 auto; min-width:0; max-width:none; width:auto; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .bubble::after { display:none; }
  .r-exp { margin-top:0; }
  .r-more { display:none; }
  .result-zone { padding-top:2px; gap:4px; }
  .r-top { font-size:13px; } .r-amt { font-size:34px; margin-top:0; }
  .st-foot { min-height:0; }
}
@container stage (max-height: 519px) {
  .mascot-zone { display:none; }
  .reel-zone { --cw:76px; --ch:88px; --gap:4px; --zone-h:calc(var(--ch) + 36px); }
  .st-foot { flex-direction:row; gap:8px; min-height:0; padding:6px 16px; }
  .btns { min-height:44px; }
  .primary, .ghost { height:44px; min-width:160px; }
  .r-amt { font-size:32px; }
}
@container stage (max-height: 519px) and (min-width: 640px) {
  .stage__in { display:grid; grid-template-columns:minmax(240px, 42%) 1fr; grid-template-rows:auto auto auto minmax(0, 1fr) auto; grid-template-areas:"head head" "mascot reel" "mascot title" "mascot result" "mascot foot"; }
  .core { display:contents; }
  .st-head { grid-area:head; }
  .mascot-zone { display:flex; grid-area:mascot; height:auto; align-self:stretch; --mascot-h:min(76cqh, 300px); justify-content:center; align-items:flex-end; padding:0; gap:0; }
  .bubble { position:absolute; top:calc(var(--mascot-h) * .03); left:calc(50% + var(--mascot-h) * .10); flex:none; width:max-content; max-width:min(60cqw, calc(50% - var(--mascot-h) * .10 - 8px)); white-space:normal; overflow:visible; text-wrap:balance; }
  .bubble::after { display:block; }
  .reel-zone { grid-area:reel; }
  .st-title { grid-area:title; }
  .result-zone { grid-area:result; min-height:0; }
  .st-foot { grid-area:foot; }
}
.stage--reduced .cell.t6::before, .stage--reduced .cell .sp { animation:none; }
.stage--reduced .cell .sp { display:none; }
.stage--reduced .result, .stage--reduced .row { animation-duration:.01s; }
</style>
