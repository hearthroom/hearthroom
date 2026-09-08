<script setup lang="ts">
/**
 * 編輯器旁邊的「我的資源」。
 *
 * 作者在寫卡的時候要傳圖、要看還剩多少容量、要把上次傳的那張找出來——先前這些只有
 * 獨立的資源頁做得到，於是寫到一半得離開表單，回來時草稿還在不在要看運氣。
 *
 * 這裡只做「傳進去、看得到、拿得走」：上傳、容量、分組、複製網址。整理（改名資料夾、
 * 批次搬移、刪除）留在資源頁——側欄一格窄成這樣，把管理也塞進來只會兩邊都難用。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  fetchLibraryFolders,
  fetchLibraryImages,
  uploadImage,
  type LibraryFolder,
  type LibraryImage,
  type LibraryScope,
} from "@/lib/api";
import { useSession } from "@/lib/session";

const { t } = useI18n();
const session = useSession();

const PAGE = 40;

const folders = ref<LibraryFolder[]>([]);
const images = ref<LibraryImage[]>([]);
const total = ref(0);
const usedBytes = ref(0);
const byteQuota = ref(0);
const page = ref(1);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const note = ref("");
const scopeKey = ref("all");
const fileInput = ref<HTMLInputElement | null>(null);

const scope = computed<LibraryScope>(() =>
  scopeKey.value === "all" ? { kind: "all" } : scopeKey.value === "unfiled" ? { kind: "unfiled" } : { kind: "folder", folderId: scopeKey.value },
);
const hasMore = computed(() => images.value.length < total.value);
const usedPct = computed(() => (byteQuota.value > 0 ? Math.min(100, (usedBytes.value / byteQuota.value) * 100) : 0));

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

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
    usedBytes.value = res.usedBytes;
    byteQuota.value = res.byteQuota;
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

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  busy.value = true;
  error.value = "";
  note.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error("auth");
    await uploadImage(file, token);
    // 傳完回到「全部」再重讀：新檔還沒歸資料夾，留在某個分組上會看不到自己剛傳的東西
    if (scopeKey.value !== "all") scopeKey.value = "all";
    else await load(true);
    note.value = t("res.panel.uploaded");
  } catch {
    error.value = t("res.panel.uploadFailed");
  } finally {
    busy.value = false;
  }
}

/** 複製網址：作者要把圖寫進正則規則的 HTML 裡（狀態欄、頭像框、背景）。 */
async function copyUrl(image: LibraryImage) {
  try {
    await navigator.clipboard.writeText(image.imageUrl);
    note.value = t("res.panel.copied");
  } catch {
    error.value = t("res.panel.copyFailed");
  }
}

const stateLabel = (image: LibraryImage) =>
  image.moderationState === "pending" ? t("res.state.pending") : image.moderationState === "reject" ? t("res.state.rejected") : "";
</script>

<template>
  <div class="rp">
    <div class="rp__quota">
      <p class="subtle rp__used">
        {{ $t("res.panel.used", { used: mb(usedBytes), quota: mb(byteQuota) }) }}
      </p>
      <div class="rp__bar" role="presentation"><span :style="{ width: usedPct + '%' }" /></div>
    </div>

    <div class="rp__acts">
      <button type="button" class="btn btn--sm btn--primary" :disabled="busy" @click="fileInput?.click()">
        {{ busy ? $t("res.panel.uploading") : $t("res.panel.upload") }}
      </button>
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" @change="onFile" />
    </div>

    <div v-if="folders.length" class="rp__folders">
      <div class="seg" role="tablist" :aria-label="$t('lib.pick.folders')">
        <button type="button" class="seg__item" :class="{ 'seg__item--on': scopeKey === 'all' }" role="tab"
                :aria-selected="scopeKey === 'all'" @click="scopeKey = 'all'">{{ $t("lib.pick.all") }}</button>
        <button type="button" class="seg__item" :class="{ 'seg__item--on': scopeKey === 'unfiled' }" role="tab"
                :aria-selected="scopeKey === 'unfiled'" @click="scopeKey = 'unfiled'">{{ $t("lib.pick.unfiled") }}</button>
        <button v-for="folder in folders" :key="folder.folderId" type="button" class="seg__item"
                :class="{ 'seg__item--on': scopeKey === folder.folderId }" role="tab"
                :aria-selected="scopeKey === folder.folderId" @click="scopeKey = folder.folderId">{{ folder.name }}</button>
      </div>
    </div>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <p v-else-if="note" class="subtle rp__note" role="status">{{ note }}</p>

    <div class="rp__wrap">
      <p v-if="!loading && !images.length" class="subtle rp__empty">{{ $t("lib.pick.empty") }}</p>
      <ul v-else class="wall">
        <li v-for="image in images" :key="image.id" class="tile">
          <img :src="image.imageUrl" alt="" loading="lazy" />
          <span v-if="stateLabel(image)" class="tile__state" :class="{ 'tile__state--bad': image.moderationState === 'reject' }">{{ stateLabel(image) }}</span>
          <button type="button" class="tile__copy" :title="$t('res.panel.copy')" :aria-label="$t('res.panel.copy')"
                  @click="copyUrl(image)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
          </button>
        </li>
      </ul>
      <div v-if="hasMore" class="rp__more">
        <button type="button" class="btn btn--sm" :disabled="loading" @click="more">{{ $t("res.more") }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 同 ChatTestPanel：資料夾列、錯誤、提示都是條件顯示的，照位置指定行會錯位。 */
.rp { display: flex; flex-direction: column; gap: var(--s-2); min-height: 0; }
.rp__quota { display: grid; gap: 4px; }
.rp__used { margin: 0; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.rp__bar { height: 4px; border-radius: var(--r-pill); background: var(--surface-2); overflow: hidden; }
.rp__bar span { display: block; height: 100%; background: var(--accent); }
.rp__acts { display: flex; gap: var(--s-2); }
.rp__folders { overflow-x: auto; }
.rp__note, .rp__empty { margin: 0; }
.rp__wrap { flex: 1; overflow-y: auto; min-height: 0; display: grid; gap: var(--s-3); align-content: start; }
.rp__more { display: flex; justify-content: center; }

.wall { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); }
.tile {
  position: relative; aspect-ratio: 1; overflow: hidden;
  border-radius: var(--r-sm); background: var(--surface-2); box-shadow: 0 0 0 1px var(--line);
}
.tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tile__state {
  position: absolute; top: 4px; left: 4px; padding: 1px 6px; border-radius: var(--r-pill);
  font-size: 10px; background: rgba(20, 20, 28, 0.6); color: #fff;
}
.tile__state--bad { background: var(--danger); }
/* 複製鈕平常淡出去，滑過或聚焦才實體化——一格 84px 裡常駐一顆鈕會蓋掉圖 */
.tile__copy {
  position: absolute; right: 4px; bottom: 4px; width: 24px; height: 24px; padding: 0;
  display: grid; place-items: center; border: 0; border-radius: var(--r-pill);
  background: rgba(20, 20, 28, 0.6); color: #fff; cursor: pointer; opacity: 0;
  transition: opacity var(--dur) var(--ease);
}
.tile:hover .tile__copy, .tile__copy:focus-visible { opacity: 1; }
</style>
