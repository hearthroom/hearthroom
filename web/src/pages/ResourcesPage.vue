<script setup lang="ts">
/**
 * 我的資源：作者的素材圖庫。
 *
 * 作者來這裡是為了拿網址——上傳一張圖，把公開網址貼進正則規則的 HTML（狀態欄、頭像框、
 * 背景）。所以每張圖第一順位的動作是「複製網址」，不是看大圖。
 *
 * 資料住在上游的素材庫：資料夾、列表、刪除全是上游的事，本站只是介面。一個檔可以同時在
 * 好幾個資料夾裡（上游的資料夾是標籤，不是目錄），刪資料夾不會刪檔。四種檔（圖片／影片／音訊／字型）
 * 住同一個庫，用種類籤分；帳號總容量 500 MB、四種共用、沒有單檔上限，只算 2026-09 之後上傳的檔（存量圖沒記體積）。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  ApiError,
  addImagesToFolder,
  createLibraryFolder,
  deleteLibraryFolder,
  deleteLibraryImages,
  fetchLibraryFolders,
  fetchLibraryImages,
  removeImagesFromFolder,
  renameLibraryFolder,
  uploadImage,
  type LibraryFolder,
  type LibraryImage,
  type LibraryKind,
  type LibraryScope,
} from "@/lib/api";
import { confirmDialog } from "@/lib/confirm";
import { pageTitle } from "@/lib/i18n";
import { useSession } from "@/lib/session";

const session = useSession();
const { t } = useI18n();

const PAGE = 48;
const KINDS = ["all", "image", "video", "audio", "font"] as const;
type KindKey = (typeof KINDS)[number];
/** 種類籤。上傳時的檔案挑選器也照它收窄。 */
const kind = ref<KindKey>("all");
const ACCEPT: Record<KindKey, string> = {
  all: "image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg,.woff2,.woff,.ttf,.otf",
  image: "image/png,image/jpeg,image/webp",
  video: "video/mp4,video/webm",
  audio: "audio/mpeg,audio/wav,audio/ogg",
  font: ".woff2,.woff,.ttf,.otf",
};
const folders = ref<LibraryFolder[]>([]);
const images = ref<LibraryImage[]>([]);
const total = ref(0);
const quota = ref(0);
const usedBytes = ref(0);
const byteQuota = ref(0);
const page = ref(1);
const loading = ref(true);
const error = ref("");
/** 現在看的是哪一組：全部、未歸檔、某個資料夾（存 folderId）。 */
const scopeKey = ref<string>("all");
const scope = computed<LibraryScope>(() =>
  scopeKey.value === "all" ? { kind: "all" } : scopeKey.value === "unfiled" ? { kind: "unfiled" } : { kind: "folder", folderId: scopeKey.value },
);
const activeFolder = computed(() => folders.value.find((f) => f.folderId === scopeKey.value) ?? null);

/** 上游的穩定錯誤碼對應到說得出口的話；其餘沿用通用訊息。 */
const CODE_MESSAGE: Record<string, string> = {
  image_in_use: "res.error.inUse",
  quota_image_exceeded: "res.error.quota",
  quota_bytes_exceeded: "res.error.quotaBytes",
  file_too_large: "res.error.tooLarge",
  invalid_file_type: "res.error.type",
  duplicate_name: "res.error.duplicateName",
  folder_limit: "res.error.folderLimit",
};
function describe(err: unknown, fallback: string): string {
  if (err instanceof ApiError && CODE_MESSAGE[err.code]) return t(CODE_MESSAGE[err.code]);
  return err instanceof Error ? err.message : t(fallback);
}

async function token(): Promise<string> {
  const value = await session.accessToken();
  if (!value) throw new Error(t("auth.expired"));
  return value;
}

async function loadFolders() {
  folders.value = await fetchLibraryFolders(await token());
}

async function loadImages(reset = false) {
  if (reset) {
    page.value = 1;
    images.value = [];
  }
  loading.value = true;
  error.value = "";
  try {
    const res = await fetchLibraryImages(scope.value, page.value, PAGE, await token(), kind.value);
    images.value = reset || page.value === 1 ? res.items : [...images.value, ...res.items];
    total.value = res.total;
    if (res.quota) quota.value = res.quota;
    usedBytes.value = res.usedBytes;
    if (res.byteQuota) byteQuota.value = res.byteQuota;
  } catch (err) {
    error.value = describe(err, "state.loadFailed");
  } finally {
    loading.value = false;
  }
}
const hasMore = computed(() => images.value.length < total.value);
async function more() {
  page.value += 1;
  await loadImages();
}

