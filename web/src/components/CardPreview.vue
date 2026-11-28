<script setup lang="ts">
/*
 * 卡片預覽：不離開列表，快速看「這張卡有多豐富」（ui.md「預覽抽屜」）。只放數據；作者說明留在卡片頁，
 * 看完想玩就按「進入卡片」去卡片頁（不直接開聊）。
 * 手機是底部面板（最高 84%），桌機是 480 寬的浮層，貼在被點的磚旁邊（右半邊的磚貼左側）。
 * 關閉：遮罩、關閉鈕、Esc；焦點進浮層，關掉後回到那顆預覽鈕；列表捲動位置不動。
 * 整個站只掛一個（App 層），由 lib/card-preview 的狀態打開。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import CardQualityData from "./CardQualityData.vue";
import { cardPreview, closeCardPreview, loadCardQuality } from "@/lib/card-preview";
import { cardStill, cardThumb } from "@/lib/card-thumb";
import { displayName } from "@/lib/display-name";
import { hueFrom } from "@/lib/format";
import { wrapTab } from "@/lib/focus-trap";
import { useLocalePath } from "@/lib/use-locale";
import type { CardQualityDetail } from "../../../shared/card-quality";

const { lp, locale } = useLocalePath();
const { t } = useI18n();
const route = useRoute();

const target = computed(() => cardPreview.value);
const card = computed(() => target.value?.card ?? null);
const name = computed(() => (card.value ? displayName(card.value.name, locale.value) : ""));
const href = computed(() => (card.value ? lp(`/cards/${card.value.num ?? card.value.id}`) : ""));
const hue = computed(() => hueFrom(card.value?.name ?? ""));
const thumbFailed = ref(false);
const thumb = computed(() => {
  const url = card.value?.avatarUrl;
  if (!url || thumbFailed.value) return "";
  return target.value?.concealed ? cardStill(url) : cardThumb(url);
});

const detail = ref<CardQualityDetail | null>(null);
const loading = ref(false);
const failed = ref(false);
let ticket = 0;
async function load() {
  const id = card.value?.id;
  if (!id) return;
  const mine = ++ticket;
  loading.value = true; failed.value = false; detail.value = null;
  try {
    const got = await loadCardQuality(String(id));
    if (mine === ticket) detail.value = got;
  } catch {
    if (mine === ticket) failed.value = true;
  } finally {
    if (mine === ticket) loading.value = false;
  }
}

/* 桌機的浮層位置：跟著被點的磚，用文件座標（捲動時跟著磚走，不會停在半空中） */
const PHONE = "(max-width: 760px)";
const phone = ref(typeof matchMedia === "function" ? matchMedia(PHONE).matches : false);
const place = ref<{ left: number; top: number } | null>(null);
const POP_W = 480;
const GAP = 12;
function position() {
  const opener = target.value?.opener;
  const tile = opener?.closest<HTMLElement>(".card") ?? opener;
  if (phone.value || !tile) { place.value = null; return; }
  const r = tile.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const right = r.left + r.width / 2 < vw / 2;
  let left = right ? r.right + GAP : r.left - GAP - POP_W;
  left = Math.max(GAP, Math.min(left, vw - POP_W - GAP));
  // 上緣對齊被點的磚，但整個浮層要留在視窗裡（磚在畫面下半時往上挪，不壓到頁首）
  const height = box.value?.getBoundingClientRect().height ?? 0;
  const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 60;
  const top = Math.max(header + GAP, Math.min(r.top, innerHeight - height - GAP));
  place.value = { left: left + window.scrollX, top: top + window.scrollY };
}
const popStyle = computed(() => (place.value ? { left: `${place.value.left}px`, top: `${place.value.top}px` } : undefined));

const box = ref<HTMLElement | null>(null);
const closer = ref<HTMLButtonElement | null>(null);
function close() { closeCardPreview(); }
function onKey(e: KeyboardEvent) {
  if (!target.value) return;
  if (e.key === "Escape") { e.preventDefault(); close(); return; }
  wrapTab(e, box.value, "a[href], button:not(:disabled)");
}
let media: MediaQueryList | undefined;
const onMedia = () => { phone.value = !!media?.matches; position(); };
onMounted(() => {
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", position);
  if (typeof matchMedia === "function") { media = matchMedia(PHONE); media.addEventListener?.("change", onMedia); }
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", position);
  media?.removeEventListener?.("change", onMedia);
});

