<script setup lang="ts">
/**
 * 「生成圖片」：寫描述、選模型尺寸張數，用登入身分生成，成功就放進指定的資料夾。
 * 資源頁存進正在看的資料夾；卡片編輯器存進這張卡的資料夾，按欄位預選直式或橫式，存好直接填進欄位。
 * 生成要 30–90 秒：關掉框（v-show 收起）不會中斷，頁面等它存好才卸下這個元件。
 * 還在生成或還沒存好時離開這一頁（站內換頁、重新整理、關分頁）先問一聲：離開就拿不回結果，點數照樣可能扣。
 * select 時一次生成好幾張：存好後讓作者挑一張填進欄位，其餘留在資料夾。
 * 同一次生成沿用同一個 Idempotency-Key：連線斷掉重送不會多扣；伺服器明確回應之後才換新的。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { onBeforeRouteLeave } from "vue-router";
import { ApiError } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm";
import type { GenerationClient, GenerationModel, GenerationTask, SaveTarget } from "@/lib/media-generation";
import { wrapTab } from "@/lib/focus-trap";
import { track } from "@/lib/track";

const props = defineProps<{
  open: boolean;
  /** ready：可以生成；reauth：這次登入沒有生圖授權；unavailable：重新授權過還是沒有。 */
  access: "ready" | "reauth" | "unavailable";
  models: GenerationModel[];
  client: () => Promise<GenerationClient>;
  target: SaveTarget;
  folder: string;
  /** 預選最接近 9:16（tall）或 16:9（wide）的尺寸；不給就用模型的第一個。 */
  shape?: "tall" | "wide";
  /** 描述的起點，作者可以改。 */
  initialPrompt?: string;
  /** 存好之後查出資源庫網址，跟著 saved 送出（編輯器要填進欄位）。 */
  select?: boolean;
  /** 參考圖（資源庫裡的網址）：同一個角色照它畫；有參考圖時只列收參考圖的模型。 */
  reference?: string;
}>();
const emit = defineEmits<{ close: []; reauth: []; running: [boolean]; saved: [count: number, folder: string, urls: string[]] }>();
const { t } = useI18n();

const PROMPT_MAX = 4000;
const TOP_UP = "https://console.harperharbor.com/me/billing";
const prompt = ref(props.initialPrompt ?? "");
const reference = ref(props.reference ?? "");
const usable = computed(() => (reference.value ? props.models.filter((m) => m.maxReferences > 0) : props.models));
const modelId = ref(usable.value[0]?.id ?? "");
const model = computed(() => usable.value.find((m) => m.id === modelId.value));
watch(usable, (list) => {
  if (!list.some((m) => m.id === modelId.value)) modelId.value = list[0]?.id ?? "";
});
function fit(sizes: string[]) {
  if (!props.shape) return sizes[0] ?? "";
  const target = props.shape === "tall" ? 9 / 16 : 16 / 9;
  // 「1024x1536」的寬高比離目標多遠（取對數，太寬太窄一樣算）；認不出的尺寸當正方形
  const off = (s: string) => {
    const [w, h] = s.split("x").map(Number);
    return Math.abs(Math.log((w! / h! || 1) / target));
  };
  return sizes.reduce((best, s) => (off(s) < off(best) ? s : best), sizes[0] ?? "");
}
const size = ref(fit(model.value?.sizes ?? []));
const count = ref(1);
watch(model, (m) => {
  if (!m) return;
  if (!m.sizes.includes(size.value)) size.value = fit(m.sizes);
  count.value = Math.min(count.value, m.maxImages);
});
const cost = computed(() => (model.value ? model.value.credits * count.value : 0));

type Failure = "reauth" | "credits" | "policy" | "storage" | "save" | "interrupted" | "failed";
const phase = ref<"idle" | "running" | "saving">("idle");
const failure = ref<Failure | null>(null);
const results = ref<string[]>([]);
const running = computed(() => phase.value !== "idle");
watch(running, (v) => emit("running", v));
// 一次生成的身分：key 送出前就定好；task 拿到任務才有；saved 前的目標與資料夾名在送出時定住。
let key = "", task: GenerationTask | null = null, savedTo: { target: SaveTarget; folder: string } | null = null;
let disposed = false;
/** 生成成功但還沒存好、或任務還在跑：表單不能改，按鈕是「繼續／重新保存」，不會再生成一次。 */
const pending = ref(false);