/** 全部重抓：資料夾的張數與列表一起更新。 */
async function refresh() {
  await Promise.all([loadFolders().catch(() => {}), loadImages(true)]);
}

/** 容量條照位元組；上游每次列表都回帳號的總已用，跟看哪一組無關。 */
const usedRatio = computed(() => (byteQuota.value ? Math.min(1, usedBytes.value / byteQuota.value) : 0));
/** 12.3 MB 這種寫法：小於 1 MB 用 KB，小數只留到看得出差別。 */
function fileSize(bytes: number): string {
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(bytes >= 100 << 20 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

onMounted(async () => {
  document.title = pageTitle(t("res.title"));
  await refresh();
});
watch([scopeKey, kind], () => { selected.value = new Set(); void loadImages(true); });

// ── 上傳 ──────────────────────────────────────────────────────────

const fileInput = ref<HTMLInputElement | null>(null);
/** 進度：第幾張／共幾張。0 代表沒在傳。 */
const uploading = ref({ done: 0, count: 0 });
async function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  if (!files.length) return;
  uploading.value = { done: 0, count: files.length };
  error.value = "";
  const failed: string[] = [];
  try {
    const bearer = await token();
    // 傳進正在看的那個資料夾；看「全部」或「未歸檔」就不歸檔
    const folderIds = scope.value.kind === "folder" ? [scope.value.folderId] : [];
    for (const file of files) {
      try {
        await uploadImage(file, bearer, undefined, folderIds);
      } catch (err) {
        failed.push(`${file.name}：${describe(err, "state.uploadFailed")}`);
      }
      uploading.value = { ...uploading.value, done: uploading.value.done + 1 };
    }
  } finally {
    uploading.value = { done: 0, count: 0 };
  }
  if (failed.length) error.value = failed.join("\n");
  else flash(t("res.uploaded", { n: files.length }));
  await refresh();
}

// ── 選取與管理 ───────────────────────────────────────────────────

const managing = ref(false);
const selected = ref(new Set<number>());
function toggleSelect(image: LibraryImage) {
  const next = new Set(selected.value);
  if (next.has(image.id)) next.delete(image.id);
  else next.add(image.id);
  selected.value = next;
}
function endManage() {
  managing.value = false;
  selected.value = new Set();
}
const busy = ref(false);

async function removeSelected() {
  const ids = [...selected.value];
  if (!ids.length) return;
  if (!(await confirmDialog({ message: t("res.deleteConfirm", { n: ids.length }), confirmText: t("dialog.delete"), danger: true }))) return;
  busy.value = true;
  error.value = "";
  try {
    await deleteLibraryImages(ids, await token());
    flash(t("res.deleted", { n: ids.length }));
    endManage();
    await refresh();
  } catch (err) {
    error.value = describe(err, "state.actionFailed");
  } finally {
    busy.value = false;
  }
}

/** 搬去哪個資料夾：用一個 select，不另開彈窗。 */
const moveTarget = ref("");
async function moveSelected() {
  const ids = [...selected.value];
  const target = moveTarget.value;
  if (!ids.length || !target) return;
  busy.value = true;
  error.value = "";
  try {
    const bearer = await token();
    await addImagesToFolder(target, ids, bearer);
    // 從某個資料夾搬走：同時從原資料夾拿掉，不然一張圖會同時在兩邊
    if (scope.value.kind === "folder" && scope.value.folderId !== target) await removeImagesFromFolder(scope.value.folderId, ids, bearer);
    moveTarget.value = "";
    flash(t("res.moved", { n: ids.length }));
    endManage();
    await refresh();
  } catch (err) {
    error.value = describe(err, "state.actionFailed");
  } finally {
    busy.value = false;
  }
}

async function unfileSelected() {
  const ids = [...selected.value];
  if (!ids.length || scope.value.kind !== "folder") return;
  busy.value = true;
  error.value = "";
  try {
    await removeImagesFromFolder(scope.value.folderId, ids, await token());
    endManage();
    await refresh();
  } catch (err) {
    error.value = describe(err, "state.actionFailed");
  } finally {
    busy.value = false;
  }
}

// ── 資料夾 ───────────────────────────────────────────────────────

/** 新建或改名時露出來的那一格輸入框。null＝收著；"" ＝新建；folderId＝改名。 */
const editingFolder = ref<string | null>(null);
const folderName = ref("");
const folderInput = ref<HTMLInputElement | null>(null);
function startFolder(folderId: string) {
  editingFolder.value = folderId;
  folderName.value = folderId ? (folders.value.find((f) => f.folderId === folderId)?.name ?? "") : "";
  requestAnimationFrame(() => folderInput.value?.focus());
}
async function commitFolder() {
  const name = folderName.value.trim();
  const id = editingFolder.value;
  if (id === null) return;
  if (!name) {
    editingFolder.value = null;
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const bearer = await token();
    if (id) await renameLibraryFolder(id, name, bearer);
    else {
      const created = await createLibraryFolder(name, bearer);
      if (created.folderId) scopeKey.value = created.folderId;
    }
    editingFolder.value = null;
    await loadFolders();
  } catch (err) {
    error.value = describe(err, "state.actionFailed");
  } finally {
    busy.value = false;
  }
}
async function removeFolder(folder: LibraryFolder) {
  if (!(await confirmDialog({ message: t("res.folder.deleteConfirm", { name: folder.name }), confirmText: t("dialog.delete"), danger: true }))) return;
  busy.value = true;
  error.value = "";
  try {
    await deleteLibraryFolder(folder.folderId, await token());
    if (scopeKey.value === folder.folderId) scopeKey.value = "all";
    await refresh();
  } catch (err) {
    error.value = describe(err, "state.actionFailed");
  } finally {
    busy.value = false;
  }
}

// ── 單張圖的動作 ─────────────────────────────────────────────────

const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function flash(message: string) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2400);
}

