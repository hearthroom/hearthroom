<script setup lang="ts">
/**
 * 分享一條連結。
 *
 * 桌面的系統分享面板給的是「隔空投送／備忘錄／提醒事項」這類本機去處，沒有一個能把連結交給朋友，
 * 所以這裡自己開一張面板。手機的系統面板裡確實有聊天軟體，而且是微信、QQ、Discord 這些
 * 沒有網頁分享入口的唯一去處——但那是一條額外的路（「更多」），不是取代這張面板：
 * 同一個按鈕在哪裡按都長一樣，兩端的分享數據也才對得上。
 *
 * 排序照玩家所在的地方（owner 2026-10-11：主要是港澳台與大中華區）：Discord、QQ、微信、LINE、Telegram、Reddit。
 * Discord、QQ、微信沒有網頁分享入口：按下去先把連結複製好，Discord 接著開它的網頁版，
 * QQ 說一聲貼過去就好，微信在桌面上給一張 QR Code 讓手機掃。複製連結放在最後，照樣覆蓋其他去處。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { confirmDialog } from "@/lib/confirm";
import { track } from "@/lib/track";

const props = defineProps<{
  /** 要分享出去的網址（絕對路徑）。 */
  url: string;
  /** 分享出去的標題，通常是卡名。 */
  title: string;
  /** 埋點用的對象（roleId）：分享去了哪、哪張卡被分享，要能對得起來。 */
  subject?: string;
}>();

const { t } = useI18n();
const open = ref(false);
/** 面板往上開：按鈕落在視窗下半部時，往下開會掉出畫面外 */
const up = ref(false);
/** 那一邊能給的高度。上下都不夠時挑大的那邊，面板自己捲——寧可捲，也不要有一條看不到也按不到的項目 */
const maxH = ref(0);
/** 往右挪回畫面裡的距離：面板靠按鈕右緣對齊，按鈕離左邊太近時這樣會把它推出畫面外 */
const shift = ref(0);
const copied = ref(false);
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
let resetCopied: ReturnType<typeof setTimeout> | undefined;

/**
 * 分享的去處，照順序排。
 *   link  有網頁分享入口：一段固定格式的網址帶上連結（LINE 的入口只吃網址，附加文字早就不生效了）。
 *   open  沒有分享入口、但有網頁版（Discord）：先複製連結，再開它的網頁版，貼進頻道或私訊。
 *   paste 沒有網頁版可開（QQ）：複製連結，說一聲貼過去就好。
 *   qr    微信：桌面上給 QR Code 讓手機掃；手機上跟 paste 一樣。
 */