function failureOf(e: unknown): Failure {
  // 連線斷掉：任務可能已經建了，不能說「沒扣點」；用同一把 key 再送一次會拿回同一個任務。
  if (!(e instanceof ApiError)) return "interrupted";
  if (e.status === 401 || e.status === 403) return "reauth";
  if (e.status === 402) return "credits";
  if (e.status === 400 && e.code === "content_policy_violation") return "policy";
  if (e.status === 507) return "storage";
  // 任務已經建了還在跑時查詢出錯，結果可能照樣出來（也照樣扣點）：繼續查同一個，不重新生成。
  return task?.status === "completed" ? "save" : task ? "interrupted" : "failed";
}

async function submit() {
  if (running.value || props.access !== "ready") return;
  if (!pending.value && (!model.value || !prompt.value.trim() || !size.value)) return;
  failure.value = null;
  phase.value = "running";
  if (!pending.value) {
    key ||= crypto.randomUUID();
    savedTo = { target: props.target, folder: props.folder };
  }
  try {
    const c = await props.client();
    if (!task) {
      try {
        const images = reference.value ? { images: [reference.value] } : {};
        task = await c.create({ model: model.value!.id, prompt: prompt.value.trim(), size: size.value, n: count.value, ...images }, key);
      } catch (e) {
        // 伺服器回了話（拒絕、點數不夠）這把 key 就用完了；連線斷掉才留著重送。
        if (e instanceof ApiError) key = "";
        throw e;
      }
      key = "";
      pending.value = true;
    }
    if (task.status !== "completed") task = await c.wait(task, () => disposed);
    if (disposed) return;
    if (task.status === "failed") {
      const code = task.code;
      task = null;
      pending.value = false;
      failure.value = code === "content_policy_violation" ? "policy" : "failed";
      return;
    }
    results.value = task.urls;
    phase.value = "saving";
    const ids = await c.save(task.id, savedTo!.target);
    // 查網址失敗就跟存檔失敗一樣重試：save 是冪等的，回同一批檔案
    const urls = props.select ? await c.savedUrls(task.id, ids) : [];
    const n = task.urls.length || count.value;
    task = null;
    pending.value = false;
    results.value = [];
    prompt.value = "";
    if (urls.length > 1) {
      choices.value = urls;
      chosenFor = { n, folder: savedTo!.folder };
      return;
    }
    emit("saved", n, savedTo!.folder, urls);
  } catch (e) {
    failure.value = failureOf(e);
    if (failure.value === "failed") {
      task = null;
      pending.value = false;
    } else if (failure.value === "interrupted") pending.value = true;
  } finally {
    phase.value = "idle";
  }
}

// 好幾張存好了：挑一張填進欄位，或都先不填（都已經在資料夾裡）
const choices = ref<string[]>([]);
let chosenFor: { n: number; folder: string } | null = null;
function choose(url: string | null) {
  const done = chosenFor!;
  choices.value = [];
  chosenFor = null;
  emit("saved", done.n, done.folder, url ? [url] : []);
}
/** 關掉框：在挑圖時等於「先不填」，不然挑圖的機會就跟著元件一起沒了。 */
function dismiss() {
  if (choices.value.length) choose(null);
  else emit("close");
}
watch(choices, async (list) => {
  if (!list.length) return;
  await nextTick();
  box.value?.querySelector<HTMLElement>(".gen__choice")?.focus();
});

// 結果還沒進資料夾（生成中、存檔失敗、連線中斷）時離開，任務照跑、點數照扣，畫面卻再也接不回來。
const unsaved = computed(() => running.value || pending.value);
const onUnload = (e: BeforeUnloadEvent) => {
  if (unsaved.value) e.preventDefault();
};
window.addEventListener("beforeunload", onUnload);
onBeforeRouteLeave(() => !unsaved.value || confirmDialog({ message: t("resource.gen.leave"), confirmText: t("dialog.leave"), danger: true }));