async function copyLink(image: LibraryImage) {
  try {
    await navigator.clipboard.writeText(image.imageUrl);
    flash(t("res.copied"));
  } catch {
    // 沒有剪貼簿權限（iframe、舊瀏覽器）：把網址露在列表上方讓作者自己選來複製，不開原生彈窗
    copyFallback.value = image.imageUrl;
  }
}
const copyFallback = ref("");

/**
 * 字型的預覽：把檔載成 FontFace，圖塊用它排一行字。載不進來（多半是 CORS 沒開）就退回圖示。
 * 名字用 id 避免同名互蓋；只載一次，切籤回來不重載。
 */
const fontFaces = ref<Record<number, "ready" | "failed">>({});
const fontFamily = (image: LibraryImage) => `lib-font-${image.id}`;
async function loadFont(image: LibraryImage) {
  if (image.kind !== "font" || fontFaces.value[image.id] || typeof FontFace === "undefined") return;
  try {
    const face = new FontFace(fontFamily(image), `url(${image.imageUrl})`);
    await face.load();
    document.fonts.add(face);
    fontFaces.value = { ...fontFaces.value, [image.id]: "ready" };
  } catch {
    fontFaces.value = { ...fontFaces.value, [image.id]: "failed" };
  }
}
watch(images, (list) => { for (const image of list) void loadFont(image); });

/** 檔名尾巴當標籤：網址最後一段的副檔名，沒有就用種類。 */
const extOf = (image: LibraryImage) => (image.imageUrl.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)?.[1] ?? image.kind).toUpperCase();

