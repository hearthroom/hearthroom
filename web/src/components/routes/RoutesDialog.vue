<script setup lang="ts">
/**
 * 線路清單：四條固定照編號排（編號跟網域綁定，不按速度重排），各自回來各自更新；
 * 最多一條標「推薦」。選一條、按一個主按鈕就切換（ui.md §5、§6）。
 *
 * 狀態呈現（美術總監 2026-10-22）：列表裡的「連不上」是中性灰，紅色只給錯誤提示框；
 * 切換中主按鈕維持實心可讀，鎖定靠列表變淡；全部連不上時唯一有用的動作是重測，所以它是主按鈕。
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import SignalBars from "./SignalBars.vue";
import RouteSpinner from "./RouteSpinner.vue";
import { useRouteSwitch } from "./use-route-switch";
import { wrapTab } from "@/lib/focus-trap";
import {
  LINES, currentLine, formatLatency, hasUnsavedWork, measureAll, routesState, signalOf, type Line, type LineStatus,
} from "@/lib/routes";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";

const { t } = useI18n();
const session = useSession();
const here = currentLine();
const sw = useRouteSwitch("routes_dialog");

const box = ref<HTMLElement | null>(null);
const selected = ref(routesState.preselect || here?.n || 0);
const live = ref("");
const recheckBusy = ref(false);
const offline = ref(typeof navigator !== "undefined" && navigator.onLine === false);
/** 開啟時頁面上有沒存的東西（編輯卡片之類）：按下之前就先說 */
const unsaved = hasUnsavedWork();

const name = (l: Line | undefined) => (l ? t(`routes.name.${l.n}`) : "");
const status = (l: Line): LineStatus => routesState.results[l.n] ?? { state: "checking" };
const statusText = (l: Line) => {
  const s = status(l);
  return s.state === "ok" ? formatLatency(s.ms) : s.state === "down" ? t("routes.down") : t("routes.checking");
};
const msOf = (l: Line): number | null => { const s = status(l); return s.state === "ok" ? s.ms : null; };
const target = computed(() => LINES.find((l) => l.n === selected.value));
const isCurrent = computed(() => !target.value || target.value.n === here?.n);
const allDown = computed(() => LINES.every((l) => status(l).state === "down"));
const targetState = computed(() => (target.value ? status(target.value).state : "ok"));
/** 選了一條還在檢查或連不上的：主按鈕先停著 */
const blocked = computed(() => !isCurrent.value && targetState.value !== "ok");

const primaryText = computed(() => {
  if (sw.busy.value) return t("routes.switching");
  if (isCurrent.value) return t("routes.done");
  if (sw.withoutLogin.value) return t("routes.switchAnyway");
  return sw.standalone ? t("routes.openInBrowser", { line: name(target.value) }) : t("routes.switchTo", { line: name(target.value) });
});
const stepText = computed(() => sw.phase.value === "carrying" ? t("routes.handoff.carrying") : t("routes.step.connecting", { line: name(target.value) }));
const failureText = computed(() => {
  const args = { line: name(target.value), here: name(here) };
  switch (sw.failure.value) {
    case "target-down": return session.me ? t("routes.error.targetDown", args) : t("routes.error.targetDownGuest", args);
    case "start-unavailable": return t("routes.error.startUnavailable");
    case "start-denied": return t("routes.error.startDenied", args);
    default: return "";
  }
});

function select(l: Line) {
  if (sw.busy.value || (status(l).state === "down" && l.n !== here?.n)) return;
  selected.value = l.n;
  sw.clearFailure();
}

function close() {
  sw.cancel();
  routesState.dialogOpen = false;
  routesState.autoStart = false;
  const opener = routesState.opener;
  routesState.opener = null;
  void nextTick(() => opener?.focus?.());
}
/** 取消：切換中是放棄這次切換（交給瀏覽器之前都有效），否則關掉 */
function cancel() {
  if (sw.busy.value) { sw.cancel(); return; }
  close();
}

function primary() {
  if (sw.busy.value || blocked.value || !target.value) return;
  if (isCurrent.value) { close(); return; }
  void sw.start(target.value);
}

async function recheck() {
  if (recheckBusy.value || sw.busy.value) return;
  recheckBusy.value = true;
  offline.value = navigator.onLine === false;
  sw.clearFailure();
  try { await measureAll(true); } finally { recheckBusy.value = false; }
  if (!allDown.value && !target.value) selected.value = here?.n ?? 0;
  announce();
}

function announce() {
  live.value = allDown.value
    ? t(offline.value ? "routes.offline" : "routes.allDown")
    : LINES.map((l) => `${name(l)} ${statusText(l)}`).join(t("routes.listSeparator"));
}

