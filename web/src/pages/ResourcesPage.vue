<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useSession } from "@/lib/session";
import { accountToken, connectAccount } from "@/lib/connections";
import { PROVIDERS, providerName, type ProviderId } from "@/lib/provider";
import {
  resourceClient,
  type Resource,
  type ResourceId,
  type ResourcePage,
  type Folder,
  type Capabilities,
} from "@/lib/resource-client";
import { ApiError } from "@/lib/api";
import { buildFolderTree, findByFolderId, findNode, flattenTree, relativeName, type FolderNode } from "@/lib/resource-tree";
import { confirmDialog } from "@/lib/confirm";
import { pageTitle } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import ResourcePreview from "@/components/ResourcePreview.vue";
import ResourceSelect from "@/components/ResourceSelect.vue";
import AccountIcon from "@/components/AccountIcon.vue";
const { lp } = useLocalePath();
const session = useSession(),
  route = useRoute(),
  router = useRouter(),
  { t, locale } = useI18n();
const providers = computed(() =>
  [...PROVIDERS]
    .sort((a, b) => Number(b.id === "harbor") - Number(a.id === "harbor"))
    .filter((p) =>
      session.profile?.identities.some((i) => i.provider === p.id),
    ),
);
const provider = ref<ProviderId | "">("");
const detailsOpen = ref(false);
const ready = ref(false),
  loading = ref(false),
  busy = ref(false),
  expired = ref(false);
const result = ref<ResourcePage | null>(null),
  folders = ref<Folder[]>([]),
  error = ref(""),
  folderError = ref(""),
  notice = ref(""),
  copyFallback = ref("");
const page = ref(1),
  pageSize = ref(48),
  kind = ref("all"),
  // 範圍：root（資料夾＋未歸檔的檔案，預設）、all（所有檔案平鋪）、某個夾的 id、或 dir:<路徑>
  //（伺服器上沒有這個夾、只有它底下的子夾時用來往下走）。
  scope = ref("root"),
  search = ref(""),
  searchDraft = ref(""),
  sort = ref("newest");
const selected = ref(new Set<ResourceId>()),
  managing = ref(false),
  moveTarget = ref("");
const items = computed(() => result.value?.items ?? []),
  total = computed(() => result.value?.total ?? 0),
  pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const pageNumbers = computed(() =>
  [...new Set([1, page.value - 1, page.value, page.value + 1, pages.value])]
    .filter((n) => n > 0 && n <= pages.value)
    .sort((a, b) => a - b),
);
const capabilities = ref<Capabilities | null>(null);
const formatGroups = computed(() =>
  ["image", "video", "audio", "font"]
    .map((kind) => ({
      kind,
      formats: [
        ...new Set(
          (capabilities.value?.formats ?? [])
            .filter((f) => f.startsWith(kind + "/"))
            .map(
              (f) =>
                ({
                  "image/jpeg": "JPG",
                  "image/png": "PNG",
                  "image/gif": "GIF",
                  "image/webp": "WebP",
                  "video/mp4": "MP4",
                  "video/webm": "WebM",
                  "audio/mpeg": "MP3",
                  "audio/wav": "WAV",
                  "audio/ogg": "OGG",
                  "font/woff": "WOFF",
                  "font/woff2": "WOFF2",
                  "font/ttf": "TTF",
                  "font/otf": "OTF",
                })[f] ??
                f.split("/")[1]?.toUpperCase() ??
                f,
            ),
        ),
      ],
    }))
    .filter((group) => group.formats.length),
);
const libraryPrefix = computed(() => result.value?.libraryPrefix ? result.value.libraryPrefix.replace(/\/+$/, "") + "/" : "");
const cap = computed(() => capabilities.value),
  activeFolder = computed(() =>
    folders.value.find((f) => f.folderId === scope.value),
  );
const DIR = "dir:";
const tree = computed(() => buildFolderTree(folders.value));
const activeNode = computed<FolderNode | undefined>(() =>
  scope.value === "root" || scope.value === "all"
    ? tree.value
    : scope.value.startsWith(DIR)
      ? findNode(tree.value, scope.value.slice(DIR.length))
      : findByFolderId(tree.value, scope.value),
);
const currentPath = computed(() => activeNode.value?.path ?? "");
// 搜尋跨整個資源庫（像物件儲存的前綴搜尋），結果平鋪、顯示完整路徑，不再分資料夾。
const childNodes = computed(() => (scope.value === "all" || search.value ? [] : (activeNode.value?.children ?? [])));
const when = (v?: string) => (v ? new Date(v).toLocaleDateString(locale.value) : "");
const crumbs = computed(() =>
  currentPath.value
    ? currentPath.value.split("/").map((name, i, parts) => ({ name, path: parts.slice(0, i + 1).join("/") }))
    : [],
);
const folderRows = computed(() => flattenTree(tree.value));
const scopeOf = (n: FolderNode) => n.folderId ?? DIR + n.path;
const isVirtual = computed(() => scope.value.startsWith(DIR));
// 像物件儲存那樣，一個只以路徑存在的夾只列它的子夾；裡面的檔案都屬於某個子夾，進去才看。
const filesHidden = computed(() => isVirtual.value && !search.value);
function enter(target: string) {
  scope.value = target;
  void filter();
}
const quotaFull = computed(
  () =>
    result.value?.byteQuota != null &&
    result.value.usedBytes != null &&
    result.value.usedBytes >= result.value.byteQuota,
);
const quotaRatio = computed(() =>
  result.value?.byteQuota && result.value.usedBytes != null
    ? Math.min(100, (result.value.usedBytes / result.value.byteQuota) * 100)
    : 0,
);
const choiceKey = computed(
  () =>
    `hearthroom.resources.${session.profile?.identities
      .map((i) => i.provider + ":" + i.externalId)
      .sort()
      .join("|")}`,
);
const size = (v: number | null | undefined) =>
  v == null
    ? t("resource.unknown")
    : v >= 1048576
      ? `${(v / 1048576).toFixed(1)} MB`
      : v >= 1024
        ? `${(v / 1024).toFixed(1)} KB`
        : `${v} B`;