const box = ref<HTMLElement | null>(null);
const field = ref<HTMLTextAreaElement | null>(null);
let restore: HTMLElement | null = null;
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); dismiss(); return; }
  wrapTab(e, box.value, "a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)");
}
watch(
  () => props.open,
  async (open) => {
    if (open) {
      restore = document.activeElement as HTMLElement | null;
      document.addEventListener("keydown", onKey);
      await nextTick();
      (field.value ?? box.value?.querySelector<HTMLElement>("button"))?.focus();
    } else {
      document.removeEventListener("keydown", onKey);
      restore?.focus?.();
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  window.removeEventListener("beforeunload", onUnload);
  document.removeEventListener("keydown", onKey);
});
const action = computed(() =>
  failure.value === "storage" || failure.value === "save"
    ? t("resource.gen.retrySave")
    : failure.value === "interrupted"
      ? t("resource.gen.resume")
      : t("resource.gen.submit"),
);
</script>

<template>
  <Teleport to="body">
    <div v-show="open" class="modal-backdrop" @click.self="dismiss">
      <form
        ref="box"
        class="modal panel gen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gen-title"
        @submit.prevent="submit"
      >
        <h2 id="gen-title" class="modal__title">{{ $t("resource.gen.title") }}</h2>
        <template v-if="access !== 'ready'">
          <p class="subtle">{{ $t(access === "reauth" ? "resource.gen.reauth" : "resource.gen.unavailable") }}</p>
          <div class="modal__actions">
            <button type="button" class="btn" @click="emit('close')">{{ $t("dialog.cancel") }}</button>
            <button v-if="access === 'reauth'" type="button" class="btn btn--primary" @click="emit('reauth')">
              {{ $t("resource.gen.reauthAction") }}
            </button>
          </div>
        </template>
        <p v-else-if="!usable.length" class="subtle">{{ $t("resource.gen.noModels") }}</p>
        <template v-else-if="choices.length">
          <p class="subtle gen__note">{{ $t("resource.gen.choose", { folder: chosenFor?.folder ?? folder }) }}</p>
          <ul class="gen__choices">
            <li v-for="(u, i) in choices" :key="u">
              <button type="button" class="gen__choice" :aria-label="$t('resource.gen.chooseOne', { n: i + 1 })" @click="choose(u)">
                <img :src="u" alt="" />
              </button>
            </li>
          </ul>
          <div class="modal__actions">
            <button type="button" class="btn" @click="choose(null)">{{ $t("resource.gen.chooseNone") }}</button>
          </div>
        </template>
        <template v-else>
          <div v-if="reference" class="gen__reference">
            <img :src="reference" alt="" />
            <p class="subtle">{{ $t("resource.gen.reference") }}</p>
            <button type="button" class="btn btn--sm btn--ghost" :disabled="running || pending" @click="reference = ''">
              {{ $t("resource.gen.dropReference") }}
            </button>
          </div>
          <label class="gen__field">
            <span>{{ $t("resource.gen.prompt") }}</span>
            <textarea
              ref="field"
              v-model="prompt"
              class="input"
              rows="4"
              autocomplete="off"
              :maxlength="PROMPT_MAX"
              :disabled="running || pending"
              :placeholder="$t('resource.gen.promptHint')"
            />
          </label>
          <label class="gen__field">
            <span>{{ $t("resource.gen.model") }}</span>
            <select v-model="modelId" class="input" :disabled="running || pending">
              <option v-for="m in usable" :key="m.id" :value="m.id">
                {{ $t(m.laneName ? (m.priced > 1 ? "resource.gen.modelLaneFrom" : "resource.gen.modelLanePrice") : m.priced > 1 ? "resource.gen.modelFrom" : "resource.gen.modelPrice", { name: m.name, lane: m.laneName, n: m.credits }) }}
              </option>
            </select>
          </label>
          <div class="gen__row">
            <label class="gen__field">
              <span>{{ $t("resource.gen.size") }}</span>
              <select v-model="size" class="input" :disabled="running || pending">
                <option v-for="s in model?.sizes ?? []" :key="s" :value="s">{{ s.replace("x", " × ") }}</option>
              </select>
            </label>
            <label class="gen__field">
              <span>{{ $t("resource.gen.count") }}</span>
              <select v-model.number="count" class="input" :disabled="running || pending">
                <option v-for="n in model?.maxImages ?? 1" :key="n" :value="n">{{ n }}</option>
              </select>
            </label>
          </div>
          <p class="subtle gen__note">
            {{ $t(model && model.priced > 1 ? "resource.gen.costFrom" : "resource.gen.cost", { n: cost, folder }) }}
          </p>
          <p v-if="phase === 'running'" class="notice gen__progress" role="status">
            <span class="gen__spinner" aria-hidden="true" />{{ $t("resource.gen.running") }}
          </p>
          <p v-else-if="phase === 'saving'" class="notice gen__progress" role="status">
            <span class="gen__spinner" aria-hidden="true" />{{ $t("resource.gen.saving", { folder: savedTo?.folder ?? folder }) }}
          </p>
          <div v-if="failure" class="notice notice--error gen__error" role="alert">
            <p>{{ $t("resource.gen.error." + failure) }}</p>
            <a v-if="failure === 'credits'" class="btn btn--sm" :href="TOP_UP" target="_blank" rel="noopener" @click="track('topup_click')">
              {{ $t("wallet.topUp") }} ↗
            </a>
            <button v-else-if="failure === 'reauth'" type="button" class="btn btn--sm" @click="emit('reauth')">
              {{ $t("resource.gen.reauthAction") }}
            </button>
            <span v-if="failure === 'storage' && results.length" class="gen__links">
              <a v-for="(u, i) in results" :key="u" :href="u" target="_blank" rel="noopener">{{ $t("resource.gen.download", { n: i + 1 }) }}</a>
            </span>
          </div>
          <div class="modal__actions">
            <button type="button" class="btn" @click="dismiss">
              {{ $t(running ? "resource.gen.background" : "dialog.cancel") }}
            </button>
            <button type="submit" class="btn btn--primary" :disabled="running || (!pending && !prompt.trim())">
              {{ action }}
            </button>
          </div>
        </template>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.gen { width: min(480px, 100%); }
.gen__field { display: grid; gap: 6px; min-width: 0; font-size: 13px; font-weight: 600; }
.gen__field .input { font-weight: 400; }
.gen__row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--s-3); }
.gen__note { margin: 0; font-size: 13px; }
.gen__reference { display: grid; grid-template-columns: 56px minmax(0, 1fr); align-items: center; gap: var(--s-2) var(--s-3); }
.gen__reference img { grid-row: span 2; width: 56px; height: 56px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); }
.gen__reference p { margin: 0; font-size: 13px; }
.gen__reference .btn { justify-self: start; }
.gen__progress { display: flex; align-items: center; gap: var(--s-2); margin: 0; }
.gen__spinner {
  width: 16px; height: 16px; flex: none; border-radius: 50%;
  border: 2px solid var(--line); border-top-color: var(--accent);
  animation: gen-spin 0.9s linear infinite;
}
@keyframes gen-spin { to { transform: rotate(360deg); } }
.gen__error { display: grid; gap: var(--s-2); justify-items: start; margin: 0; }
.gen__error p { margin: 0; }
.gen__links { display: flex; flex-wrap: wrap; gap: var(--s-3); }
.gen__choices { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-2); }
.gen__choice {
  display: block; width: 100%; padding: 0; border: 0; border-radius: var(--r-md); overflow: hidden;
  background: var(--surface-2); box-shadow: 0 0 0 1px var(--line); cursor: pointer;
  transition: box-shadow var(--dur) var(--ease);
}
.gen__choice:hover, .gen__choice:focus-visible { box-shadow: 0 0 0 2px var(--accent); outline: none; }
.gen__choice img { display: block; width: 100%; height: auto; max-height: 40vh; object-fit: contain; }
</style>