/** 單選列：方向鍵在列之間移動並選取（跟原生 radio 一樣），Tab 只停在選中那列 */
function onRowKey(e: KeyboardEvent, index: number) {
  const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  for (let k = 1; k <= LINES.length; k++) {
    const next = LINES[(index + step * k + LINES.length * k) % LINES.length]!;
    if (status(next).state === "down" && next.n !== here?.n) continue;
    select(next);
    void nextTick(() => box.value?.querySelector<HTMLElement>(`[data-line="${next.n}"]`)?.focus());
    return;
  }
}
/** 沒有選取時（全部連不上）Tab 停在第一列 */
const tabStop = (l: Line) => (selected.value === l.n || (!target.value && l.n === LINES[0]?.n) ? 0 : -1);

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); cancel(); if (!sw.busy.value) close(); return; }
  wrapTab(e, box.value, "button:not(:disabled), [tabindex='0']");
}

// 全部連不上：不預選任何一列（目前那列仍標「目前」）；回來之後預選目前那條
watch(allDown, (down) => { if (down) selected.value = 0; else if (!target.value) selected.value = here?.n ?? 0; });
// 某一列變成連不上時單獨說一聲；全部回來後再報一次摘要
watch(() => LINES.map((l) => status(l).state === "down"), (now, before) => {
  now.forEach((down, i) => { if (down && before && !before[i]) live.value = `${name(LINES[i])} ${t("routes.down")}`; });
});

