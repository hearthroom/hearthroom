<script setup lang="ts">
/**
 * 生圖：頂層第四頁。上面是輸入框（技能、模型、參數），下面是快取區。
 *
 * 生成的圖先留在 Harbor 7 天（快取區），不直接進資源庫：作者看過、挑中了，取個名字再存進資源庫或下載到這台裝置。
 * 快取區讀 Harbor 的生成紀錄，所以換頁、重新整理、在 CLI 生的都看得到；描述只記在這台裝置（studio.ts）。
 * 一次可以送好幾個：每個生成各自輪詢，互不擋。同一次送出沿用同一把 Idempotency-Key，連線斷掉重送不多扣。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import LibraryPicker from "@/components/editor/LibraryPicker.vue";
import StudioComposer from "@/components/studio/StudioComposer.vue";
import StudioSaveDialog from "@/components/studio/StudioSaveDialog.vue";
import StudioAgentPlan, { type AgentShot } from "@/components/studio/StudioAgentPlan.vue";
import { ApiError, fetchLibraryFolders, uploadImage, type LibraryFolder } from "@/lib/api";
import { connectAccount } from "@/lib/connections";
import type { GenerationModel, GenerationTask } from "@/lib/media-generation";
import { useSession } from "@/lib/session";
import { defaultName, extensionOf, fitSize, recipeOf, rememberRecipe, type Recipe } from "@/lib/studio";
import { track } from "@/lib/track";
import { useImageGeneration } from "@/lib/use-image-generation";

const { t, locale } = useI18n();
const route = useRoute();
const session = useSession();
const TOP_UP = "https://console.harperharbor.com/me/billing";
const { imageGen, generator, probeGeneration, markReauthorizing } = useImageGeneration(() => "harbor");
const composer = ref<InstanceType<typeof StudioComposer> | null>(null);

type Failure = "reauth" | "credits" | "policy" | "interrupted" | "failed";
interface Entry {
  /** 送出時就有：任務 id 還沒回來前用 key 認。 */
  key: string;
  task: GenerationTask;
  recipe?: Recipe;
  input?: { model: string; prompt: string; size: string; n: number; images: string[] };
  failure?: Failure;
}
const entries = ref<Entry[]>([]);
const probed = ref(false);
const loading = ref(false);
const listError = ref(false);
const notice = ref("");
let disposed = false;
onBeforeUnmount(() => (disposed = true));

