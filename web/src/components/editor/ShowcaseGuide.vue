<script setup lang="ts">
/**
 * 「顯示在哪裡？」（owner 2026-10-11）：一句話簡介、介紹、標籤分別出現在首頁卡片與卡片頁的哪個位置，
 * 以及各自怎麼寫。示意圖用作者正在寫的內容填（名字、簡介、封面、標籤），沒填就用灰條代替，
 * 一眼看出自己的字會落在哪裡、會被截在哪裡。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  name: string;
  summary: string;
  tags: string[];
  cover: string;
  banner: string;
  /** 建議長度（跟編輯器的提醒同一個數） */
  advise: number;
}>();
const emit = defineEmits<{ close: [] }>();

const box = ref<HTMLElement | null>(null);
const shownTags = computed(() => props.tags.slice(0, 3));
let opener: HTMLElement | null = null;

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}
watch(() => props.open, async (now) => {
  if (now) {
    opener = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", onKey);
    await nextTick();
    box.value?.querySelector<HTMLElement>("button")?.focus();
  } else {
    document.removeEventListener("keydown", onKey);
    opener?.focus();
    opener = null;
  }
}, { immediate: true });
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dlg-backdrop" @click.self="emit('close')">
      <div ref="box" class="panel guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <header class="guide__head">
          <h2 id="guide-title" class="guide__title">{{ $t("editor.showcase.guideTitle") }}</h2>
          <button type="button" class="guide__close" :aria-label="$t('dialog.close')" @click="emit('close')">×</button>
        </header>

        <div class="guide__body">
          <div class="guide__shots" aria-hidden="true">
            <!-- 首頁卡片：封面在上，名字、簡介兩行、標籤 -->
            <figure class="shot">
              <figcaption>{{ $t("editor.showcase.tile") }}</figcaption>
              <div class="tile">
                <div class="tile__cover" :style="cover ? { backgroundImage: `url(${cover})` } : undefined" />
                <div class="tile__text">
                  <strong class="tile__name">{{ name || $t("editor.showcase.sampleName") }}</strong>
                  <div class="mark mark--1"><span class="pin">1</span>
                    <p class="tile__summary">{{ summary || $t("editor.showcase.sampleSummary") }}</p>
                  </div>
                  <div class="mark mark--3"><span class="pin">3</span>
                    <span class="chips"><i v-for="t in shownTags" :key="t">{{ t }}</i><template v-if="!shownTags.length"><i /><i /></template></span>
                  </div>
                </div>
              </div>
            </figure>

            <!-- 卡片頁：橫幅、封面＋名字、簡介三行、開始對話；下面左邊介紹、右邊評分 -->
            <figure class="shot shot--page">
              <figcaption>{{ $t("editor.showcase.page") }}</figcaption>
              <div class="cpage">
                <div class="cpage__banner" :style="banner ? { backgroundImage: `url(${banner})` } : undefined" />
                <div class="cpage__hero">
                  <div class="cpage__cover" :style="cover ? { backgroundImage: `url(${cover})` } : undefined" />
                  <div class="cpage__id">
                    <strong class="cpage__name">{{ name || $t("editor.showcase.sampleName") }}</strong>
                    <div class="mark mark--1"><span class="pin">1</span>
                      <p class="cpage__summary">{{ summary || $t("editor.showcase.sampleSummary") }}</p>
                    </div>
                    <span class="cpage__cta">{{ $t("card.play") }}</span>
                    <div class="mark mark--3"><span class="pin">3</span>
                      <span class="chips"><i v-for="t in shownTags" :key="t">{{ t }}</i><template v-if="!shownTags.length"><i /><i /></template></span>
                    </div>
                  </div>
                </div>
                <div class="cpage__body">
                  <div class="mark mark--2 cpage__intro"><span class="pin">2</span>
                    <span class="bar" /><span class="bar bar--short" /><span class="bar" /><span class="bar bar--mid" />
                  </div>
                  <div class="cpage__side"><span class="bar bar--short" /><span class="stars">★★★★★</span></div>
                </div>
              </div>
            </figure>
          </div>

          <ol class="guide__list">
            <li>
              <span class="pin">1</span>
              <div>
                <strong>{{ $t("editor.summary") }}</strong>
                <p>{{ $t("editor.showcase.summaryWhere") }}</p>
                <p class="subtle">{{ $t("editor.showcase.summaryHow", { n: advise }) }}</p>
              </div>
            </li>
            <li>
              <span class="pin">2</span>
              <div>
                <strong>{{ $t("editor.readme") }}</strong>
                <p>{{ $t("editor.showcase.readmeWhere") }}</p>
                <p class="subtle">{{ $t("editor.showcase.readmeHow") }}</p>
              </div>
            </li>
            <li>
              <span class="pin">3</span>
              <div>
                <strong>{{ $t("edit.tags") }}</strong>
                <p>{{ $t("editor.showcase.tagsWhere") }}</p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dlg-backdrop {
  position: fixed; inset: 0; z-index: 105;
  display: grid; place-items: center; padding: var(--s-5);
  background: rgba(16, 16, 24, 0.45);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.guide {
  width: min(760px, 100%); max-height: min(820px, calc(100dvh - 2 * var(--s-5)));
  display: flex; flex-direction: column; overflow: hidden; padding: 0;
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
}
.guide__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); padding: var(--s-4) var(--s-5); box-shadow: 0 1px 0 var(--line); }
.guide__title { font-size: 17px; font-weight: 600; }
.guide__close { width: 32px; height: 32px; border: 0; border-radius: var(--r-pill); background: transparent; color: var(--text-3); font-size: 20px; line-height: 1; cursor: pointer; }
.guide__close:hover { background: var(--surface-2); color: var(--text); }
.guide__body { overflow-y: auto; padding: var(--s-5); display: grid; gap: var(--s-5); }