const stateLabel = (image: LibraryImage) =>
  image.moderationState === "pending" ? t("res.state.pending") : image.moderationState === "reject" ? t("res.state.rejected") : "";
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1 class="head__title display">{{ $t("res.title") }}</h1>
      </div>
      <div class="head__acts">
        <button type="button" class="btn" :disabled="loading || busy" @click="refresh">{{ $t("res.refresh") }}</button>
        <button type="button" class="btn btn--primary" :disabled="uploading.count > 0" @click="fileInput?.click()">
          <template v-if="uploading.count">{{ $t("res.uploading", { done: uploading.done, count: uploading.count }) }}</template>
          <template v-else>{{ $t("res.add") }}</template>
        </button>
        <input ref="fileInput" type="file" :accept="ACCEPT[kind]" multiple class="sr-only" @change="onPick" />
      </div>
    </header>

    <!-- 配額：帳號總容量，位元組 -->
    <section class="quota panel" :aria-label="$t('res.quota.label')">
      <p class="eyebrow">{{ $t("res.quota.label") }}</p>
      <p class="quota__num">
        <strong>{{ fileSize(usedBytes) }}</strong>
        <span v-if="byteQuota" class="subtle"> / {{ fileSize(byteQuota) }}</span>
      </p>
      <div class="quota__bar" role="progressbar" :aria-valuenow="usedBytes" aria-valuemin="0" :aria-valuemax="byteQuota || undefined">
        <span :style="{ width: `${usedRatio * 100}%` }" />
      </div>
    </section>

    <!-- 種類籤：全部／圖片／影片／音訊／字型 -->
    <div class="seg kinds" role="tablist">
      <button v-for="k in KINDS" :key="k" type="button" class="seg__item" :class="{ 'seg__item--on': kind === k }" role="tab"
              :aria-selected="kind === k" @click="kind = k">
        {{ $t(`res.kind.${k}`) }}
      </button>
    </div>

    <!-- 資料夾：一排膠囊，最後一顆是新建 -->
    <section class="folders">
      <div class="seg folders__seg" role="tablist">
        <button type="button" class="seg__item" :class="{ 'seg__item--on': scopeKey === 'all' }" role="tab" :aria-selected="scopeKey === 'all'" @click="scopeKey = 'all'">
          {{ $t("res.scope.all") }}
        </button>
        <button type="button" class="seg__item" :class="{ 'seg__item--on': scopeKey === 'unfiled' }" role="tab" :aria-selected="scopeKey === 'unfiled'" @click="scopeKey = 'unfiled'">
          {{ $t("res.scope.unfiled") }}
        </button>
        <button v-for="folder in folders" :key="folder.folderId" type="button" class="seg__item" :class="{ 'seg__item--on': scopeKey === folder.folderId }"
                role="tab" :aria-selected="scopeKey === folder.folderId" @click="scopeKey = folder.folderId">
          {{ folder.name }} <span class="seg__n">{{ folder.imageCount }}</span>
        </button>
      </div>
      <div class="folders__acts">
        <form v-if="editingFolder !== null" class="folders__edit" @submit.prevent="commitFolder">
          <input ref="folderInput" v-model="folderName" class="input" maxlength="60" :placeholder="$t('res.folder.placeholder')"
                 :aria-label="editingFolder ? $t('res.folder.rename') : $t('res.folder.new')" @keydown.esc="editingFolder = null" />
          <button type="submit" class="btn btn--sm btn--primary" :disabled="busy">{{ $t("dialog.confirm") }}</button>
          <button type="button" class="btn btn--sm btn--ghost" @click="editingFolder = null">{{ $t("dialog.cancel") }}</button>
        </form>
        <template v-else>
          <button type="button" class="btn btn--sm" @click="startFolder('')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            {{ $t("res.folder.new") }}
          </button>
          <template v-if="activeFolder">
            <button type="button" class="btn btn--sm btn--ghost" @click="startFolder(activeFolder.folderId)">{{ $t("res.folder.rename") }}</button>
            <button type="button" class="btn btn--sm btn--ghost btn--danger" @click="removeFolder(activeFolder)">{{ $t("res.folder.delete") }}</button>
          </template>
        </template>
      </div>
    </section>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <div v-if="copyFallback" class="notice copy" role="status">
      <span>{{ $t("res.copyManual") }}</span>
      <input class="input" readonly :value="copyFallback" @focus="($event.target as HTMLInputElement).select()" />
      <button type="button" class="btn btn--sm btn--ghost" @click="copyFallback = ''">{{ $t("dialog.cancel") }}</button>
    </div>

    <!-- 列表標題列：張數、管理模式 -->
    <div class="bar">
      <p class="subtle">{{ $t("res.count", { n: total }) }}</p>
      <div class="bar__acts">
        <template v-if="managing">
          <span class="subtle">{{ $t("res.selected", { n: selected.size }) }}</span>
          <select v-model="moveTarget" class="input input--move" :aria-label="$t('res.moveTo')" :disabled="!selected.size || busy" @change="moveSelected">
            <option value="" disabled>{{ $t("res.moveTo") }}</option>
            <option v-for="folder in folders.filter((f) => f.folderId !== scopeKey)" :key="folder.folderId" :value="folder.folderId">{{ folder.name }}</option>
          </select>
          <button v-if="scope.kind === 'folder'" type="button" class="btn btn--sm" :disabled="!selected.size || busy" @click="unfileSelected">{{ $t("res.unfile") }}</button>
          <button type="button" class="btn btn--sm btn--danger" :disabled="!selected.size || busy" @click="removeSelected">{{ $t("dialog.delete") }}</button>
          <button type="button" class="btn btn--sm btn--ghost" @click="endManage">{{ $t("res.done") }}</button>
        </template>
        <button v-else type="button" class="btn btn--sm btn--ghost" :disabled="!images.length" @click="managing = true">{{ $t("res.manage") }}</button>
      </div>
    </div>

    <div v-if="loading && !images.length" class="wall" aria-hidden="true">
      <div v-for="i in 12" :key="i" class="ghost ghost--tile" />
    </div>

    <div v-else-if="!images.length" class="empty panel">
      <p class="empty__title">{{ $t("res.empty") }}</p>
      <button type="button" class="btn btn--primary" @click="fileInput?.click()">{{ $t("res.add") }}</button>
    </div>

    <ul v-else class="wall" :class="{ 'wall--manage': managing }">
      <li v-for="image in images" :key="image.id" class="tile" :class="{ 'tile--on': selected.has(image.id) }">
        <!-- 管理模式整張是勾選；平常是動作浮層 -->
        <button v-if="managing" type="button" class="tile__pick" :aria-pressed="selected.has(image.id)" @click="toggleSelect(image)">
          <img v-if="image.kind === 'image'" :src="image.imageUrl" alt="" loading="lazy" />
          <span v-else class="tile__file" :data-kind="image.kind"><span class="tile__ext">{{ extOf(image) }}</span></span>
          <span class="tile__check" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
          </span>
        </button>
        <template v-else>
          <img v-if="image.kind === 'image'" :src="image.imageUrl" alt="" loading="lazy" />
          <!-- 影片：靜音、只載第一格當縮圖；滑進來才播 -->
          <video v-else-if="image.kind === 'video'" :src="image.imageUrl" muted playsinline preload="metadata" loop
                 @mouseenter="($event.target as HTMLVideoElement).play().catch(() => {})" @mouseleave="($event.target as HTMLVideoElement).pause()" />
          <!-- 字型：載得進來就用它排一行字，載不進來（CORS）退回副檔名 -->
          <span v-else-if="image.kind === 'font' && fontFaces[image.id] === 'ready'" class="tile__file tile__file--font" :style="{ fontFamily: fontFamily(image) }">{{ $t("res.fontSample") }}</span>
          <span v-else class="tile__file" :data-kind="image.kind">
            <svg v-if="image.kind === 'audio'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V6l11-2v12" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
            <span class="tile__ext">{{ extOf(image) }}</span>
          </span>
          <div class="tile__acts">
            <button type="button" class="btn btn--sm tile__copy" @click="copyLink(image)">{{ $t("res.copy") }}</button>
            <a :href="image.imageUrl" target="_blank" rel="noopener" class="btn btn--sm btn--icon" :aria-label="$t('res.open')" :title="$t('res.open')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 13v6H5V6h6" /></svg>
            </a>
          </div>
        </template>
        <span v-if="stateLabel(image)" class="tile__state" :class="{ 'tile__state--bad': image.moderationState === 'reject' }">{{ stateLabel(image) }}</span>
        <span class="tile__meta subtle">{{ image.kind === "image" && image.pixelWidth ? `${image.pixelWidth}×${image.pixelHeight}` : fileSize(image.byteSize) }}</span>
      </li>
    </ul>

    <div v-if="hasMore" class="pager">
      <button type="button" class="btn" :disabled="loading" @click="more">{{ $t("res.more") }}</button>
    </div>

    <div class="toast" role="status" :hidden="!toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.head { display: flex; flex-wrap: wrap; gap: var(--s-4); align-items: center; justify-content: space-between; margin-bottom: var(--s-4); }