type Target = { id: string; name: string; brand: string; brandDark: string; path: string } & (
  | { kind: "link"; href: (u: string, text: string) => string }
  | { kind: "open"; href: () => string }
  | { kind: "paste" }
  | { kind: "qr" }
);
const TARGETS: Target[] = [
  { id: "discord", name: "Discord", kind: "open", brand: "#5865F2", brandDark: "#7983F5", href: () => "https://discord.com/app", path: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" },
  { id: "qq", name: "QQ", kind: "paste", brand: "#1EBAFC", brandDark: "#1EBAFC", path: "M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673" },
  { id: "wechat", name: "WeChat", kind: "qr", brand: "#07C160", brandDark: "#07C160", path: "M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z" },
  { id: "line", name: "LINE", kind: "link", brand: "#00C300", brandDark: "#06C755", href: (u: string) => `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(u)}`, path: "M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" },
  { id: "telegram", name: "Telegram", kind: "link", brand: "#26A5E4", brandDark: "#26A5E4", href: (u: string, text: string) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(text)}`, path: "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" },
  { id: "reddit", name: "Reddit", kind: "link", brand: "#FF4500", brandDark: "#FF4500", href: (u: string, text: string) => `https://www.reddit.com/submit?url=${encodeURIComponent(u)}&title=${encodeURIComponent(text)}`, path: "M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z" },
];

/** 系統分享面板：手機上直接交給聊天軟體。桌面沒有這條。 */
const handheld = typeof navigator !== "undefined"
  && navigator.maxTouchPoints > 0
  && typeof matchMedia === "function"
  && matchMedia("(pointer: coarse)").matches;
const hasSystemShare = handheld && typeof navigator !== "undefined" && typeof navigator.share === "function";

function shareText() {
  return t("share.text", { name: props.title });
}
function hrefFor(target: Target): string | undefined {
  if (target.kind === "link") return target.href(props.url, shareText());
  if (target.kind === "open") return target.href();
  return undefined;
}
/** 微信在畫面上叫「微信」／WeChat，照介面語言 */
function nameOf(target: Target) {
  return target.id === "wechat" ? t("share.wechat") : target.name;
}
/** 哪一個去處剛複製好連結：那一列換成「已複製」的說明 */
const pasted = ref("");
/** 微信的 QR Code（桌面）：面板換成這一頁 */
const qr = ref<{ size: number; path: string } | null>(null);
let resetPasted: ReturnType<typeof setTimeout> | undefined;

/** 沒有分享入口的去處：先把連結放進剪貼簿。拿不到剪貼簿就走跟「複製連結」一樣的退路 */
async function pickTarget(target: Target, e: MouseEvent) {
  if (target.kind === "link") { go(target.id); return; }
  if (target.kind === "qr" && !handheld) {
    e.preventDefault();
    track("share", { detail: `share_${target.id}`, subject: props.subject });
    const { default: make } = await import("qrcode-generator");
    const code = make(0, "M");
    code.addData(props.url);
    code.make();
    const n = code.getModuleCount();
    let path = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (code.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    qr.value = { size: n, path };
    void nextTick(place);
    return;
  }
  // open：連結照常在新分頁打開，同一下點擊裡先寫剪貼簿（瀏覽器只在使用者手勢裡給寫）
  if (target.kind !== "open") e.preventDefault();
  try {
    await navigator.clipboard.writeText(props.url);
  } catch {
    track("share", { detail: "share_manual", subject: props.subject, ok: false });
    close();
    await confirmDialog({ title: t("card.share"), message: t("card.copyLink"), detail: props.url, single: true });
    return;
  }
  track("share", { detail: `share_${target.id}`, subject: props.subject });
  pasted.value = target.id;
  clearTimeout(resetPasted);
  resetPasted = setTimeout(() => { pasted.value = ""; close(); }, target.kind === "open" ? 1200 : 2400);
}

function toggle() {
  open.value = !open.value;
  if (!open.value) return;
  place();
  void nextTick(() => {
    place();
    // 面板可能在捲動：焦點給第一項之後把它拉回最上面，不然一開就從半途開始
    panel.value?.querySelector<HTMLElement>("button, a")?.focus({ preventScroll: true });
    if (panel.value) panel.value.scrollTop = 0;
  });
}
/**
 * 挑一邊放面板。第一次在面板還沒畫出來時跑（先用一個估的高度，避免看到它先往下再跳上去），
 * 面板畫出來之後用真實內容高度再跑一次。
 */
function place() {
  const box = root.value?.getBoundingClientRect();
  if (!box) return;
  const el = panel.value;
  const wanted = el ? el.scrollHeight : 232;
  // 頁首是浮在內容上的：往上開要讓開它，不然面板最上面那幾條會躲到頁首後面
  const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 0;
  const below = innerHeight - box.bottom - 12;
  const above = box.top - headerH - 12;
  up.value = below < wanted && above > below;
  // 不留人為下限：兩邊都很擠的時候寧可面板變矮自己捲，也不要長到頁首或視窗外面去
  maxH.value = Math.max(0, up.value ? above : below);
  // 卡片頁的側欄貼著畫面左邊：面板右緣對齊按鈕時，左緣會探出畫面。差多少就往右挪多少。
  const panelW = el ? el.offsetWidth : 216;
  shift.value = Math.max(0, 12 - (box.right - panelW));
}

function close(focusBack = false) {
  open.value = false;
  qr.value = null;
  pasted.value = "";
  if (focusBack) root.value?.querySelector<HTMLElement>("button")?.focus();
}

function go(id: string) {
  track("share", { detail: `share_${id}`, subject: props.subject });
  close();
}

// 拿不到剪貼簿（非安全來源、使用者擋掉）：把網址攤在面前讓人自己選，總比按了沒反應好。
// 這條分支的出現頻率就是「分享按鈕在多少環境下是壞的」，值得單獨記一個值。
async function copy() {
  try {
    await navigator.clipboard.writeText(props.url);
    track("share", { detail: "share_clipboard", subject: props.subject });
    copied.value = true;
    clearTimeout(resetCopied);
    resetCopied = setTimeout(() => { copied.value = false; close(); }, 1200);
  } catch {
    track("share", { detail: "share_manual", subject: props.subject, ok: false });
    close();
    await confirmDialog({ title: t("card.share"), message: t("card.copyLink"), detail: props.url, single: true });
  }
}

async function systemShare() {
  close();
  try {
    await navigator.share({ title: props.title, url: props.url });
    track("share", { detail: "share_web", subject: props.subject });
  } catch (e) {
    // 使用者在系統面板上按了取消：什麼都不做，不要再彈第二層東西出來
    track("share", { detail: (e as DOMException).name === "AbortError" ? "share_abort" : "share_failed", subject: props.subject, ok: false });
  }
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) close();
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) close(true);
}
onMounted(() => { document.addEventListener("click", onDocClick); document.addEventListener("keydown", onKey); });
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onKey);
  clearTimeout(resetCopied);
  clearTimeout(resetPasted);
});
</script>