watch(target, async (now, before) => {
  if (before && before.opener !== now?.opener) {
    // 關掉（或換一張）：焦點回到原本那顆鈕，列表不捲動
    before.opener.focus({ preventScroll: true });
  }
  if (!now) { ticket++; return; }
  thumbFailed.value = false;
  position();
  void load();
  await nextTick();
  position();
  closer.value?.focus({ preventScroll: true });
});
// 換頁（例如按了「進入卡片」）就收起來
watch(() => route.fullPath, () => { if (target.value) closeCardPreview(); });
</script>

<template>
  <Teleport to="body">
    <template v-if="card">
      <div class="cpv-scrim" :class="{ 'cpv-scrim--soft': !phone }" aria-hidden="true" @click="close" />
      <section
        ref="box"
        class="cpv"
        :class="phone ? 'cpv--sheet' : 'cpv--pop'"
        :style="popStyle"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cpv-title"
      >
        <span v-if="phone" class="cpv__grab" aria-hidden="true" />
        <header class="cpv__head">
          <div class="cpv__cover" :class="{ 'cpv__cover--concealed': target?.concealed && thumb }">
            <img v-if="thumb" :src="thumb" alt="" @error="thumbFailed = true" />
            <span
              v-else
              class="cpv__void"
              :style="{ background: `linear-gradient(160deg, hsl(${hue} 45% 78%), hsl(${(hue + 40) % 360} 40% 62%))` }"
            >{{ [...name][0] ?? "?" }}</span>
          </div>
          <div class="cpv__title">
            <h2 id="cpv-title" class="cpv__name">{{ name }}</h2>
            <p class="cpv__by">{{ card.author.name }}</p>
          </div>
          <button ref="closer" type="button" class="btn btn--icon btn--ghost cpv__close" :aria-label="t('quality.close')" @click="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div class="cpv__scroll">
          <CardQualityData :detail="detail" :loading="loading" :failed="failed" @retry="load" />
        </div>
        <footer class="cpv__foot">
          <RouterLink :to="href" class="btn btn--primary btn--lg cpv__enter">{{ t("quality.enter") }}</RouterLink>
        </footer>
      </section>
    </template>
  </Teleport>
</template>

<style scoped>
/* 手機：一般彈層的遮罩；桌機：12% 淡遮罩，被點的磚還看得見（磚自己畫強調色外框） */
.cpv-scrim { position: fixed; inset: 0; z-index: 100; background: var(--modal-scrim); animation: fade var(--dur) var(--ease); }
.cpv-scrim--soft { background: rgba(16, 16, 24, 0.12); }
.cpv {
  z-index: 101; display: flex; flex-direction: column; min-height: 0;
  background: var(--surface); box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
}
.cpv--pop {
  position: absolute; width: 480px; max-height: min(640px, calc(100dvh - var(--header-h) - var(--s-5)));
  border-radius: var(--r-lg); animation: fade var(--dur) var(--ease);
}
.cpv--sheet {
  position: fixed; left: 0; right: 0; bottom: 0; max-height: 84dvh;
  border-radius: 24px 24px 0 0; animation: cpv-up var(--dur-slow) var(--ease);
}
@keyframes cpv-up { from { transform: translateY(24px); opacity: 0.4; } to { transform: none; opacity: 1; } }
.cpv__grab { flex: none; width: 36px; height: 4px; margin: var(--s-2) auto 0; border-radius: var(--r-pill); background: var(--line-strong); }

.cpv__head { flex: none; display: flex; align-items: flex-start; gap: var(--s-3); padding: var(--s-3) var(--s-4) 0; }
.cpv__cover { position: relative; flex: none; width: 56px; height: 75px; border-radius: var(--r-sm); overflow: hidden; background: var(--surface-2); }
.cpv__cover img { width: 100%; height: 100%; object-fit: cover; }
.cpv__cover--concealed img { filter: blur(7px); transform: scale(1.2); }
.cpv__void { display: grid; place-items: center; width: 100%; height: 100%; font-size: 22px; font-weight: 600; color: rgba(255, 255, 255, 0.9); }
.cpv__title { flex: 1; min-width: 0; }
.cpv__name {
  margin: 0; font-size: 18px; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.cpv__by { margin: 4px 0 0; font-size: 13px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cpv__close { flex: none; }
.cpv__close svg { width: 16px; height: 16px; }

.cpv__scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: var(--s-4); }
.cpv__foot { flex: none; display: flex; padding: var(--s-3) var(--s-4); box-shadow: 0 -1px 0 var(--line); }
.cpv--sheet .cpv__foot { padding-bottom: calc(var(--s-3) + env(safe-area-inset-bottom, 0px)); }
.cpv__enter { flex: 1; }
</style>