const name = (r: Resource) =>
  relativeName(
    r.fileName || r.imageUrl.split("/").pop()?.split("?")[0] || t("resource.unnamed"),
    scope.value === "all" || search.value ? "" : currentPath.value,
  );
const message = (e: unknown) =>
  e instanceof Error ? e.message : t("state.loadFailed");
const thumbnailErrors = ref(new Set<ResourceId>());
let generation = 0,
  disposed = false;
function query(targetPage = page.value) {
  // 虛擬的夾在伺服器上沒有 id：列它底下所有檔案（以路徑前綴搜尋），讓作者看得到裡面有什麼。
  const virtual = scope.value.startsWith(DIR);
  const flat = scope.value === "all" || virtual || !!search.value;
  return {
    scope: flat ? "all" : scope.value === "root" ? "unfiled" : "folder",
    folderId: flat || scope.value === "root" ? undefined : scope.value,
    kind: kind.value,
    page: targetPage,
    pageSize: pageSize.value,
    q: search.value || (virtual ? scope.value.slice(DIR.length) + "/" : ""),
    sort:
      sort.value !== "newest" || cap.value?.sorts.length
        ? sort.value
        : undefined,
  };
}
async function client(id = provider.value) {
  if (!id) throw new Error(t("resource.choose"));
  const identity = session.profile?.identities.find((i) => i.provider === id);
  if (!identity) throw new Error(t("auth.expired"));
  const token = await accountToken(id, identity.externalId);
  if (!token) throw new ApiError(401, t("auth.expired"));
  return resourceClient(id, token);
}
async function remember() {
  const q = {
    ...route.query,
    provider: provider.value || undefined,
    page: String(page.value),
    pageSize: String(pageSize.value),
    kind: kind.value,
    folder: scope.value,
    q: search.value || undefined,
    sort: sort.value,
  };
  await router.replace({ query: q });
}
async function load(targetPage = page.value, withFolders = false) {
  if (!provider.value) return false;
  const ticket = ++generation;
  loading.value = true;
  error.value = "";
  expired.value = false;
  const request = query(targetPage);
  try {
    const c = await client();
    if (ticket !== generation) return false;
    const [data, groups] = await Promise.all([
      c.list(request),
      withFolders
        ? c
            .folders()
            .then((v) => ({ value: v, error: "" }))
            .catch((e) => ({ value: [] as Folder[], error: message(e) }))
        : Promise.resolve(null),
    ]);
    if (ticket !== generation || disposed) return false;
    const last = Math.max(1, Math.ceil(data.total / pageSize.value));
    if (targetPage > last) return await load(last, withFolders);
    result.value = data;
    capabilities.value = data.capabilities;
    page.value = targetPage;
    selected.value = new Set();
    thumbnailErrors.value = new Set();
    if (groups) {
      folders.value = groups.value;
      folderError.value = groups.error;
    }
    await remember();
    return true;
  } catch (e) {
    if (ticket === generation) {
      error.value = message(e);
      expired.value = e instanceof ApiError && e.status === 401;
    }
    return false;
  } finally {
    if (ticket === generation) loading.value = false;
  }
}
function restoreQuery() {
  pageSize.value = [24, 48, 96].includes(Number(route.query.pageSize))
    ? Number(route.query.pageSize)
    : 48;
  page.value = Math.max(1, Number(route.query.page) || 1);
  kind.value = typeof route.query.kind === "string" ? route.query.kind : "all";
  scope.value =
    typeof route.query.folder === "string" && route.query.folder !== "unfiled"
      ? route.query.folder
      : "root";
  search.value = typeof route.query.q === "string" ? route.query.q : "";
  searchDraft.value = search.value;
  sort.value =
    typeof route.query.sort === "string" ? route.query.sort : "newest";
}
async function choose() {
  generation++;
  result.value = null;
  capabilities.value = null;
  folders.value = [];
  folderError.value = "";
  error.value = "";
  expired.value = false;
  loading.value = false;
  selected.value = new Set();
  managing.value = false;
  preview.value = null;
  kind.value = "all";
  scope.value = "root";
  editing.value = null;
  search.value = "";
  searchDraft.value = "";
  sort.value = "newest";
  page.value = 1;
  copyFallback.value = "";
  notice.value = "";
  try {
    sessionStorage.setItem(choiceKey.value, provider.value);
  } catch {}
  await remember();
  await load(1, true);
}
onMounted(async () => {
  document.title = pageTitle(t("res.title"));
  await session.ensureProfile();
  if (disposed) return;
  restoreQuery();
  let saved = "";
  try {
    saved = sessionStorage.getItem(choiceKey.value) || "";
  } catch {}
  const wanted = String(route.query.provider || saved);
  provider.value =
    providers.value.length === 1
      ? providers.value[0]!.id
      : providers.value.find((p) => p.id === wanted)?.id ||
        providers.value[0]?.id ||
        "";
  ready.value = true;
  if (provider.value) await load(page.value, true);
});
watch(
  () => route.fullPath,
  () => {
    if (!ready.value) return;
    const p = providers.value.find((p) => p.id === route.query.provider)?.id;
    const changed = p && p !== provider.value;
    const navigation =
      Number(route.query.page || 1) !== page.value ||
      Number(route.query.pageSize || 48) !== pageSize.value ||
      String(route.query.folder || "root") !== scope.value ||
      String(route.query.kind || "all") !== kind.value ||
      String(route.query.q || "") !== search.value ||
      String(route.query.sort || "newest") !== sort.value;
    if (changed || navigation) {
      if (changed) {
        provider.value = p!;
        result.value = null;
        capabilities.value = null;
        folders.value = [];
        preview.value = null;
      }
      restoreQuery();
      selected.value = new Set();
      void load(page.value, !!changed);
    }
  },
);
onBeforeUnmount(() => {
  disposed = true;
  generation++;
});
const toolbar = ref<HTMLElement | null>(null);
async function goPage(n: number) {
  if (await load(n)) {
    await nextTick();
    toolbar.value?.scrollIntoView?.({ block: "start" });
  }
}
async function filter() {
  selected.value = new Set();
  preview.value = null;
  result.value = null;
  await load(1);
}
async function find() {
  search.value = searchDraft.value.trim();
  await filter();
}
async function reconnect() {
  if (provider.value)
    try {
      await connectAccount(provider.value, route.fullPath);
    } catch (e) {
      error.value = message(e);
    }
}
function toggle(id: ResourceId) {
  const s = new Set(selected.value);
  s.has(id) ? s.delete(id) : s.add(id);
  selected.value = s;
}
async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    notice.value = t("res.copied");
  } catch {
    copyFallback.value = url;
  }
}
// 一次拿走一批網址：一行一個，貼進卡片或文件就能用。
async function copySelected() {
  const urls = items.value.filter((r) => selected.value.has(r.id)).map((r) => r.imageUrl);
  if (!urls.length) return;
  const text = urls.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    notice.value = t("resource.copiedMany", { n: urls.length });
  } catch {
    copyFallback.value = text;
  }
}
async function mutate(
  action: (c: Awaited<ReturnType<typeof client>>) => Promise<unknown>,
) {
  busy.value = true;
  error.value = "";
  try {
    const c = await client();
    await action(c);
    selected.value = new Set();
    await load(page.value, true);
  } catch (e) {
    const problem = message(e);
    await load(page.value, true);
    error.value = problem;
  } finally {
    busy.value = false;
  }
}
async function remove() {
  const ids = [...selected.value];
  if (!ids.length) return;
  if (
    !(await confirmDialog({
      title: t("resource.deleteTitle", {
        n: ids.length,
        provider: providerName(provider.value),
      }),
      message: t("resource.deleteHint"),
      confirmText: t("dialog.delete"),
      danger: true,
    }))
  )
    return;
  await mutate((c) => c.remove(ids));
}
async function move() {
  const ids = [...selected.value],
    target = moveTarget.value,
    source = scope.value;
  if (!target || !ids.length) return;
  await mutate(async (c) => {
    await c.folder("addItems", { folderId: target, imageIds: ids });
    if (source !== "all" && source !== "root" && !source.startsWith(DIR) && source !== target)
      await c.folder("removeItems", { folderId: source, imageIds: ids });
  });
  moveTarget.value = "";
}
const editing = ref<"create" | "rename" | null>(null),
  folderName = ref("");