<template>
  <div ref="root" class="sh">
    <button type="button" class="btn btn--lg btn--icon sh__btn" :aria-label="$t('card.share')" :title="$t('card.share')" :aria-expanded="open" @click="toggle">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 12.5V3.5M6.5 7 10 3.5 13.5 7M4 11v4.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <!-- 非模態：Tab 走得出去、點外面就收，不裝成對話框 -->
    <div v-if="open" ref="panel" class="sh__panel panel" :class="{ 'sh__panel--up': up }" :style="{ '--sh-max': maxH + 'px', '--sh-shift': shift + 'px' }" role="group" :aria-label="$t('card.share')">
      <!-- 微信（桌面）：手機掃這張 QR Code 打開連結，再從微信裡分享 -->
      <div v-if="qr" class="sh__qr">
        <svg :viewBox="`-2 -2 ${qr.size + 4} ${qr.size + 4}`" role="img" :aria-label="$t('share.wechatQr')" shape-rendering="crispEdges">
          <rect x="-2" y="-2" :width="qr.size + 4" :height="qr.size + 4" fill="#fff" />
          <path :d="qr.path" fill="#000" />
        </svg>
        <p>{{ $t("share.wechatHint") }}</p>
        <button type="button" class="btn btn--sm" @click="qr = null">{{ $t("share.back") }}</button>
      </div>
      <template v-else>
        <a
          v-for="target in TARGETS"
          :key="target.id"
          class="sh__item"
          :class="{ 'is-done': pasted === target.id }"
          :href="hrefFor(target) ?? '#'"
          :target="hrefFor(target) ? '_blank' : undefined"
          :rel="hrefFor(target) ? 'noopener noreferrer' : undefined"
          :role="hrefFor(target) ? undefined : 'button'"
          :style="{ '--brand': target.brand, '--brand-dark': target.brandDark }"
          @click="pickTarget(target, $event)"
        >
          <span class="sh__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path :d="target.path" fill="currentColor" /></svg></span>
          <span class="sh__name">{{ pasted === target.id ? (target.kind === "open" ? $t("card.copied") : $t("share.pasteTo", { name: nameOf(target) })) : nameOf(target) }}</span>
          <svg v-if="hrefFor(target)" class="sh__out" viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4h8v8M16 4l-8.5 8.5M14 12v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </a>

        <hr class="sh__rule" />

        <button type="button" class="sh__item" :class="{ 'is-done': copied }" @click="copy">
          <span class="sh__icon" aria-hidden="true">
            <svg v-if="copied" viewBox="0 0 24 24"><path d="M5 12.5 9.5 17 19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <svg v-else viewBox="0 0 24 24"><path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1 1M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </span>
          <span class="sh__name">{{ copied ? $t("card.copied") : $t("share.copyLink") }}</span>
        </button>

      <!-- 手機才有：系統面板直接交給聊天軟體 -->
      <template v-if="hasSystemShare">
        <hr class="sh__rule" />
        <button type="button" class="sh__item" @click="systemShare">
          <span class="sh__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.9" fill="currentColor" /><circle cx="12" cy="12" r="1.9" fill="currentColor" /><circle cx="19" cy="12" r="1.9" fill="currentColor" /></svg>
          </span>
          <span class="sh__name">{{ $t("share.more") }}</span>
        </button>
      </template>
      </template>
    </div>

    <!-- 複製成功只改了按鈕上的字，讀屏器不會自己唸；這一條常駐、靠內容變動播報 -->
    <p class="sr-only" role="status">{{ copied ? $t("card.copied") : "" }}</p>
  </div>
