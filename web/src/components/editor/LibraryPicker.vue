<script setup lang="ts">
/**
 * 從「我的資源」挑一張圖。
 *
 * 作者的頭像與背景多半早就傳過一次了——放在資源庫裡，或是被別張卡用著。沒有這條路
 * 的話，換一張卡就要把同一個檔再傳一次，資源庫裡於是躺著十幾份同一張圖，而配額是共用的。
 *
 * 只列圖片：頭像與背景放不了影片、音訊、字型，把它們列出來只是讓人多按一次才發現不能選。
 *
 * Teleport 到 body 的理由跟世界書那個彈窗一樣：這個元件掛在建卡表單的分區裡，那條路徑上
 * 有祖先建立了層疊上下文，position: fixed 會被關在裡面。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  fetchLibraryFolders,
  fetchLibraryImages,
  type LibraryFolder,
  type LibraryImage,
  type LibraryScope,
} from "@/lib/api";
import { useSession } from "@/lib/session";

const emit = defineEmits<{ pick: [string]; close: [] }>();

const { t } = useI18n();
const session = useSession();

const PAGE = 60;

const folders = ref<LibraryFolder[]>([]);
const images = ref<LibraryImage[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref("");
/** "all" / "unfiled" / folderId，跟資源頁的分組鍵同一套。 */
const scopeKey = ref("all");

const scope = computed<LibraryScope>(() =>
  scopeKey.value === "all" ? { kind: "all" } : scopeKey.value === "unfiled" ? { kind: "unfiled" } : { kind: "folder", folderId: scopeKey.value },
);
const hasMore = computed(() => images.value.length < total.value);

async function load(reset: boolean) {
  loading.value = true;
  error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error("auth");
    if (reset) page.value = 1;
    const res = await fetchLibraryImages(scope.value, page.value, PAGE, token, "image");
    images.value = reset || page.value === 1 ? res.items : [...images.value, ...res.items];
    total.value = res.total;
  } catch {
    error.value = t("lib.pick.failed");
  } finally {
    loading.value = false;
  }
}

async function more() {
  page.value += 1;
  await load(false);
}

onMounted(async () => {
  try {
    const token = await session.accessToken();
    if (token) folders.value = await fetchLibraryFolders(token);
  } catch {
    folders.value = [];
  }
  await load(true);
});

watch(scopeKey, () => load(true));

/** 被駁回的圖不給選：這張卡是要公開的，用它等於預約一次退件。 */
const blocked = (image: LibraryImage) => image.moderationState === "reject";
const stateLabel = (image: LibraryImage) =>
  image.moderationState === "pending" ? t("res.state.pending") : blocked(image) ? t("res.state.rejected") : "";