async function saveFolder() {
  if (!folderName.value.trim()) return;
  const action = editing.value;
  await mutate(async (c) => {
    const d = await c.folder(action === "rename" ? "rename" : "create", {
      name: folderName.value.trim(),
      ...(action === "rename" ? { folderId: scope.value } : {}),
    });
    const created = d.folderId ?? d.id;
    if (action === "create" && created) {
      scope.value = String(created);
      page.value = 1;
    }
  });
  editing.value = null;
  folderName.value = "";
}
async function deleteFolder() {
  const f = activeFolder.value;
  if (!f) return;
  if (
    !(await confirmDialog({
      message: t("resource.deleteFolder", { name: f.name }),
      confirmText: t("dialog.delete"),
      danger: true,
    }))
  )
    return;
  await mutate(async (c) => {
    await c.folder("delete", { folderId: f.folderId });
    scope.value = "root";
    page.value = 1;
  });
}
const input = ref<HTMLInputElement | null>(null);
const directoryInput = ref<HTMLInputElement | null>(null);
type UploadEntry = {
  file: File;
  status: "waiting" | "uploading" | "done" | "failed";
  progress: number;
  error: string;
};
const uploads = ref<UploadEntry[]>([]),
  uploading = ref(false),
  uploadProvider = ref<ProviderId | "">(""),
  uploadFolder = ref("");
const uploadPage = ref(1);
const uploadPages = computed(() => Math.max(1, Math.ceil(uploads.value.length / 24)));
const visibleUploads = computed(() => uploads.value.slice((uploadPage.value - 1) * 24, uploadPage.value * 24));
const uploadCounts = computed(() => ({ total: uploads.value.length, done: uploads.value.filter(u => u.status === "done").length, failed: uploads.value.filter(u => u.status === "failed").length }));
let uploadClient: Awaited<ReturnType<typeof client>> | null = null;
let uploadFolderIds: string[] = [];
let uploadPrefix = "";
const accept = computed(() => {
  const formats = cap.value?.formats ?? [];
  return formats.length
    ? formats
        .filter((f) => kind.value === "all" || f.startsWith(kind.value + "/"))
        .join(",")
    : kind.value === "all"
      ? ""
      : kind.value === "font"
        ? ".woff,.woff2,.ttf,.otf"
        : kind.value + "/*";
});
async function pick(event: Event) {
  const el = event.target as HTMLInputElement;
  const files = [...(el.files ?? [])];
  el.value = "";
  await enqueue(files);
}
async function enqueue(files: File[]) {
  if (
    !files.length ||
    !provider.value ||
    uploading.value ||
    busy.value ||
    loading.value ||
    expired.value ||
    !result.value
  )
    return;
  const id = provider.value;
  const folder = activeFolder.value;
  const limits = cap.value;
  const prefix = result.value.libraryPrefix;
  if (
    (limits?.overwrite === true || prefix) &&
    !(await confirmDialog({
      title: t("resource.overwriteTitle"),
      message: t("resource.overwriteHint"),
      confirmText: t("res.add"),
      danger: true,
    }))
  )
    return;
  try {
    uploadClient = await client(id);
  } catch (e) {
    error.value = message(e);
    return;
  }
  uploadProvider.value = id;
  uploadPage.value = 1;
  uploadFolder.value = folder?.name || currentPath.value || t("res.scope.unfiled");
  uploadFolderIds = folder ? [folder.folderId] : [];
  // 真的存在的夾由伺服器補路徑前綴；虛擬的夾（只有子夾）由這裡補。
  uploadPrefix = folder ? "" : currentPath.value;
  uploads.value = files.map((file) => ({
    file,
    status: "waiting",
    progress: 0,
    error: "",
  }));
  for (const u of uploads.value) {
    if (limits?.maxFileBytes != null && u.file.size > limits.maxFileBytes) {
      u.status = "failed";
      u.error = t("resource.maxFile", { size: size(limits.maxFileBytes) });
    } else if (
      limits?.formats.length &&
      u.file.type &&
      !limits.formats.includes(
        (
          {
            "audio/x-wav": "audio/wav",
            "audio/wave": "audio/wav",
            "application/ogg": "audio/ogg",
          } as Record<string, string>
        )[u.file.type] || u.file.type,
      )
    ) {
      u.status = "failed";
      u.error = t("res.error.type");
    }
  }
  await runUploads(false);
}
async function runUploads(retry: boolean) {
  if (!uploadClient) return;
  uploading.value = true;
  const c = uploadClient,
    id = uploadProvider.value;
  try {
    for (let index = 0; index < uploads.value.length; index++) {
      const u = uploads.value[index];
      if (disposed) break;
      if (u.status !== "waiting" && !(retry && u.status === "failed")) continue;
      uploadPage.value = Math.floor(index / 24) + 1;
      u.status = "uploading";
      u.error = "";
      try {
        await c.upload(
          u.file,
          uploadFolderIds,
          (n) => (u.progress = Math.round(n * 100)),
          uploadPrefix,
        );
        u.status = "done";
      } catch (e) {
        u.status = "failed";
        u.error = message(e);
      }
    }
  } finally {
    uploading.value = false;
  }
  if (!disposed && provider.value === id) await load(page.value, true);
}
const preview = ref<Resource | null>(null),
  previewItems = ref<Resource[]>([]),
  previewIndex = ref(0),
  previewPage = ref(1),
  previewBusy = ref(false),
  previewError = ref("");
