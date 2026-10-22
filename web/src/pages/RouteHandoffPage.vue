<script setup lang="ts">
/**
 * 換線路時帶著登入的兩個過場頁（docs/studio/tasks/2026-10-22-web-routes-and-shared-login/backend.md）。
 *
 *   原站 /auth/route/issue#request=…    → 向原站要一次性的換手碼，前往目的站
 *   目的站 /auth/route/complete#code=…  → 兌換成目的站自己的登入，回到原本那一頁
 *
 * 中國網路下每一跳都可能好幾秒，所以第一幀就要有畫面，不是空白頁；單號在 # 後面（不進伺服器
 * 日誌），讀到就先從網址拿掉再送出。兩頁都用 location.replace 往下走，過場頁不留在上一頁裡：
 * 到站後按返回，回到換線之前那一頁。
 *
 * 失敗不自動重試（碼是一次性的）：停在原地講清楚登入有沒有保留，讓人自己選。
 * 原站發碼時順手把「從哪條來、要回哪一頁」接在目的站網址的 # 後面——兌換失敗時伺服器
 * 不會告訴目的站這些，但畫面要給「回到線路一」「直接進入」。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import RouteSpinner from "@/components/routes/RouteSpinner.vue";
import { authRequest } from "@/lib/managed-auth";
import { loginPath, safeReturnTo } from "@/lib/login-return";
import { pageTitle } from "@/lib/i18n";
import {
  ROUTE_TUNING, SwitchError, clearPendingSwitch, currentLine, lineByNumber, pendingSwitch, prepareSwitch, routesState, targetUrl, type Line,
} from "@/lib/routes";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";
import { appNavigationUrl } from "@/lib/route-lines";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { t } = useI18n();
const { lp } = useLocalePath();
const mode = route.meta.handoff === "complete" ? "complete" : "issue";

/** 讀完就從網址拿掉：碼不該留在網址列、歷史紀錄與之後的 referrer 裡 */
const fragment = new URLSearchParams((route.hash || location.hash).replace(/^#/, ""));
const prepareFailed = mode === "complete" && fragment.get("failed") === "1";
const canGoBack = prepareFailed && history.length > 1;
history.replaceState(history.state, "", `${location.pathname}${location.search}`);

const here = currentLine();
const pending = mode === "issue" ? pendingSwitch() : null;
/** 這次要去的線路：原站看出發前記下的，目的站就是自己 */
const target = computed<Line | undefined>(() => (mode === "issue" ? lineByNumber(pending?.target) : here));
/** 目的站：從哪條線路來、原本在哪一頁（原站接在 # 後面帶過來） */
const from = mode === "complete" ? lineByNumber(fragment.get("from")) : here;
/*
 * 「回哪一頁」放在 # 裡要經過一次語言轉址：vue-router 會把 # 解碼再原樣放回，%26 變回 &，
 * 查詢字串就被切斷。所以這一項用 base64url 包起來（只含 [A-Za-z0-9_-]，怎麼解碼都不變）。
 */
const packPath = (path: string) => btoa(String.fromCharCode(...new TextEncoder().encode(path))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function unpackPath(raw: string | null): string | null {
  if (!raw) return null;
  try { return new TextDecoder().decode(Uint8Array.from(atob(raw.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))); }
  catch { return null; }
}
const returnTo = safeReturnTo(mode === "issue" ? pending?.returnTo : unpackPath(fragment.get("to")));

const state = ref<"working" | "failed">("working");
const slow = ref(false);
const busy = ref(false);
/** 原站「重新切換」又失敗了：換掉說明，不留一顆按了沒反應的按鈕 */
const retryError = ref("");
let abandoned = false;
let slowTimer: ReturnType<typeof setTimeout> | undefined;

const lineName = (l: Line | undefined) => (l ? t(`routes.name.${l.n}`) : "");

async function issue() {
  const request = fragment.get("request");
  if (!request || !target.value) throw new Error("route_request_missing");
  const { url } = await authRequest<{ url: string }>("route-issue", { request });
  if (typeof url !== "string" || !url.startsWith(`${target.value.origin}/auth/route/complete#`)) throw new Error("route_target_invalid");
  clearPendingSwitch();
  const extra = new URLSearchParams({ ...(here ? { from: String(here.n) } : {}), to: packPath(returnTo) });
  if (!abandoned) location.replace(appNavigationUrl(`${url}&${extra}`));
}

async function complete() {
  const code = fragment.get("code");
  if (!code) throw new Error("route_code_missing");
  const done = await authRequest<{ ok: boolean; returnTo: string }>("route-redeem", { code });
  if (abandoned) {
    // 等太久按了「直接進入」，兌換卻在之後成功了：登入其實已經帶過來，照新登入恢復，收掉「沒帶過來」的說明
    routesState.arrivedSignedOut = false;
    await session.retryRestore();
    return;
  }
  // 開頁時的恢復登入是在兌換之前跑的（那時還沒有這個網域的登入）；等它結束再照新的登入恢復一次，
  // 回到原頁時頁首直接是登入狀態，不閃一下登入鈕。
  await session.restore();
  await session.retryRestore();
  routesState.arrived = here?.n ?? 0;
  track("routes_handoff", { detail: "arrived", subject: String(here?.n ?? "") });
  await router.replace(safeReturnTo(done.returnTo, returnTo));
}

async function run() {
  state.value = "working"; slow.value = false;
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => { slow.value = true; }, ROUTE_TUNING.slowStepMs);
  try {
    await (mode === "issue" ? issue() : complete());
  } catch {
    if (abandoned) return;
    clearTimeout(slowTimer);
    state.value = "failed";
    document.title = pageTitle(mode === "issue" ? t("routes.handoff.issueFailTitle") : t("routes.handoff.completeFailTitle"));
    track("routes_handoff", { detail: `${mode}_failed`, subject: String(target.value?.n ?? ""), ok: false });
  }
}

/** 原站：整條換手重來（碼是一次性的，不能重送同一張） */
async function retry() {
  if (!target.value || busy.value) return;
  busy.value = true;
  retryError.value = "";
  try {
    const url = await prepareSwitch(target.value, { withLogin: true, loc: parsePath(returnTo) });
    location.replace(url);
  } catch (e) {
    busy.value = false;
    const kind = e instanceof SwitchError ? e.kind : "start-denied";
    const args = { line: lineName(target.value), here: lineName(here) };
    retryError.value = kind === "target-down" ? t("routes.error.targetDown", args) : kind === "start-unavailable" ? t("routes.error.startUnavailable") : t("routes.error.startDenied", args);
  }
}
function switchWithoutLogin() {
  if (!target.value) return;
  clearPendingSwitch();
  location.replace(targetUrl(target.value, parsePath(returnTo)));
}
/** 放棄這次換線，留在（或回到）原本那一頁 */
function stayHere() {
  abandoned = true;
  clearPendingSwitch();
  void router.replace(returnTo);
}
/** 目的站：不帶登入直接進去，頁面頂端說一聲登入沒帶過來 */
function enterSignedOut() {
  abandoned = true;
  routesState.arrivedSignedOut = true;
  void router.replace(returnTo);
}
function backToSource() {
  if (from) location.replace(appNavigationUrl(`${from.origin}${returnTo}`));
}
function backToPrevious() {
  abandoned = true;
  history.back();
}
function signIn() {
  abandoned = true;
  void router.replace(lp(loginPath(returnTo)));
}

function parsePath(path: string): Pick<Location, "pathname" | "search" | "hash"> {
  const u = new URL(path, location.origin);
  return { pathname: u.pathname, search: u.search, hash: u.hash };
}

onMounted(() => {
  document.title = pageTitle(target.value ? t("routes.handoff.going", { line: lineName(target.value) }) : t("routes.handoff.goingAny"));
  void run();
});
onBeforeUnmount(() => { abandoned = true; clearTimeout(slowTimer); });
</script>

<template>
  <div class="handoff">
    <!-- 進行中是品牌頭像，失敗換成站台錯誤頁用的 Q 版狀態圖；兩種圖佔同一個高度的圖區，換版時標題不跳 -->
    <div class="handoff__art" aria-hidden="true">
      <img v-if="state === 'working'" class="handoff__mark" src="/mascot/suki-mark.webp" alt="" width="56" height="56" decoding="async" />
      <img v-else class="handoff__fail" src="/mascot/suki-fail.webp" alt="" width="120" height="120" decoding="async" />
    </div>
    <template v-if="state === 'working'">
      <h1 class="handoff__title">{{ target ? $t("routes.handoff.going", { line: lineName(target) }) : $t("routes.handoff.goingAny") }}</h1>
      <p v-if="target" class="handoff__host">{{ target.host }}</p>
      <p class="handoff__status" role="status"><RouteSpinner />{{ $t("routes.handoff.carrying") }}</p>
      <template v-if="slow">
        <p class="handoff__slow">{{ $t("routes.handoff.slow") }}</p>
        <button v-if="mode === 'issue'" type="button" class="btn btn--ghost btn--sm" @click="stayHere">{{ $t("routes.handoff.cancelBack") }}</button>
        <button v-else type="button" class="btn btn--ghost btn--sm" @click="enterSignedOut">{{ $t("routes.handoff.skipLogin") }}</button>
      </template>
    </template>

    <template v-else-if="mode === 'issue'">
      <h1 class="handoff__title">{{ $t("routes.handoff.issueFailTitle") }}</h1>
      <p class="handoff__body" role="alert">{{ retryError || $t("routes.handoff.issueFailBody", { line: lineName(here) }) }}</p>
      <div class="handoff__actions">
        <template v-if="target">
          <button type="button" class="btn btn--primary" :disabled="busy" :aria-busy="busy || undefined" @click="retry">{{ $t("routes.handoff.retry") }}</button>
          <button type="button" class="btn" :disabled="busy" @click="switchWithoutLogin">{{ $t("routes.handoff.withoutLogin") }}</button>
        </template>
        <button type="button" class="handoff__link" :disabled="busy" @click="stayHere">{{ $t("routes.handoff.backHere") }}</button>
      </div>
    </template>

    <template v-else>
      <h1 class="handoff__title">{{ $t("routes.handoff.completeFailTitle") }}</h1>
      <p class="handoff__body" role="alert">{{ $t("routes.handoff.completeFailBody", { line: lineName(here) }) }}</p>
      <div class="handoff__actions">
        <button type="button" class="btn btn--primary" @click="signIn">{{ $t("nav.login") }}</button>
        <button v-if="from" type="button" class="btn" @click="backToSource">{{ $t("routes.handoff.backTo", { line: lineName(from) }) }}</button>
        <button v-else-if="canGoBack" type="button" class="btn" @click="backToPrevious">{{ $t("share.back") }}</button>
        <button type="button" class="handoff__link" @click="enterSignedOut">{{ $t("routes.handoff.enter") }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 錨在固定上緣（約 28vh）往下長：8 秒後多出來的行與按鈕只往下加，標題不往上跳（美術總監 #8a） */
.handoff {
  min-height: 100vh; min-height: 100dvh;
  padding: max(var(--s-6), calc(28vh - 120px)) var(--s-4) calc(var(--s-6) + env(safe-area-inset-bottom));
  display: flex; flex-direction: column; align-items: center; gap: var(--s-2); text-align: center;
  background: var(--bg);
}
.handoff__art { height: 120px; display: flex; align-items: flex-end; justify-content: center; margin-bottom: var(--s-2); }
.handoff__mark { width: 56px; height: 56px; border-radius: var(--r-pill); }
.handoff__fail { width: 120px; height: 120px; object-fit: contain; }
.handoff__title { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.4; max-width: 22rem; text-wrap: balance; }
.handoff__host { margin: 0; font-size: 13px; color: var(--text-2); }
.handoff__status { margin: var(--s-3) 0 0; display: inline-flex; align-items: center; gap: var(--s-2); font-size: 14px; color: var(--text-2); }
.handoff__slow { margin: 0; font-size: 13px; color: var(--text-3); }
.handoff__body { margin: 0; font-size: 14px; line-height: 1.6; color: var(--text-2); max-width: 22rem; text-wrap: balance; }
/* 按鈕區同寬、最小 280：主（實心）、次（中性）、第三個是文字連結，三種一眼分得出（#8c） */
.handoff__actions { display: grid; gap: var(--s-2); width: min(280px, 100%); margin-top: var(--s-4); }
.handoff__actions .btn { width: 100%; height: var(--h-lg); }
.handoff__link {
  min-height: var(--h-lg); padding: 0 var(--s-3); border: 0; background: none; cursor: pointer;
  font: inherit; font-size: 14px; color: var(--text-2); text-decoration: underline; text-underline-offset: 0.2em;
}
.handoff__link:hover { color: var(--text); }
.handoff__link:disabled { cursor: default; opacity: 0.55; }
</style>