function choose(image: LibraryImage) {
  if (blocked(image)) return;
  emit("pick", image.imageUrl);
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div class="lp" role="dialog" aria-modal="true" :aria-label="$t('lib.pick.title')"
         @keydown.esc="emit('close')">
      <div class="lp__scrim" @click="emit('close')" />
      <div class="lp__panel panel">
        <header class="lp__head">
          <h2>{{ $t("lib.pick.title") }}</h2>
          <span class="subtle">{{ $t("lib.pick.count", { n: total }) }}</span>
          <button type="button" class="btn btn--sm btn--ghost lp__close" @click="emit('close')">{{ $t("dialog.cancel") }}</button>
        </header>

        <div v-if="folders.length" class="lp__folders">
          <div class="seg" role="tablist" :aria-label="$t('lib.pick.folders')">
            <button type="button" class="seg__item" :class="{ 'seg__item--on': scopeKey === 'all' }" role="tab"
                    :aria-selected="scopeKey === 'all'" @click="scopeKey = 'all'">{{ $t("lib.pick.all") }}</button>
            <button type="button" class="seg__item" :class="{ 'seg__item--on': scopeKey === 'unfiled' }" role="tab"
                    :aria-selected="scopeKey === 'unfiled'" @click="scopeKey = 'unfiled'">{{ $t("lib.pick.unfiled") }}</button>
            <button v-for="folder in folders" :key="folder.folderId" type="button" class="seg__item"
                    :class="{ 'seg__item--on': scopeKey === folder.folderId }" role="tab"
                    :aria-selected="scopeKey === folder.folderId" @click="scopeKey = folder.folderId">
              {{ folder.name }}
            </button>
          </div>
        </div>

        <div class="lp__body">
          <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
          <p v-else-if="!loading && !images.length" class="subtle lp__empty">{{ $t("lib.pick.empty") }}</p>

          <ul v-if="images.length" class="wall">
            <li v-for="image in images" :key="image.id" class="tile" :class="{ 'tile--blocked': blocked(image) }">
              <button type="button" class="tile__pick" :disabled="blocked(image)"
                      :aria-label="$t('lib.pick.use')" :title="blocked(image) ? stateLabel(image) : $t('lib.pick.use')"
                      @click="choose(image)">
                <img :src="image.imageUrl" alt="" loading="lazy" />
              </button>
              <span v-if="stateLabel(image)" class="tile__state" :class="{ 'tile__state--bad': blocked(image) }">{{ stateLabel(image) }}</span>
              <span v-if="image.pixelWidth" class="tile__meta subtle">{{ image.pixelWidth }}×{{ image.pixelHeight }}</span>
            </li>
          </ul>

          <div v-if="hasMore" class="lp__more">
            <button type="button" class="btn btn--sm" :disabled="loading" @click="more">{{ $t("res.more") }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lp { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: var(--s-4); }
.lp__scrim { position: absolute; inset: 0; background: rgba(10, 10, 14, 0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.lp__panel {
  position: relative; width: min(1040px, 100%); height: min(86vh, 780px);
  display: grid; grid-template-rows: auto auto minmax(0, 1fr); overflow: hidden;
  box-shadow: var(--shadow-md), 0 0 0 1px var(--line);
}
.lp__head { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) var(--s-4); box-shadow: 0 1px 0 var(--line); }
.lp__head h2 { font-size: 16px; }
.lp__close { margin-left: auto; }
.lp__folders { padding: var(--s-3) var(--s-4) 0; overflow-x: auto; }
.lp__body { padding: var(--s-4); overflow-y: auto; display: grid; gap: var(--s-3); align-content: start; }
.lp__empty { margin: 0; }
.lp__more { display: flex; justify-content: center; }

.wall { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); grid-template-columns: repeat(auto-fill, minmax(clamp(110px, 22vw, 150px), 1fr)); }
.tile {
  position: relative; aspect-ratio: 1; overflow: hidden;
  border-radius: var(--r-md); background: var(--surface-2);
  box-shadow: 0 0 0 1px var(--line);
}
.tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tile__pick { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: none; cursor: pointer; }
.tile__pick:disabled { cursor: not-allowed; }
.tile__pick:hover:not(:disabled) img, .tile__pick:focus-visible img { opacity: 0.75; }
.tile__pick img { transition: opacity var(--dur) var(--ease); }
.tile:hover:not(.tile--blocked) { box-shadow: 0 0 0 2px var(--accent); }
.tile--blocked img { filter: grayscale(1); opacity: 0.45; }
.tile__state {
  position: absolute; top: 8px; left: 8px; padding: 2px 8px; border-radius: var(--r-pill);
  font-size: 11px; background: rgba(20, 20, 28, 0.6); color: #fff;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.tile__state--bad { background: var(--danger); }
/* 尺寸壓在圖上，而作者的圖什麼底色都有——只靠 text-shadow 在淺色圖上讀不出來
   （實測：淺綠與米黃兩張圖上幾乎看不見）。給它跟狀態標籤同一片底。 */
.tile__meta {
  position: absolute; left: 8px; bottom: 8px; padding: 2px 8px; border-radius: var(--r-pill);
  font-size: 11px; color: #fff; background: rgba(20, 20, 28, 0.6);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 720px) {
  .lp { padding: 0; }
  .lp__panel { width: 100%; height: 100%; border-radius: 0; }
}
</style>
