<script setup lang="ts">
/**
 * 分享一條連結。
 *
 * 桌面的系統分享面板給的是「隔空投送／備忘錄／提醒事項」這類本機去處，沒有一個能把連結交給朋友，
 * 所以這裡自己開一張面板。手機的系統面板裡確實有聊天軟體，而且是微信、QQ、Discord 這些
 * 沒有網頁分享入口的唯一去處——但那是一條額外的路（「更多」），不是取代這張面板：
 * 同一個按鈕在哪裡按都長一樣，兩端的分享數據也才對得上。
 *
 * 複製連結排第一：它覆蓋所有沒有網頁入口的去處，也是回報裡最常被用的動作。
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
const copied = ref(false);
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
let resetCopied: ReturnType<typeof setTimeout> | undefined;

/**
 * 有網頁分享入口的去處。每一條就是一段固定格式的網址，帶上連結和一句話。
 * 微信、QQ、Discord 不在這裡——它們沒有網頁入口，任何做法都只能靠「複製連結」或手機的系統面板。
 * LINE 的入口只吃網址，附加文字早就不生效了，所以它沒有 text。
 */
const TARGETS = [
  {
    id: "x",
    name: "X",
    brand: "#000000",
    brandDark: "#ffffff",
    href: (u: string, text: string) => `https://x.com/intent/post?url=${encodeURIComponent(u)}&text=${encodeURIComponent(text)}`,
    path: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  },
  {
    id: "telegram",
    name: "Telegram",
    brand: "#26A5E4",
    brandDark: "#26A5E4",
    href: (u: string, text: string) => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(text)}`,
    path: "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  },
  {
    id: "reddit",
    name: "Reddit",
    brand: "#FF4500",
    brandDark: "#FF4500",
    href: (u: string, text: string) => `https://www.reddit.com/submit?url=${encodeURIComponent(u)}&title=${encodeURIComponent(text)}`,
    path: "M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z",
  },
  {
    id: "line",
    name: "LINE",
    brand: "#00C300",
    brandDark: "#06C755",
    href: (u: string) => `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(u)}`,
    path: "M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314",
  },
] as const;

/** 系統分享面板：手機上通往微信、QQ、Discord 這些沒有網頁入口的去處。桌面沒有這條。 */
const handheld = typeof navigator !== "undefined"
  && navigator.maxTouchPoints > 0
  && typeof matchMedia === "function"
  && matchMedia("(pointer: coarse)").matches;
const hasSystemShare = handheld && typeof navigator !== "undefined" && typeof navigator.share === "function";

function shareText() {
  return t("share.text", { name: props.title });
}
function hrefFor(target: (typeof TARGETS)[number]) {
  return target.href(props.url, shareText());
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
}

function close(focusBack = false) {
  open.value = false;
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
    <div v-if="open" ref="panel" class="sh__panel panel" :class="{ 'sh__panel--up': up }" :style="{ '--sh-max': maxH + 'px' }" role="group" :aria-label="$t('card.share')">
      <button type="button" class="sh__item" :class="{ 'is-done': copied }" @click="copy">
        <span class="sh__icon" aria-hidden="true">
          <svg v-if="copied" viewBox="0 0 24 24"><path d="M5 12.5 9.5 17 19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <svg v-else viewBox="0 0 24 24"><path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1 1M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </span>
        <span class="sh__name">{{ copied ? $t("card.copied") : $t("share.copyLink") }}</span>
      </button>

      <hr class="sh__rule" />

      <a
        v-for="target in TARGETS"
        :key="target.id"
        class="sh__item"
        :href="hrefFor(target)"
        target="_blank"
        rel="noopener noreferrer"
        :style="{ '--brand': target.brand, '--brand-dark': target.brandDark }"
        @click="go(target.id)"
      >
        <span class="sh__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path :d="target.path" fill="currentColor" /></svg></span>
        <span class="sh__name">{{ target.name }}</span>
        <svg class="sh__out" viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4h8v8M16 4l-8.5 8.5M14 12v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </a>

      <!-- 手機才有：系統面板裡才找得到微信、QQ、Discord 這些沒有網頁入口的去處 -->
      <template v-if="hasSystemShare">
        <hr class="sh__rule" />
        <button type="button" class="sh__item" @click="systemShare">
          <span class="sh__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.9" fill="currentColor" /><circle cx="12" cy="12" r="1.9" fill="currentColor" /><circle cx="19" cy="12" r="1.9" fill="currentColor" /></svg>
          </span>
          <span class="sh__name">{{ $t("share.more") }}</span>
        </button>
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
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 40;
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