.guide__shots { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: var(--s-5); align-items: start; }
.shot { margin: 0; display: grid; gap: var(--s-2); min-width: 0; }
.shot figcaption { font-size: 12.5px; font-weight: 600; color: var(--text-2); }

/* 標號：作者在示意圖上找自己的字，跟下面的說明對得上 */
.pin {
  display: inline-grid; place-items: center; flex: none;
  width: 18px; height: 18px; border-radius: var(--r-pill);
  background: var(--accent); color: var(--on-accent); font-size: 11px; font-weight: 700; line-height: 1;
}
.mark { position: relative; border-radius: 6px; box-shadow: 0 0 0 2px var(--accent); padding: 4px 6px; }
.mark > .pin { position: absolute; top: -9px; right: -9px; }

.tile { border-radius: var(--r-md); overflow: hidden; background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
.tile__cover { aspect-ratio: 3 / 4; background: var(--surface-2) center / cover; }
.tile__text { display: grid; gap: 8px; padding: 10px; }
.tile__name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile__summary, .cpage__summary {
  margin: 0; font-size: 11.5px; line-height: 1.5; color: var(--text-2);
  display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere;
}
.tile__summary { -webkit-line-clamp: 2; }
.cpage__summary { -webkit-line-clamp: 3; }
.chips { display: flex; gap: 4px; flex-wrap: wrap; }
.chips i { font-style: normal; font-size: 10px; padding: 1px 6px; border-radius: var(--r-pill); background: var(--surface-2); color: var(--text-2); min-width: 28px; min-height: 14px; }

.cpage { position: relative; border-radius: var(--r-md); overflow: hidden; background: var(--bg); box-shadow: 0 0 0 1px var(--line); }
.cpage__banner { height: 70px; background: var(--surface-2) center 20% / cover; mask-image: linear-gradient(to bottom, #000 50%, transparent); -webkit-mask-image: linear-gradient(to bottom, #000 50%, transparent); }
.cpage__hero { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 12px; padding: 0 12px; margin-top: -36px; position: relative; }
.cpage__cover { aspect-ratio: 3 / 4; border-radius: 6px; background: var(--surface-2) center / cover; box-shadow: 0 0 0 1px var(--line); }
.cpage__id { display: grid; gap: 8px; padding-top: 40px; min-width: 0; }
.cpage__name { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cpage__cta { justify-self: start; padding: 3px 12px; border-radius: var(--r-pill); background: var(--accent-btn); color: var(--on-accent); font-size: 10.5px; font-weight: 600; }
.cpage__body { display: grid; grid-template-columns: minmax(0, 1fr) 70px; gap: 10px; padding: 14px 12px 12px; }
.cpage__intro { display: grid; gap: 6px; padding: 10px; background: var(--surface); }
.cpage__side { display: grid; gap: 6px; align-content: start; padding: 8px; border-radius: 6px; background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
.stars { font-size: 8px; color: var(--gold); letter-spacing: 1px; }
.bar { display: block; height: 6px; border-radius: 3px; background: var(--surface-2); }
.bar--short { width: 45%; }
.bar--mid { width: 70%; }

.guide__list { display: grid; gap: var(--s-4); margin: 0; padding: 0; list-style: none; }
.guide__list li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--s-3); align-items: start; }
.guide__list strong { font-size: 14px; }
.guide__list p { margin: 4px 0 0; font-size: 13.5px; line-height: 1.6; }
.guide__list .pin { margin-top: 1px; }

@media (max-width: 640px) {
  .dlg-backdrop { padding: var(--s-3); }
  .guide__shots { grid-template-columns: 1fr; }
  .shot:first-child .tile { max-width: 180px; }
}
</style>