const modelName = (id?: string) => {
  const m = imageGen.value?.models.find((x) => x.id === id);
  return m ? (m.laneName ? `${m.name} · ${m.laneName}` : m.name) : (id ?? "");
};
const when = (s?: number) =>
  s ? new Intl.DateTimeFormat(String(locale.value), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(s * 1000) : "";
const daysLeft = (e?: number) => (e ? Math.max(1, Math.ceil((e * 1000 - Date.now()) / 86_400_000)) : 0);
const running = (task: GenerationTask) => task.status === "queued" || task.status === "in_progress";

function failureOf(e: unknown, created: boolean): Failure {
  if (!(e instanceof ApiError)) return "interrupted";
  if (e.status === 401 || e.status === 403) return "reauth";
  if (e.status === 402) return "credits";
  if (e.status === 400 && e.code === "content_policy_violation") return "policy";
  return created ? "interrupted" : "failed";
}

async function follow(entry: Entry) {
  try {
    const c = await generator();
    entry.task = await c.wait(entry.task, () => disposed);
    if (entry.task.status === "failed") entry.failure = entry.task.code === "content_policy_violation" ? "policy" : "failed";
  } catch (e) {
    if (!disposed) entry.failure = failureOf(e, true);
  }
}

async function load() {
  loading.value = true;
  listError.value = false;
  try {
    const tasks = await (await generator()).list();
    const local = entries.value.filter((e) => !tasks.some((t) => t.id === e.task.id));
    entries.value = [...local, ...tasks.map((task) => reactive<Entry>({ key: task.id, task, recipe: recipeOf(task.id) }))];
    for (const e of entries.value) if (running(e.task) && !e.failure) void follow(e);
  } catch {
    listError.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await probeGeneration();
  probed.value = true;
  if (imageGen.value?.access === "ready") {
    void generator().then((c) => c.canPlan()).then((ok) => (canPlan.value = ok), () => {});
    await load();
  }
  const ref = typeof route.query.ref === "string" ? route.query.ref : "";
  if (ref) {
    await nextTick();
    composer.value?.addReference(ref);
  }
});

async function submit(input: Entry["input"] & {}, recipe: Recipe) {
  notice.value = "";
  const entry = reactive<Entry>({
    key: crypto.randomUUID(),
    task: { id: "", status: "queued", urls: [], saved: [], model: input.model, size: input.size, createdAt: Math.floor(Date.now() / 1000) },
    recipe,
    input,
  });
  entries.value = [entry, ...entries.value];
  track("studio_generate");
  await create(entry);
  return entry;
}
async function create(entry: Entry) {
  entry.failure = undefined;
  try {
    const c = await generator();
    const task = await c.create(entry.input!, entry.key);
    entry.task = { ...task, model: task.model ?? entry.input!.model, size: task.size ?? entry.input!.size, createdAt: task.createdAt ?? entry.task.createdAt };
    if (entry.recipe) rememberRecipe(task.id, entry.recipe);
    if (running(entry.task)) await follow(entry);
    else if (entry.task.status === "failed") entry.failure = entry.task.code === "content_policy_violation" ? "policy" : "failed";
  } catch (e) {
    // 伺服器明確拒絕：這把 key 用完了，重試要換新的；連線斷掉才留著同一把重送（同一個任務、只扣一次）。
    entry.failure = failureOf(e, false);
    if (e instanceof ApiError) entry.key = crypto.randomUUID();
  }
}
function retry(entry: Entry) {
  if (entry.task.id) {
    entry.failure = undefined;
    void follow(entry);
  } else void create(entry);
}
function dismiss(entry: Entry) {
  entries.value = entries.value.filter((e) => e !== entry);
}
function reauthorize() {
  markReauthorizing();
  void connectAccount("harbor", route.fullPath).catch(() => {});
}

// ── Agent 模式 ─────────────────────────────────────────
// 一句想法交給伺服器排成幾組（照一般對話計價），作者改過再全部生成：第一組先畫，
// 標了「跟第一組同一個角色」的幾組等它出圖，拿它的第一張當參考圖；其餘的同時送出。
const canPlan = ref(false);
const planning = ref(false);
const planError = ref("");
const agent = ref<{ summary: string; credits: number; shots: AgentShot[]; references: string[]; model: string; state: "editing" | "running" | "done" } | null>(null);
const modelOf = (id: string) => imageGen.value?.models.find((m) => m.id === id);
/** 這一組用哪個模型：要參考圖時，目前的模型收不了就換最便宜、收得了的那個。 */
function modelFor(shot: AgentShot, withReference: boolean): GenerationModel | undefined {
  const base = modelOf(agent.value!.model) ?? imageGen.value?.models[0];
  if (!withReference || (base && base.maxReferences > 0)) return base;
  return imageGen.value?.models.find((m) => m.maxReferences > 0) ?? base;
}
const estimate = computed(() =>
  (agent.value?.shots ?? []).reduce((sum, shot) => {
    const m = modelFor(shot, shot.reference !== "none");
    return sum + (m ? m.credits * Math.min(shot.count, m.maxImages) : 0);
  }, 0),
);
async function plan(input: { idea: string; references: string[]; model: string }) {
  planning.value = true;
  planError.value = "";
  try {
    const p = await (await generator()).plan({ idea: input.idea, language: String(locale.value), hasReference: input.references.length > 0, maxImages: modelOf(input.model)?.maxImages ?? 1 });
    agent.value = reactive({ ...p, shots: p.shots.map((s) => ({ ...s })), references: input.references, model: input.model, state: "editing" as const });
    composer.value?.clear();
    track("studio_plan");
  } catch (e) {
    planError.value =
      e instanceof ApiError && e.code === "plan_unreadable"
        ? t("studio.agent.error.unreadable")
        : e instanceof ApiError && e.status === 402
          ? t("studio.agent.error.credits")
          : e instanceof ApiError && (e.status === 401 || e.status === 403)
            ? t("resource.gen.error.reauth")
            : t("studio.agent.error.failed");
  } finally {
    planning.value = false;
  }
}
async function runPlan() {
  const a = agent.value;
  if (!a || a.state !== "editing") return;
  a.shots = a.shots.filter((s) => s.prompt.trim());
  a.state = "running";
  track("studio_plan_run");
  const start = async (shot: AgentShot, refs: string[]) => {
    const m = modelFor(shot, refs.length > 0);
    if (!m) {
      shot.status = "failed";
      return undefined;
    }
    const images = m.maxReferences > 0 ? refs.slice(0, m.maxReferences) : [];
    shot.status = "running";
    const entry = await submit(
      { model: m.id, prompt: shot.prompt.trim(), size: fitSize(m.sizes, shot.shape), n: Math.min(shot.count, m.maxImages), images },
      { prompt: shot.prompt.trim(), ...(shot.skill ? { skill: shot.skill } : {}), ...(images.length ? { references: images } : {}) },
    );
    shot.status = entry.task.urls.length ? "done" : "failed";
    return entry;
  };
  for (const shot of a.shots) shot.status = "waiting";
  const given = (shot: AgentShot) => (shot.reference === "given" ? a.references : []);
  const [first, ...rest] = a.shots;
  const firstRun = start(first!, given(first!));
  const others = rest.filter((s) => s.reference !== "anchor").map((s) => start(s, given(s)));
  const anchor = (await firstRun)?.task.urls[0];
  const followers = rest
    .filter((s) => s.reference === "anchor")
    .map((s) => {
      if (anchor) return start(s, [anchor]);
      s.status = "skipped";
      return undefined;
    });
  await Promise.all([...others, ...followers]);
  a.state = "done";
}

// ── 參考圖 ─────────────────────────────────────────────
const picking = ref(false);
const uploading = ref(false);
async function uploadReference(file: File) {
  uploading.value = true;
  notice.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error("auth");
    composer.value?.addReference(await uploadImage(file, token));
  } catch {
    notice.value = t("studio.ref.uploadFailed");
  } finally {
    uploading.value = false;
  }
}
function useAsReference(url: string) {
  composer.value?.addReference(url);
  lightbox.value = null;
  window.scrollTo({ top: 0, behavior: "smooth" });
  composer.value?.focus();
}
function again(entry: Entry) {
  composer.value?.fill(entry.recipe ?? { prompt: "" }, { model: entry.task.model, size: entry.task.size, n: entry.task.urls.length || entry.input?.n });
  window.scrollTo({ top: 0, behavior: "smooth" });
}
async function copyPrompt(entry: Entry) {
  try {
    await navigator.clipboard.writeText(entry.recipe?.prompt ?? "");
    notice.value = t("studio.copied");
  } catch {}
}