let previewQuery = query();
let previewIssuer: ProviderId | "" = "";
let previewTotal = 0;
function open(r: Resource) {
  previewItems.value = items.value;
  previewIndex.value = items.value.indexOf(r);
  preview.value = r;
  previewPage.value = page.value;
  previewQuery = query();
  previewIssuer = provider.value;
  previewTotal = total.value;
  previewError.value = "";
}
async function previewMove(direction: number) {
  if (previewBusy.value) return;
  const at = previewIndex.value + direction;
  if (at >= 0 && at < previewItems.value.length) {
    previewIndex.value = at;
    preview.value = previewItems.value[at]!;
    return;
  }
  const target = previewPage.value + direction;
  if (target < 1 || target > Math.ceil(previewTotal / pageSize.value)) return;
  previewBusy.value = true;
  previewError.value = "";
  const issuer = previewIssuer;
  try {
    const data = await (
      await client(issuer)
    ).list({ ...previewQuery, page: target });
    if (!preview.value || issuer !== provider.value) return;
    if (!data.items.length) return;
    previewItems.value = data.items;
    previewPage.value = target;
    previewIndex.value = direction > 0 ? 0 : data.items.length - 1;
    preview.value = data.items[previewIndex.value]!;
  } catch (e) {
    previewError.value = message(e);
  } finally {
    previewBusy.value = false;
  }
}
</script>