</template>

<style scoped>
.sh { position: relative; flex: none; }
.sh__btn { width: var(--h-lg); }
.sh__btn svg { width: 18px; height: 18px; }

.sh__panel {
  position: absolute; top: calc(100% + 8px); right: calc(0px - var(--sh-shift, 0px)); z-index: 40;
  transform-origin: top right;
  width: 216px; padding: 6px;
  max-height: var(--sh-max, none); overflow-y: auto; overscroll-behavior: contain;
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
  animation: pop var(--dur) var(--ease);
}

.sh__panel--up { top: auto; bottom: calc(100% + 8px); transform-origin: bottom right; animation-name: pop-up; }

.sh__item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 8px 10px;
  background: transparent; border: 0; border-radius: var(--r-sm);
  font: inherit; font-size: 14px; color: var(--text-2); text-align: left; text-decoration: none;
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.sh__item:hover, .sh__item:focus-visible { background: var(--surface-2); color: var(--text); }
/* 品牌色只在滑過時亮一下：一排靜止的彩色圖示會壓過卡片本身 */
.sh__item:hover .sh__icon, .sh__item:focus-visible .sh__icon { color: var(--brand, inherit); }
.sh__item.is-done { color: var(--success); }

.sh__icon { display: inline-flex; flex: none; width: 18px; height: 18px; transition: color var(--dur) var(--ease); }
.sh__icon svg { width: 100%; height: 100%; }
.sh__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 「會開新分頁」要先說：按下去才發現跳走是最惹人的一種驚嚇 */
.sh__out { width: 13px; height: 13px; flex: none; color: var(--text-3); opacity: 0; transition: opacity var(--dur) var(--ease); }
.sh__item:hover .sh__out, .sh__item:focus-visible .sh__out { opacity: 1; }

.sh__qr { display: grid; justify-items: center; gap: var(--s-2); padding: var(--s-2); text-align: center; }
.sh__qr svg { width: 168px; height: 168px; border-radius: var(--r-sm); }
.sh__qr p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-2); }

.sh__rule { height: 1px; margin: 5px 8px; background: var(--line); border: 0; }

@keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes pop-up { from { opacity: 0; transform: translateY(4px) scale(0.98); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .sh__panel { animation: none; } }

/* 深色底下純黑的 X 看不見：換成它在深色上的那一版 */
:root[data-mode="dark"] .sh__item:hover .sh__icon,
:root[data-mode="dark"] .sh__item:focus-visible .sh__icon { color: var(--brand-dark, inherit); }

/*
 * 觸控：項目放大到拇指按得到，面板本身照樣錨在按鈕上。
 * 不要改成貼著螢幕底的 fixed——外層有動畫用的 transform，fixed 會以它為準而不是視窗，
 * 面板會停在半空中。錨在按鈕上不吃這個虧。
 */
@media (max-width: 480px) {
  .sh__panel { width: min(260px, calc(100vw - 32px)); padding: 8px; }
  .sh__item { padding: 12px; font-size: 15px; }
  .sh__out { opacity: 1; }
}
</style>