// ── 存檔與下載 ─────────────────────────────────────────
const FOLDER_KEY = "hearthroom.studio.folder";
const lastFolder = () => {
  try {
    return localStorage.getItem(FOLDER_KEY) ?? "";
  } catch {
    return "";
  }
};
const folders = ref<LibraryFolder[]>([]);
const saving = ref<{ entry: Entry; index: number; mode: "library" | "local"; busy: boolean; error: string } | null>(null);
async function openSave(entry: Entry, index: number, mode: "library" | "local") {
  lightbox.value = null;
  saving.value = { entry, index, mode, busy: false, error: "" };
  if (mode === "library" && !folders.value.length) {
    try {
      const token = await session.accessToken();
      if (token) folders.value = await fetchLibraryFolders(token);
    } catch {}
  }
}
const saveFolder = computed(() => (typeof route.query.dir === "string" ? route.query.dir : lastFolder()));
async function confirmSave(name: string, folder: string) {
  const s = saving.value;
  if (!s) return;
  const url = s.entry.task.urls[s.index]!;
  const file = `${name}.${extensionOf(url)}`;
  s.busy = true;
  s.error = "";
  try {
    if (s.mode === "local") {
      await download(url, file);
      notice.value = t("studio.save.downloaded", { name: file });
    } else {
      const c = await generator();
      const [saved] = await c.save(s.entry.task.id, folder ? { directory: folder } : {}, [{ index: s.index, name }]);
      const next = [...s.entry.task.saved];
      next[s.index] = saved?.assetId ?? "saved";
      s.entry.task = { ...s.entry.task, saved: next };
      try {
        localStorage.setItem(FOLDER_KEY, folder);
      } catch {}
      notice.value = t("studio.save.saved", { name: file, folder: folder || t("resource.root") });
    }
    saving.value = null;
  } catch (e) {
    s.busy = false;
    s.error =
      e instanceof ApiError && e.code === "name_taken"
        ? t("studio.save.nameTaken")
        : e instanceof ApiError && e.status === 507
          ? t("studio.save.storageFull")
          : e instanceof ApiError && (e.status === 401 || e.status === 403)
            ? t("studio.save.reauth")
            : e instanceof ApiError && e.status === 410
              ? t("studio.save.expired")
              : t("studio.save.failed");
  }
}
/** 下載到這台裝置：抓成 blob 才能指定檔名；跨站讀不到（例如本機開發）就開新分頁，讓人自己存。 */
async function download(url: string, file: string) {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(String(res.status));
    const href = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href, download: file });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