<template>
  <div
    class="page resources"
    @dragover.prevent
    @drop.prevent="enqueue([...$event.dataTransfer!.files])"
  >
    <header class="resource-head">
      <div>
        <h1 class="display">{{ $t("res.title") }}</h1>
      </div>
      <div class="resource-actions">
        <button
          class="btn"
          :disabled="!provider || loading || busy"
          @click="load(page, true)"
        >
          {{ $t("res.refresh") }}</button
        ><button
          v-if="cap?.relativePaths"
          class="btn"
          :disabled="!result || loading || busy || expired || uploading || quotaFull"
          @click="directoryInput?.click()"
        >{{ $t("resource.uploadDirectory") }}</button
        ><button
          class="btn btn--primary"
          :disabled="
            !result || loading || busy || expired || uploading || quotaFull
          "
          @click="input?.click()"
        >
          {{ $t("res.add") }}</button
        ><input
          ref="input"
          type="file"
          class="sr-only"
          multiple
          :accept="accept"
          @change="pick"
        />
        <input v-if="cap?.relativePaths" ref="directoryInput" type="file" class="sr-only" multiple webkitdirectory :aria-label="$t('resource.uploadDirectory')" @change="pick" />
      </div>
    </header>
    <section class="resource-overview panel">
      <div class="provider-bar">
        <div class="provider-heading">
          <h2>{{ $t("resource.host") }}</h2>
        </div>
        <div v-if="providers.length === 1" class="provider-single">
          <span class="provider-mark" aria-hidden="true">{{
            providerName(provider).slice(0, 1)
          }}</span>
          <strong>{{
            $t("resource.hosted", { provider: providerName(provider) })
          }}</strong>
        </div>
        <div
          v-else-if="providers.length > 1"
          class="provider-choices"
          role="group"
          :aria-label="$t('resource.host')"
        >
          <button
            v-for="p in providers"
            :key="p.id"
            type="button"
            :data-provider="p.id"
            class="provider-choice"
            :aria-pressed="provider === p.id"
            :disabled="busy"
            @click="
              provider = p.id;
              choose();
            "
          >
            <span class="provider-mark" aria-hidden="true">{{
              p.name.slice(0, 1)
            }}</span
            ><span>{{ p.name }}</span
            ><AccountIcon v-if="provider === p.id" name="check" /><span
              v-else
              class="provider-check-space"
              aria-hidden="true"
            />
          </button>
        </div>
        <p v-else class="subtle">
          {{ $t(ready ? "resource.noProvider" : "state.loading") }}
        </p>
        <div v-if="provider" class="resource-usage">
          <span class="subtle">{{ $t("res.quota.label") }}</span>
          <strong
            >{{ size(result?.usedBytes) }}
            <span class="subtle">/ {{ size(result?.byteQuota) }}</span></strong
          >
          <div
            class="resource-meter"
            role="progressbar"
            :aria-label="$t('res.quota.label')"
            :aria-valuenow="result?.usedBytes ?? undefined"
            :aria-valuemax="result?.byteQuota ?? undefined"
            aria-valuemin="0"
          >
            <span :style="{ width: quotaRatio + '%' }" />
          </div>
        </div>
      </div>
      <div v-if="provider" class="resource-meta">
        <section v-if="libraryPrefix" class="resource-prefix" :aria-label="$t('res.prefix.label')">
          <h3>{{ $t("res.prefix.label") }}</h3>
          <div class="prefix-row">
            <code>{{ libraryPrefix }}</code>
            <button class="btn btn--sm" @click="copy(libraryPrefix)">{{ $t("res.copy") }}</button>
          </div>
        </section>
        <button
          class="btn btn--ghost resource-details-toggle"
          :aria-expanded="detailsOpen"
          aria-controls="resource-details"
          @click="detailsOpen = !detailsOpen"
        >
          {{ $t("resource.rules") }}<AccountIcon name="arrow" />
        </button>
      </div>
      <div v-if="detailsOpen && provider" id="resource-details" class="resource-details">
        <div class="resource-rules-content">
          <dl v-if="formatGroups.length" class="format-groups">
            <div v-for="group in formatGroups" :key="group.kind">
              <dt>{{ $t("res.kind." + group.kind) }}</dt>
              <dd><span v-for="format in group.formats" :key="format">{{ format }}</span></dd>
            </div>
          </dl>
          <p v-else class="subtle">{{ $t("resource.rulesUnavailable") }}</p>
          <div v-if="cap?.maxFileBytes" class="upload-limit">
            <span class="subtle">{{ $t("resource.maxFileLabel") }}</span><strong>{{ size(cap.maxFileBytes) }}</strong>
          </div>
        </div>
        <div class="resource-help">
          <template v-if="libraryPrefix">
            <h3>{{ $t("res.prefix.label") }}</h3>
            <p class="subtle">{{ $t("res.prefix.hint") }}</p>
            <p v-if="cap?.relativePaths" class="subtle">{{ $t("resource.directoryHint") }}</p>
          </template>
          <RouterLink :to="lp('/me')" class="resource-link">{{ $t("resource.connections") }}</RouterLink>
        </div>
      </div>
      <RouterLink v-if="!provider" :to="lp('/me')" class="resource-link">{{ $t("resource.connections") }}</RouterLink>
    </section>
    <div v-if="!provider && ready" class="empty panel">
      <h2>{{ $t("resource.noProvider") }}</h2>
      <p class="subtle">{{ $t("resource.isolated") }}</p>
    </div>
    <template v-if="provider">
      <p v-if="quotaFull" class="notice notice--error">
        {{ $t("resource.quotaFull") }}
      </p>
      <p v-if="error" class="notice notice--error" role="alert">
        {{ error }}
        <button
          class="btn btn--sm"
          :disabled="loading"
          @click="expired ? reconnect() : load(page, true)"
        >
          {{ $t(expired ? "resource.reconnect" : "resource.retry") }}
        </button>
      </p>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <input
        v-if="copyFallback"
        readonly
        class="input"
        :aria-label="$t('res.copyManual')"
        :value="copyFallback"
        @focus="($event.target as HTMLInputElement).select()" />
      <section v-if="uploads.length" class="upload-list panel">
        <header>
          <h2>
            {{
              $t("resource.uploadTo", {
                provider: providerName(uploadProvider),
                folder: uploadFolder,
              })
            }}
          </h2>
          <button
            v-if="!uploading && uploads.some((u) => u.status === 'failed')"
            class="btn"
            @click="runUploads(true)"
          >
            {{ $t("resource.retryFailed") }}</button
          ><button
            v-if="!uploading"
            class="btn btn--ghost"
            @click="uploads = []"
          >
            {{ $t("resource.close") }}
          </button>
        </header>
        <p class="subtle" role="status">{{ $t('resource.uploadSummary', uploadCounts) }}</p>
        <ul>
          <li v-for="(u, i) in visibleUploads" :key="(uploadPage - 1) * 24 + i">
            <span>{{ u.file.webkitRelativePath || u.file.name }}</span
            ><span
              >{{ $t("resource.upload." + u.status) }}
              {{ u.status === "uploading" ? u.progress + "%" : "" }}</span
            >
            <p v-if="u.error" class="error-text">{{ u.error }}</p>
          </li>
        </ul>
        <nav v-if="uploadPages > 1" class="upload-pages" :aria-label="$t('resource.uploadPages')">
          <button class="btn" :disabled="uploading || uploadPage <= 1" @click="uploadPage--">{{ $t('resource.previous') }}</button>
          <span>{{ uploadPage }} / {{ uploadPages }}</span>
          <button class="btn" :disabled="uploading || uploadPage >= uploadPages" @click="uploadPage++">{{ $t('resource.next') }}</button>
        </nav>
      </section>
      <section class="resource-content">
          <div ref="toolbar" class="resource-toolbar">
            <div class="seg" role="tablist" :aria-label="$t('resource.types')">
              <button
                v-for="k in ['all', ...(cap?.kinds ?? [])]"
                :key="k"
                role="tab"
                :aria-selected="kind === k"
                class="seg__item"
                :class="{ 'seg__item--on': kind === k }"
                :disabled="busy"
                @click="
                  kind = k;
                  filter();
                "
              >
                {{ $t("res.kind." + k) }}
              </button>
            </div>
            <button
              class="btn btn--sm"
              :disabled="!items.length || busy"
              @click="
                managing = !managing;
                selected = new Set();
              "
            >
              {{ $t(managing ? "res.done" : "res.manage") }}
            </button>
          </div>
          <div v-if="cap?.search || cap?.sorts.length" class="resource-search">
            <form v-if="cap.search" @submit.prevent="find">
              <input
                v-model="searchDraft"
                class="input"
                maxlength="200"
                :placeholder="$t('resource.search')"
                :aria-label="$t('resource.search')"
              /><button class="btn" :disabled="busy">
                {{ $t("resource.find") }}
              </button>
            </form>
            <ResourceSelect
              v-if="cap?.sorts.length"
              v-model="sort"
              class="resource-sort"
              :label="$t('resource.sort')"
              :disabled="busy"
              :options="
                cap.sorts.map((s) => ({
                  value: s,
                  label: $t('resource.sort.' + s),
                }))
              "
              @change="filter"
            />
          </div>
          <div v-if="managing" class="resource-batch panel">
            <label
              ><input
                type="checkbox"
                :checked="selected.size === items.length && items.length > 0"
                @change="
                  selected =
                    selected.size === items.length
                      ? new Set()
                      : new Set(items.map((i) => i.id))
                "
              />{{ $t("resource.selectPage") }}</label
            ><span>{{ $t("res.selected", { n: selected.size }) }}</span
            ><ResourceSelect
              v-model="moveTarget"
              :label="$t('res.moveTo')"
              :disabled="!selected.size || busy"
              :options="
                folderRows
                  .filter((r) => r.node.folderId && r.node.folderId !== scope)
                  .map((r) => ({ value: r.node.folderId!, label: r.node.path }))
              "
              @change="move"
            /><button
              class="btn"
              :disabled="!selected.size || busy"
              @click="copySelected"
            >
              {{ $t("resource.copySelected") }}</button
            ><button
              v-if="activeFolder"
              class="btn"
              :disabled="!selected.size || busy"
              @click="
                mutate((c) =>
                  c.folder('removeItems', {
                    folderId: scope,
                    imageIds: [...selected],
                  }),
                )
              "
            >
              {{ $t("res.unfile") }}</button
            ><button
              class="btn btn--danger"
              :disabled="!selected.size || busy"
              @click="remove"
            >
              {{ $t("dialog.delete") }}
            </button>
          </div>
          <div class="resource-path panel">
            <nav class="resource-crumbs" :aria-label="$t('resource.folders')">
              <button class="crumb" :disabled="busy" @click="enter('root')">{{ $t("res.scope.all") }}</button>
              <template v-for="c in crumbs" :key="c.path"
                ><span aria-hidden="true">/</span
                ><button
                  class="crumb"
                  :aria-current="c.path === currentPath ? 'page' : undefined"
                  :disabled="busy"
                  @click="enter(scopeOf(findNode(tree, c.path)!))"
                >
                  {{ c.name }}
                </button></template
              >
              <span v-if="search" class="subtle crumb-note">{{ $t("resource.searchScope") }}</span>
            </nav>
            <div class="resource-path-actions">
              <button
                class="btn btn--sm btn--ghost"
                :disabled="!result || busy || expired"
                @click="
                  editing = 'create';
                  folderName = '';
                "
              >
                ＋ {{ $t("res.folder.new") }}</button
              ><template v-if="activeFolder"
                ><button
                  class="btn btn--sm btn--ghost"
                  :disabled="busy"
                  @click="
                    editing = 'rename';
                    folderName = activeFolder!.name;
                  "
                >
                  {{ $t("res.folder.rename") }}</button
                ><button class="btn btn--sm btn--ghost" :disabled="busy" @click="deleteFolder">
                  {{ $t("res.folder.delete") }}
                </button></template
              >
            </div>
            <form v-if="editing" class="folder-form" @submit.prevent="saveFolder">
              <input
                v-model="folderName"
                class="input"
                maxlength="80"
                :aria-label="$t('res.folder.placeholder')"
                :placeholder="$t('res.folder.placeholder')"
              /><button class="btn" :disabled="busy || !folderName.trim()">
                {{ $t("dialog.confirm") }}</button
              ><button type="button" class="btn btn--ghost" @click="editing = null">
                {{ $t("dialog.cancel") }}
              </button>
            </form>
          </div>
          <div v-if="loading && !result" class="resource-table-skeleton ghost" aria-busy="true" />
          <div v-else-if="!items.length && !childNodes.length && !error" class="empty panel">
            <h2>{{ $t(search ? "resource.noResults" : "res.empty") }}</h2>
            <p class="subtle">
              {{ $t(search ? "resource.changeSearch" : "resource.dropHint") }}
            </p>
            <button
              v-if="search"
              class="btn"
              @click="
                searchDraft = '';
                find();
              "
            >
              {{ $t("resource.clearSearch") }}
            </button>
          </div>
          <div v-else class="resource-table-wrap panel">
            <table class="resource-table" :aria-busy="loading">
              <thead>
                <tr>
                  <th v-if="managing" class="col-check"><span class="sr-only">{{ $t("res.manage") }}</span></th>
                  <th>{{ $t("resource.colName") }}</th>
                  <th class="col-size">{{ $t("resource.colSize") }}</th>
                  <th class="col-type">{{ $t("resource.colType") }}</th>
                  <th class="col-time">{{ $t("resource.colTime") }}</th>
                  <th class="col-actions"><span class="sr-only">{{ $t("res.copy") }}</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="n in childNodes" :key="'d:' + n.path" class="row-folder">
                  <td v-if="managing" class="col-check"></td>
                  <td class="col-name">
                    <button class="row-name" :disabled="busy" @click="enter(scopeOf(n))">
                      <AccountIcon name="folder" /><span>{{ n.name }}</span>
                    </button>
                  </td>
                  <td class="col-size subtle">{{ n.count ? $t("resource.itemCount", { n: n.count }) : "" }}</td>
                  <td class="col-type subtle">{{ $t("resource.typeFolder") }}</td>
                  <td class="col-time"></td>
                  <td class="col-actions"></td>
                </tr>
                <tr
                  v-for="r in filesHidden ? [] : items"
                  :key="r.id"
                  class="row-file"
                  :class="{ 'is-selected': selected.has(r.id) }"
                >
                  <td v-if="managing" class="col-check">
                    <input
                      type="checkbox"
                      class="resource-check"
                      :checked="selected.has(r.id)"
                      :aria-label="$t('resource.select', { name: name(r) })"
                      @change="toggle(r.id)"
                    />
                  </td>
                  <td class="col-name">
                    <button data-preview class="row-name" :aria-label="$t('resource.preview', { name: name(r) })" @click="open(r)">
                      <AccountIcon :name="r.kind === 'image' ? 'image' : 'cards'" /><span>{{ name(r) }}</span>
                    </button>
                    <span
                      v-if="r.moderationState === 'pending' || r.moderationState === 'reject'"
                      class="resource-state"
                      >{{ $t(r.moderationState === "pending" ? "res.state.pending" : "res.state.rejected") }}</span
                    >
                  </td>
                  <td class="col-size subtle">{{ size(r.byteSize) }}</td>
                  <td class="col-type subtle">
                    {{ (r.mimeType?.split("/")[1] || r.kind).toUpperCase()
                    }}<template v-if="r.pixelWidth"> · {{ r.pixelWidth }}×{{ r.pixelHeight }}</template>
                  </td>
                  <td class="col-time subtle">{{ when(r.createTime) }}</td>
                  <td class="col-actions">
                    <button class="btn btn--sm btn--ghost" @click="copy(r.imageUrl)">{{ $t("res.copy") }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <nav
            v-if="result && !filesHidden"
            class="resource-pager"
            :aria-label="$t('resource.pagination')"
          >
            <span class="subtle">{{
              $t("resource.range", {
                from: total ? (page - 1) * pageSize + 1 : 0,
                to: Math.min(page * pageSize, total),
                total,
              })
            }}</span>
            <div class="page-buttons">
              <button
                class="btn btn--sm"
                :disabled="page <= 1 || loading || busy"
                @click="goPage(page - 1)"
              >
                {{ $t("resource.previous") }}</button
              ><button
                v-for="n in pageNumbers"
                :key="n"
                class="btn btn--sm"
                :class="{ 'btn--primary': page === n }"
                :aria-current="page === n ? 'page' : undefined"
                :disabled="loading || busy"
                @click="goPage(n)"
              >
                {{ n }}</button
              ><button
                data-next
                class="btn btn--sm"
                :disabled="page >= pages || loading || busy"
                @click="goPage(page + 1)"
              >
                {{ $t("resource.next") }}
              </button>
            </div>
            <ResourceSelect
              v-model="pageSize"
              :label="$t('resource.pageSize')"
              :disabled="loading || busy"
              :options="
                [24, 48, 96].map((n) => ({
                  value: n,
                  label: $t('resource.perPage', { n }),
                }))
              "
              @change="filter"
            />
          </nav>
        </section></template>
    <ResourcePreview
      v-if="preview"
      :item="preview"
      :provider="providerName(provider)"
      :previous="previewIndex > 0 || previewPage > 1"
      :next="
        previewIndex < previewItems.length - 1 ||
        previewPage < Math.ceil(previewTotal / pageSize)
      "
      :busy="previewBusy"
      :error="previewError"
      @close="preview = null"
      @move="previewMove"
      @copy="copy"
    />
  </div>
</template>
<style scoped>
.resource-head,
.resource-actions,
.resource-toolbar,
.resource-search,
.resource-search form,
.resource-batch,
.resource-pager,
.page-buttons,
.upload-list header,
.prefix-row {
  display: flex;
  gap: var(--s-3);
  align-items: center;
  flex-wrap: wrap;
}
.resource-head,
.resource-toolbar,
.resource-pager {
  justify-content: space-between;
}
.resource-head {
  margin-bottom: var(--s-4);
}
.resource-head h1 {
  font-size: 1.5rem;
  margin: 0;
}
.resources .input {
  border-radius: var(--r-pill);
}
.resource-overview {
  margin-bottom: var(--s-4);
  padding: var(--s-3) var(--s-4);
}
.provider-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-3);
}
.provider-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--s-3);
}
.provider-heading h2 {
  margin: 0;
  color: var(--text-2);
  font-size: 0.85rem;
  font-weight: 600;
}
.provider-choices {
  display: flex;
  gap: var(--s-2);
  flex-wrap: wrap;
}
.provider-choice {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  min-height: var(--h-lg);
  padding: var(--s-1) var(--s-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-pill);
  color: var(--text);
  background: transparent;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}