.head__title { font-size: clamp(20px, 2.6vw, 24px); margin-bottom: 2px; }
.head__acts { display: flex; gap: var(--s-2); }

.quota { padding: var(--s-4); display: grid; gap: 6px; margin-bottom: var(--s-4); }
.quota .eyebrow { margin: 0; }
.quota__num { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.2; }
.quota__num .subtle { font-size: 13px; font-weight: 500; }
.quota__bar { height: 6px; border-radius: var(--r-pill); background: var(--surface-2); overflow: hidden; }
.quota__bar span { display: block; height: 100%; border-radius: inherit; background: var(--accent-grad); transition: width var(--dur-slow) var(--ease); }

.folders { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between; margin-bottom: var(--s-4); }
.folders__seg { flex-wrap: wrap; max-width: 100%; }
.seg__n { margin-left: 4px; font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.seg__item--on .seg__n { color: var(--text-2); }
.folders__acts { display: flex; gap: var(--s-2); align-items: center; flex-wrap: wrap; }
.folders__edit { display: flex; gap: var(--s-2); align-items: center; }
.folders__edit .input { width: 200px; height: var(--h-sm); }

.bar { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between; margin-bottom: var(--s-3); }
.bar__acts { display: flex; gap: var(--s-2); align-items: center; flex-wrap: wrap; }
.input--move { width: auto; height: var(--h-sm); font-size: 13px; }

.wall { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); grid-template-columns: repeat(auto-fill, minmax(clamp(120px, 28vw, 168px), 1fr)); }
.ghost--tile { aspect-ratio: 1; }