// ── 大圖預覽 ───────────────────────────────────────────
const images = computed(() => entries.value.flatMap((entry) => entry.task.urls.map((url, index) => ({ entry, index, url }))));
const lightbox = ref<number | null>(null);
const shown = computed(() => (lightbox.value === null ? null : images.value[lightbox.value] ?? null));
function openImage(entry: Entry, index: number) {
  lightbox.value = images.value.findIndex((i) => i.entry === entry && i.index === index);
}
function step(d: number) {
  if (lightbox.value === null) return;
  lightbox.value = (lightbox.value + d + images.value.length) % images.value.length;
}
function onLightboxKey(e: KeyboardEvent) {
  if (e.key === "Escape") lightbox.value = null;
  else if (e.key === "ArrowLeft") step(-1);
  else if (e.key === "ArrowRight") step(1);
}
/** 預覽框一打開就拿到焦點，方向鍵與 Esc 才有作用。 */
const vFocus = { mounted: (el: HTMLElement) => el.focus() };
const nameFor = (entry: Entry, index: number) => defaultName(entry.recipe?.prompt, t("studio.save.fallbackName"), index, entry.task.urls.length);
</script>

<template>
  <div class="studio">
    <header class="studio__head">
      <h1>{{ $t("studio.title") }}</h1>
      <p class="subtle">{{ $t("studio.lead") }}</p>
    </header>

    <p v-if="!probed" class="subtle">{{ $t("state.loading") }}</p>
    <div v-else-if="!imageGen" class="notice">{{ $t("resource.gen.unavailable") }}</div>
    <div v-else-if="imageGen.access !== 'ready'" class="notice studio__reauth">
      <p>{{ $t(imageGen.access === "reauth" ? "resource.gen.reauth" : "resource.gen.unavailable") }}</p>
      <button v-if="imageGen.access === 'reauth'" type="button" class="btn btn--primary btn--sm" @click="reauthorize">{{ $t("resource.gen.reauthAction") }}</button>
    </div>
    <p v-else-if="!imageGen.models.length" class="notice">{{ $t("resource.gen.noModels") }}</p>
    <template v-else>
      <StudioComposer ref="composer" :models="imageGen.models" :uploading="uploading" :agent="canPlan" :planning="planning" @submit="submit" @plan="plan" @pick-library="picking = true" @upload="uploadReference" />
      <p v-if="planError" class="notice notice--error studio__notice" role="alert">{{ planError }}</p>
      <StudioAgentPlan
        v-if="agent"
        :summary="agent.summary"
        :credits="agent.credits"
        :shots="agent.shots"
        :estimate="estimate"
        :has-reference="agent.references.length > 0"
        :state="agent.state"
        @remove="agent.shots.splice($event, 1)"
        @run="runPlan"
        @discard="agent = null"
      />
      <p v-if="notice" class="notice studio__notice" role="status">{{ notice }}</p>

      <section class="studio__results" :aria-label="$t('studio.results.title')">
        <div class="studio__results-head">
          <h2>{{ $t("studio.results.title") }}</h2>
          <span class="subtle">{{ $t("studio.results.keep") }}</span>
        </div>
        <p v-if="listError" class="notice notice--error">
          {{ $t("studio.results.loadFailed") }}
          <button type="button" class="btn btn--sm" @click="load">{{ $t("linked.retry") }}</button>
        </p>
        <div v-else-if="!entries.length && !loading" class="studio__empty">
          <p class="studio__empty-title">{{ $t("studio.results.emptyTitle") }}</p>
          <p class="subtle">{{ $t("studio.results.emptyBody") }}</p>
        </div>

        <article v-for="entry in entries" :key="entry.key" class="run">
          <header class="run__meta">
            <span>{{ when(entry.task.createdAt) }}</span>
            <span>{{ modelName(entry.task.model) }}</span>
            <span v-if="entry.task.size">{{ entry.task.size.replace("x", "×") }}</span>
            <span v-if="entry.task.status === 'completed' && entry.task.credits">{{ $t("studio.results.credits", { n: entry.task.credits }) }}</span>
            <span v-if="entry.task.status === 'completed' && entry.task.expiresAt" class="run__expiry">{{ $t("studio.results.expires", { n: daysLeft(entry.task.expiresAt) }) }}</span>
          </header>
          <p v-if="entry.recipe?.prompt || entry.recipe?.skill" class="run__prompt">
            <span v-if="entry.recipe.skill" class="run__skill">/ {{ $t(`studio.skill.${entry.recipe.skill}.name`) }}</span>
            {{ entry.recipe.prompt }}
          </p>

          <div v-if="entry.failure" class="notice notice--error run__error" role="alert">
            <p>{{ $t("resource.gen.error." + entry.failure) }}</p>
            <div class="run__actions">
              <a v-if="entry.failure === 'credits'" class="btn btn--sm" :href="TOP_UP" target="_blank" rel="noopener" @click="track('topup_click')">{{ $t("wallet.topUp") }} ↗</a>
              <button v-else-if="entry.failure === 'reauth'" type="button" class="btn btn--sm" @click="reauthorize">{{ $t("resource.gen.reauthAction") }}</button>
              <button v-else-if="entry.failure === 'interrupted'" type="button" class="btn btn--sm" @click="retry(entry)">{{ $t("resource.gen.resume") }}</button>
              <button v-if="entry.recipe" type="button" class="btn btn--sm btn--ghost" @click="again(entry)">{{ $t("studio.results.again") }}</button>
              <button v-if="!entry.task.id" type="button" class="btn btn--sm btn--ghost" @click="dismiss(entry)">{{ $t("studio.results.dismiss") }}</button>
            </div>
          </div>
          <ul v-else-if="running(entry.task)" class="run__grid" :aria-busy="true">
            <li v-for="n in entry.input?.n ?? 1" :key="n" class="shot shot--pending">
              <span class="shot__spinner" aria-hidden="true" />
              <span class="subtle">{{ $t("studio.results.running") }}</span>
            </li>
          </ul>
          <p v-else-if="!entry.task.urls.length" class="subtle">{{ $t("studio.results.gone") }}</p>
          <ul v-else class="run__grid">
            <li v-for="(url, i) in entry.task.urls" :key="url" class="shot">
              <button type="button" class="shot__open" :aria-label="$t('studio.image.open', { n: i + 1 })" @click="openImage(entry, i)">
                <img :src="url" alt="" loading="lazy" />
              </button>
              <span v-if="entry.task.saved[i]" class="shot__badge">{{ $t("studio.image.saved") }}</span>
              <div class="shot__bar">
                <button type="button" class="btn btn--sm" :disabled="!!entry.task.saved[i]" @click="openSave(entry, i, 'library')">{{ $t("studio.image.toLibrary") }}</button>
                <button type="button" class="btn btn--sm" @click="openSave(entry, i, 'local')">{{ $t("studio.image.download") }}</button>
                <button type="button" class="btn btn--sm btn--ghost" @click="useAsReference(url)">{{ $t("studio.image.reference") }}</button>
              </div>
            </li>
          </ul>

          <div v-if="entry.task.urls.length && entry.recipe" class="run__actions">
            <button type="button" class="btn btn--sm btn--ghost" @click="again(entry)">{{ $t("studio.results.again") }}</button>
            <button v-if="entry.recipe.prompt" type="button" class="btn btn--sm btn--ghost" @click="copyPrompt(entry)">{{ $t("studio.results.copy") }}</button>
          </div>
        </article>
        <p v-if="loading" class="subtle">{{ $t("state.loading") }}</p>
      </section>
    </template>

    <LibraryPicker v-if="picking" @pick="useAsReference" @close="picking = false" />
    <StudioSaveDialog
      v-if="saving"
      :mode="saving.mode"
      :image="saving.entry.task.urls[saving.index]!"
      :name="nameFor(saving.entry, saving.index)"
      :ext="extensionOf(saving.entry.task.urls[saving.index]!)"
      :folders="folders"
      :folder="saveFolder"
      :busy="saving.busy"
      :error="saving.error"
      @confirm="confirmSave"
      @close="saving = null"
    />
    <Teleport to="body">
      <div v-if="shown" class="lightbox" role="dialog" aria-modal="true" :aria-label="$t('studio.image.preview')" tabindex="-1" @keydown="onLightboxKey" @click.self="lightbox = null" v-focus>
        <img :src="shown.url" alt="" class="lightbox__img" />
        <button v-if="images.length > 1" type="button" class="lightbox__nav lightbox__nav--prev" :aria-label="$t('studio.image.previous')" @click="step(-1)">‹</button>
        <button v-if="images.length > 1" type="button" class="lightbox__nav lightbox__nav--next" :aria-label="$t('studio.image.next')" @click="step(1)">›</button>
        <div class="lightbox__bar">
          <button type="button" class="btn btn--sm" :disabled="!!shown.entry.task.saved[shown.index]" @click="openSave(shown.entry, shown.index, 'library')">{{ $t("studio.image.toLibrary") }}</button>
          <button type="button" class="btn btn--sm" @click="openSave(shown.entry, shown.index, 'local')">{{ $t("studio.image.download") }}</button>
          <button type="button" class="btn btn--sm" @click="useAsReference(shown.url)">{{ $t("studio.image.reference") }}</button>
          <button type="button" class="btn btn--sm btn--ghost" @click="lightbox = null">{{ $t("dialog.close") }}</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.studio { display: grid; gap: var(--s-5); max-width: 1080px; margin: 0 auto; padding: var(--s-5) var(--s-4) var(--s-7); }