onMounted(async () => {
  track("routes_dialog", { detail: "opened", subject: String(here?.n ?? "") });
  await nextTick();
  box.value?.querySelector<HTMLElement>(`[data-line="${selected.value}"]`)?.focus();
  const measuring = measureAll();
  if (routesState.autoStart) {
    routesState.autoStart = false;
    primary();
  }
  await measuring;
  announce();
});
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="cancel(); close()" @keydown="onKey">
      <div ref="box" class="modal panel routes" role="dialog" aria-modal="true" aria-labelledby="routes-title" aria-describedby="routes-lead">
        <div class="routes__head">
          <h2 id="routes-title" class="modal__title">{{ $t("routes.title") }}</h2>
          <button v-if="!allDown" type="button" class="btn btn--ghost btn--sm routes__recheck" :disabled="recheckBusy || sw.busy.value" @click="recheck">
            <RouteSpinner v-if="recheckBusy" />{{ $t("routes.recheck") }}
          </button>
        </div>
        <p id="routes-lead" class="routes__lead" :class="{ 'routes__lead--alert': allDown }">
          {{ allDown ? $t(offline ? "routes.offline" : "routes.allDown") : $t("routes.lead") }}
        </p>
        <p v-if="allDown && !offline" class="routes__lead">{{ $t("routes.allDownHint") }}</p>

        <div class="routes__list" :class="{ 'routes__list--locked': sw.busy.value }" role="radiogroup" aria-labelledby="routes-title">
          <button
            v-for="(l, i) in LINES" :key="l.n" type="button" role="radio" class="routes__row"
            :class="{ 'routes__row--down': status(l).state === 'down' }"
            :data-line="l.n" :aria-checked="selected === l.n" :tabindex="tabStop(l)"
            :aria-disabled="sw.busy.value || (status(l).state === 'down' && l.n !== here?.n) || undefined"
            :aria-label="[name(l), l.host, statusText(l), l.n === here?.n ? $t('routes.current') : '', routesState.recommended === l.n ? $t('routes.recommended') : ''].filter(Boolean).join(', ')"
            @click="select(l)" @keydown="onRowKey($event, i)"
          >
            <span class="routes__radio" aria-hidden="true" />
            <span class="routes__name" aria-hidden="true">
              <span class="routes__line">{{ name(l) }}
                <span v-if="l.n === here?.n" class="chip routes__chip">{{ $t("routes.current") }}</span>
                <span v-if="routesState.recommended === l.n" class="chip routes__chip routes__chip--rec">{{ $t("routes.recommended") }}</span>
              </span>
              <span class="routes__host">{{ l.host }}</span>
            </span>
            <span class="routes__speed" aria-hidden="true">
              <SignalBars :level="signalOf(msOf(l))" :checking="status(l).state === 'checking'" :down="status(l).state === 'down'" />
              <span class="routes__ms">{{ statusText(l) }}</span>
            </span>
          </button>
        </div>

        <p v-if="unsaved && !isCurrent && !sw.busy.value" class="notice routes__notice">{{ $t("routes.unsaved") }}</p>
        <div class="routes__status">
        <p v-if="sw.failure.value" class="notice routes__notice" :class="{ 'notice--error': sw.failure.value !== 'start-unavailable' }" role="alert">{{ failureText }}</p>
        <p v-else-if="sw.busy.value" class="routes__step" role="status">{{ stepText }}<span v-if="sw.slow.value" class="routes__slow">{{ $t("routes.handoff.slow") }}</span></p>
        <p v-else-if="blocked && targetState === 'down'" class="routes__step" role="status">{{ $t("routes.pickWorking") }}</p>
        <p v-else-if="session.me && !isCurrent && !sw.withoutLogin.value && !allDown" class="routes__note">{{ $t("routes.loginNote") }}</p>
        </div>
        <p v-if="sw.standalone" class="routes__note">{{ $t("routes.standaloneNote") }}</p>

        <div class="modal__actions routes__actions">
          <template v-if="allDown">
            <button type="button" class="btn btn--ghost" @click="close">{{ $t("dialog.close") }}</button>
            <button type="button" class="btn btn--primary routes__go" :aria-busy="recheckBusy || undefined" @click="recheck">
              <RouteSpinner v-if="recheckBusy" />{{ $t("routes.recheck") }}
            </button>
          </template>
          <template v-else>
            <button v-if="!isCurrent" type="button" class="btn btn--ghost" @click="cancel">{{ $t("dialog.cancel") }}</button>
            <button type="button" class="btn btn--primary routes__go" :disabled="blocked && !sw.busy.value" :aria-busy="sw.busy.value || undefined" @click="primary">
              <RouteSpinner v-if="sw.busy.value" />{{ primaryText }}
            </button>
          </template>
        </div>
        <p class="sr-only" aria-live="polite">{{ live }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.routes { gap: var(--s-2); }
.routes__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-height: var(--h-sm); }
.routes__recheck { flex: none; gap: 6px; }
.routes__lead { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-2); }
.routes__lead--alert { font-size: 14px; color: var(--text); }
.routes__list { display: grid; margin: var(--s-2) calc(-1 * var(--s-2)); padding: var(--s-1) 0; border-block: 1px solid var(--line); transition: opacity var(--dur) var(--ease); }
.routes__list--locked { opacity: 0.5; }
.routes__row {
  display: flex; align-items: center; gap: var(--s-3); min-height: 56px; width: 100%;
  padding: var(--s-2); border: 0; border-radius: var(--r-md); background: none; color: var(--text);
  font: inherit; text-align: left; cursor: pointer;
  transition: background var(--dur) var(--ease);
}
.routes__row:hover { background: var(--surface-2); }
.routes__row[aria-disabled="true"] { cursor: default; }
.routes__row[aria-disabled="true"]:hover { background: none; }
.routes__radio {
  flex: none; width: 20px; height: 20px; border-radius: var(--r-pill);
  box-shadow: inset 0 0 0 1.75px var(--border-strong);
  transition: box-shadow var(--dur) var(--ease);
}
.routes__row[aria-checked="true"] .routes__radio { box-shadow: inset 0 0 0 1.75px var(--accent-btn), inset 0 0 0 5px var(--surface), inset 0 0 0 10px var(--accent-btn); }
.routes__name { flex: 1; min-width: 0; display: grid; gap: 2px; }
.routes__line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; }
.routes__host { font-size: 12px; color: var(--text-2); overflow-wrap: anywhere; }
/* 標記用現有 chip 的尺寸；它不是按鈕，所以沒有 hover */
.routes__chip { cursor: default; font-weight: 500; }
.routes__chip:hover { color: var(--text-2); background: var(--surface-2); }
.routes__chip--rec, .routes__chip--rec:hover { background: var(--accent-tint); color: var(--accent-text); }
/* 右欄固定兩欄：訊號格永遠在同一條垂直線上，數值欄靠右、等寬數字 */
.routes__speed { flex: none; display: inline-flex; align-items: center; gap: var(--s-2); color: var(--text); font-size: 13px; }
.routes__ms { min-width: 64px; text-align: right; color: var(--text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.routes__row--down .routes__speed, .routes__row--down .routes__ms { color: var(--text-3); }
/* 連不上的列選不了：單選圓換成淡的虛線，一眼看得出不能選（字不降透明，維持對比） */
.routes__row--down[aria-disabled="true"] .routes__radio { box-shadow: none; border: 1.75px dashed var(--line-strong); }
/* 狀態區預留兩行高：切換中多出進度與「需要久一點」時，置中的對話框不往上跳 */
.routes__status { min-height: 40px; display: grid; align-content: start; }
.routes__step, .routes__note { margin: 0; display: grid; gap: 2px; font-size: 13px; line-height: 1.5; color: var(--text-2); }
.routes__note { font-size: 12px; color: var(--text-3); }
.routes__slow { color: var(--text-3); }
.routes__notice { margin: 0; font-size: 13px; }
/* 切換中≠不可按：維持實心可讀，轉圈加鎖寬（全域 aria-busy 會把整顆調淡，這裡蓋回來） */
.routes__go { gap: var(--s-2); min-width: 8em; }
.routes__go[aria-busy="true"] { opacity: 1; }
</style>