.provider-choice[aria-pressed="true"] {
  color: var(--accent-text);
  background: var(--accent-tint);
  border-color: var(--accent);
}
.provider-choice:hover:not(:disabled) {
  background: var(--surface-2);
}
.provider-choice:disabled {
  opacity: 0.5;
  cursor: default;
}
.provider-mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 0.75rem;
  font-weight: 700;
}
.provider-choice[aria-pressed="true"] .provider-mark {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.provider-check-space {
  width: 20px;
  flex: none;
}
.provider-single {
  display: flex;
  gap: var(--s-2);
  align-items: center;
  font-size: 0.95rem;
}
.resource-link {
  font-size: 0.8rem;
  color: var(--text-2);
  text-underline-offset: 3px;
}
.resource-usage {
  margin-left: auto;
  display: grid;
  grid-template-columns: auto auto;
  column-gap: var(--s-2);
  align-items: baseline;
  font-size: 0.8rem;
}
.resource-usage strong {
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}
.resource-usage strong span {
  font-weight: 400;
}
.resource-meter {
  grid-column: 1 / -1;
  height: 3px;
  margin-top: var(--s-1);
  background: var(--surface-2);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.resource-meter span {
  display: block;
  height: 100%;
  background: var(--accent);
}
.resource-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s-2) var(--s-4);
  margin-top: var(--s-2);
  padding-top: var(--s-2);
  border-top: 1px solid var(--line);
}
.resource-details-toggle {
  margin-left: auto;
  min-height: var(--h-lg);
  font-size: 0.8rem;
  flex: none;
}
.resource-details-toggle :deep(svg) {
  width: 16px;
  height: 16px;
  transform: rotate(90deg);
  transition: transform var(--dur);
}
.resource-details-toggle[aria-expanded="true"] :deep(svg) {
  transform: rotate(-90deg);
}
.resource-details {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--s-5);
  border-top: 1px solid var(--line);
  margin-top: var(--s-2);
  padding-block: var(--s-4) var(--s-2);
  font-size: 0.85rem;
}
.resource-help p {
  margin: var(--s-2) 0;
  overflow-wrap: anywhere;
}
.resource-help h3 {
  margin: 0;
  font-size: inherit;
}
.resource-help .resource-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--h-lg);
}
.format-groups {
  margin: 0;
  display: grid;
  gap: var(--s-3);
}
.format-groups > div {
  display: grid;
  grid-template-columns: 4em minmax(0, 1fr);
  gap: var(--s-3);
}
.format-groups dt {
  color: var(--text-2);
}
.format-groups dd {
  display: flex;
  gap: var(--s-2);
  flex-wrap: wrap;
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.6;
  font-weight: 600;
}
.upload-limit {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  border-top: 1px solid var(--line);
  padding-top: var(--s-3);
  margin-top: var(--s-4);
}
.upload-limit strong {
  font-size: 0.95rem;
}
.resource-prefix {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: var(--s-3);
}
.resource-prefix h3 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-2);
  flex: none;
}
.prefix-row {
  min-width: 0;
  flex: 1;
  flex-wrap: nowrap;
  gap: var(--s-2);
}
.prefix-row .btn { min-height: var(--h-lg); flex: none; }
.prefix-row code {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
  font-size: 0.75rem;
}
.upload-pages { display: flex; align-items: center; justify-content: flex-end; gap: var(--s-3); }
.resource-sort {
  width: 190px;
  flex: none;
}
.resource-path {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-2);
  padding: var(--s-2) var(--s-3);
  margin-bottom: var(--s-3);
}
.resource-crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 0.9375rem;
}
.crumb-note {
  margin-left: var(--s-2);
  font-size: 0.8125rem;
}
.resource-path-actions {
  display: flex;
  gap: var(--s-1);
  flex-wrap: wrap;
}
.resource-path .folder-form {
  width: 100%;
  margin-top: 0;
}
.resource-table-wrap {
  padding: 0;
  overflow: hidden;
}
.resource-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  table-layout: fixed;
}
.resource-table th {
  text-align: left;
  font-weight: 500;
  font-size: 0.75rem;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--muted);
  padding: var(--s-2) var(--s-3);
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
.resource-table td {
  padding: var(--s-2) var(--s-3);
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}
.resource-table tbody tr:last-child td {
  border-bottom: 0;
}
.resource-table tbody tr:hover {
  background: var(--surface-2);
}
.resource-table tr.is-selected {
  background: var(--accent-tint);
}
.col-check {
  width: 40px;
}
.col-size {
  width: 110px;
  white-space: nowrap;
}
.col-type {
  width: 150px;
  white-space: nowrap;
}
.col-time {
  width: 120px;
  white-space: nowrap;
}
.col-actions {
  width: 110px;
  text-align: right;
}
.col-name {
  min-width: 0;
}
.row-name {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  max-width: 100%;
  min-height: 36px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row-name > span {
  overflow-wrap: anywhere;
}
.row-folder .row-name {
  font-weight: 600;
}
.row-name:hover > span {
  text-decoration: underline;
}
.resource-check {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
  vertical-align: middle;
}
.resource-state {
  display: inline-block;
  margin-left: var(--s-2);
  font-size: 0.75rem;
  color: var(--danger);
}
.resource-table-skeleton {
  height: 280px;
  border-radius: var(--r-lg);
}
.crumb {
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  padding: 4px 6px;
  border-radius: var(--r-sm);
  cursor: pointer;
  overflow-wrap: anywhere;
}
.crumb:hover {
  background: var(--surface-2);
}
.crumb[aria-current="page"] {
  font-weight: 600;
}
.resource-content {
  min-width: 0;
}
.resource-toolbar {
  margin-bottom: var(--s-4);
}
.resource-search {
  margin-bottom: var(--s-4);
}
.resource-search form {
  flex: 1;
  min-width: 180px;
  flex-wrap: nowrap;
}
.resource-search input {
  width: 100%;
}
.resource-search > .resource-select {
  max-width: 180px;
}
.resource-batch {
  padding: var(--s-3);
  margin-bottom: var(--s-3);
  font-size: 0.85rem;
}
.resource-batch .resource-select {
  max-width: 180px;
}
.resource-pager {
  margin-top: var(--s-5);
  font-size: 0.85rem;
}
.resource-pager .resource-select {
  width: auto;
}
.page-buttons {
  gap: var(--s-1);
}
.upload-list {
  padding: var(--s-4);
  margin-bottom: var(--s-4);
}
.upload-list h2 {
  font-size: 1rem;
  margin: 0;
  flex: 1;
}
.upload-list ul {
  padding: 0;
  list-style: none;
  max-height: 240px;
  overflow: auto;
}
.upload-list li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--s-2);
  padding: var(--s-2) 0;
  border-bottom: 1px solid var(--line);
  font-size: 0.85rem;
}
.upload-list li > span:first-child {
  overflow-wrap: anywhere;
  min-width: 0;
  flex: 1;
}
.upload-list li p {
  width: 100%;
  margin: 0;
}
.error-text {
  color: var(--danger);
  font-size: 0.85rem;
}
.folder-form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  margin-top: var(--s-3);
}
.folder-form input {
  width: 100%;
}
.empty {
  text-align: center;
  padding: var(--s-5);
}
.empty h2 {
  font-size: 1rem;
}
.resources > .notice {
  margin-bottom: var(--s-3);
}
@media (max-width: 720px) {
  .resources .btn,
  .resources .seg__item,
  .resources .input {
    min-height: var(--h-lg);
  }

  .folder-form {
    width: 100%;
  }
  .col-type,
  .col-time {
    display: none;
  }
  .resource-table th.col-actions,
  .resource-table td.col-actions {
    width: 48px;
  }
  .col-actions .btn {
    padding-inline: var(--s-2);
  }
  .resource-overview {
    padding: var(--s-3);
  }
  .provider-heading {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .provider-choice {
    padding-inline: var(--s-2);
    flex: 1;
    justify-content: center;
    font-size: 0.85rem;
    gap: var(--s-1);
  }
  .provider-choices {
    width: 100%;
    gap: var(--s-2);
  }
  .resource-usage {
    margin-left: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    width: 100%;
  }
  .resource-meter {
    min-width: 32px;
    flex: 1;
    align-self: center;
    margin: 0;
  }
  .resource-prefix {
    flex-basis: 100%;
    display: block;
  }
  .resource-prefix h3 {
    margin-bottom: var(--s-1);
  }
  .resource-details-toggle {
    margin-left: 0;
    padding-inline: 0;
  }
  .resource-details {
    grid-template-columns: 1fr;
    gap: var(--s-4);
  }
  .resource-head {
    align-items: start;
  }
  .resource-actions {
    gap: var(--s-2);
  }
  .resource-actions .btn {
    padding-inline: var(--s-3);
    font-size: 0.8rem;
  }
  .resource-toolbar {
    flex-wrap: nowrap;
    gap: var(--s-2);
  }
  .resource-toolbar .seg {
    min-width: 0;
    overflow: auto;
  }
  .resource-toolbar > .btn {
    flex: none;
  }
  .resource-toolbar .seg__item {
    padding-inline: var(--s-2);
  }
  .resource-pager {
    gap: var(--s-3);
  }
  .page-buttons {
    width: 100%;
    justify-content: center;
  }
}
</style>