.studio__head h1 { margin: 0 0 var(--s-1); font-size: 22px; }
.studio__head p { margin: 0; font-size: 14px; }
.studio__reauth { display: grid; gap: var(--s-2); justify-items: start; }
.studio__reauth p { margin: 0; }
.studio__notice { margin: 0; }
.studio__results { display: grid; gap: var(--s-4); }
.studio__results-head { display: flex; align-items: baseline; gap: var(--s-3); flex-wrap: wrap; }
.studio__results-head h2 { margin: 0; font-size: 17px; }
.studio__empty { padding: var(--s-6) var(--s-4); text-align: center; border: 1px dashed var(--line-strong); border-radius: var(--r-lg); }
.studio__empty p { margin: 0; }
.studio__empty-title { font-weight: 600; margin-bottom: var(--s-1) !important; }
.run { display: grid; gap: var(--s-2); padding-bottom: var(--s-4); border-bottom: 1px solid var(--line); }
.run__meta { display: flex; flex-wrap: wrap; gap: var(--s-1) var(--s-3); font-size: 12.5px; color: var(--text-3); }
.run__expiry { color: var(--warning-text); }
.run__prompt { margin: 0; font-size: 14px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.run__skill { color: var(--accent-text); font-weight: 600; margin-right: var(--s-1); }
.run__error { display: grid; gap: var(--s-2); margin: 0; }
.run__error p { margin: 0; }
.run__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.run__grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--s-3); }
.shot { position: relative; display: grid; gap: var(--s-2); align-content: start; }
.shot__open { display: block; width: 100%; padding: 0; border: 0; border-radius: var(--r-md); overflow: hidden; background: var(--surface-2); box-shadow: 0 0 0 1px var(--line); cursor: zoom-in; }
.shot__open:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--accent); }
.shot__open img { display: block; width: 100%; height: 280px; object-fit: contain; }
.shot--pending { place-items: center; align-content: center; height: 280px; border-radius: var(--r-md); background: var(--surface-2); box-shadow: 0 0 0 1px var(--line); text-align: center; padding: var(--s-3); }
.shot__spinner { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--line-strong); border-top-color: var(--accent); animation: spin 0.9s linear infinite; }
.shot__badge { position: absolute; top: var(--s-2); left: var(--s-2); padding: 2px var(--s-2); border-radius: var(--r-pill); background: var(--success); color: #fff; font-size: 12px; font-weight: 600; }
.shot__bar { display: flex; flex-wrap: wrap; gap: var(--s-1); }
@keyframes spin { to { transform: rotate(360deg); } }
.lightbox { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: var(--s-6) var(--s-7) 96px; background: rgba(8, 8, 12, 0.88); outline: none; }
.lightbox__img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: var(--r-md); }
.lightbox__nav { position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border-radius: 50%; border: 0; background: rgba(255, 255, 255, 0.14); color: #fff; font-size: 26px; cursor: pointer; }
.lightbox__nav--prev { left: var(--s-4); }
.lightbox__nav--next { right: var(--s-4); }
.lightbox__bar { position: absolute; bottom: var(--s-5); left: 50%; transform: translateX(-50%); display: flex; flex-wrap: wrap; justify-content: center; gap: var(--s-2); width: max-content; max-width: calc(100vw - 32px); }
@media (max-width: 640px) {
  .studio { padding: var(--s-4) var(--s-4) var(--s-7); gap: var(--s-4); }
  .run__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-2); }
  .shot__open img, .shot--pending { height: 200px; }
  .shot__bar .btn { flex: 1 1 auto; padding: 0 var(--s-2); }
  .lightbox { padding: var(--s-5) var(--s-3) 140px; }
  .lightbox__nav { display: none; }
}
@media (prefers-reduced-motion: reduce) { .shot__spinner { animation: none; } }
</style>