.tile {
  position: relative; aspect-ratio: 1; overflow: hidden;
  border-radius: var(--r-md); background: var(--surface-2);
  box-shadow: 0 0 0 1px var(--line);
}
.tile img, .tile video { width: 100%; height: 100%; object-fit: cover; display: block; }
/* 非圖片的檔：置中的圖示或副檔名，底色照種類微微不同，一眼分得出影片、音訊、字型 */
.tile__file { display: grid; place-items: center; gap: 6px; width: 100%; height: 100%; color: var(--text-2); }
.tile__file svg { width: 32px; height: 32px; }
.tile__file[data-kind="video"] { background: color-mix(in srgb, var(--accent) 8%, var(--surface-2)); }
.tile__file[data-kind="audio"] { background: color-mix(in srgb, var(--ambient-3) 60%, var(--surface-2)); }
.tile__file--font { font-size: 26px; line-height: 1.2; color: var(--text); padding: 8px; text-align: center; }
.tile__ext { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; }
.kinds { margin-bottom: var(--s-4); }
.tile__pick { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: none; cursor: pointer; }
/* 勾選框永遠在：管理模式下作者要一眼看出哪些已選 */
.tile__check {
  position: absolute; top: 8px; right: 8px; width: 22px; height: 22px;
  display: grid; place-items: center; border-radius: var(--r-pill);
  background: rgba(20, 20, 28, 0.55); color: transparent;
  box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.tile__check svg { width: 13px; height: 13px; }
.tile--on .tile__check { background: var(--accent-btn); color: #fff; box-shadow: none; }
.tile--on::after { content: ""; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 2px var(--accent); pointer-events: none; }
/* 動作浮層：滑進來才出現；鍵盤走到按鈕也要出現 */
.tile__acts {
  position: absolute; inset: auto 0 0 0; display: flex; gap: 6px; justify-content: center; padding: 8px;
  background: linear-gradient(to top, rgba(10, 10, 16, 0.6), transparent);
  opacity: 0; transition: opacity var(--dur) var(--ease);
}
.tile:hover .tile__acts, .tile:focus-within .tile__acts { opacity: 1; }
@media (hover: none) { .tile__acts { opacity: 1; } }
.tile__state {
  position: absolute; top: 8px; left: 8px; padding: 2px 8px; border-radius: var(--r-pill);
  font-size: 11px; font-weight: 600; color: #fff; background: rgba(20, 20, 28, 0.6);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.tile__state--bad { background: var(--danger); }
.tile__meta {
  position: absolute; top: 8px; right: 8px; font-size: 11px; color: #fff; opacity: 0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); transition: opacity var(--dur) var(--ease);
}
.tile:hover .tile__meta { opacity: 1; }
.wall--manage .tile__meta { display: none; }

.empty { padding: var(--s-8) var(--s-5); text-align: center; display: grid; gap: var(--s-4); justify-items: center; }
.empty__title { font-size: 16px; font-weight: 600; }
.notice { white-space: pre-line; margin-bottom: var(--s-3); }
.copy { display: flex; gap: var(--s-2); align-items: center; }
.copy .input { flex: 1; height: var(--h-sm); }

@media (max-width: 640px) {
  .head__acts { width: 100%; }
  .head__acts .btn { flex: 1; }
}
</style>
