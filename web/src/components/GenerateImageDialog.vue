<script setup lang="ts">
/**
 * 卡片編輯器的「生成」：寫描述、選模型尺寸張數，用登入身分生成；結果先給作者看，挑一張才存進這張卡的資料夾並填進欄位。
 * 沒挑的留在生圖頁的快取區 7 天（生成的圖不再自動進資源庫）。生圖頁本身用的是 StudioComposer，這裡是欄位旁的快捷版。
 * 生成要 30–90 秒：關掉框（v-show 收起）不會中斷，頁面等它結束才卸下這個元件。
 * 同一次生成沿用同一個 Idempotency-Key：連線斷掉重送不會多扣；伺服器明確回應之後才換新的。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ApiError } from "@/lib/api";
import type { GenerationClient, GenerationModel, GenerationTask, SaveTarget } from "@/lib/media-generation";
import { wrapTab } from "@/lib/focus-trap";
import { fitSize } from "@/lib/studio";
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
}>();
const emit = defineEmits<{ close: []; reauth: []; running: [boolean]; saved: [url: string, folder: string]; kept: [] }>();

const PROMPT_MAX = 4000;
const TOP_UP = "https://console.harperharbor.com/me/billing";
const prompt = ref(props.initialPrompt ?? "");
const modelId = ref(props.models[0]?.id ?? "");
const model = computed(() => props.models.find((m) => m.id === modelId.value));
const fit = (sizes: string[]) => (props.shape ? fitSize(sizes, props.shape) : sizes[0] ?? "");
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
const running = computed(() => phase.value !== "idle");
watch(running, (v) => emit("running", v));
// 一次生成的身分：key 送出前就定好；task 拿到任務才有。
let key = "", task: GenerationTask | null = null;
let disposed = false;
/** 任務建了還沒拿到結果（連線中斷）：表單不能改，按鈕是「繼續」，不會再生成一次。 */
const pending = ref(false);
/** 生成好了、等作者挑的幾張（Harbor 快取的網址）。 */
const choices = ref<string[]>([]);

function failureOf(e: unknown): Failure {
  // 連線斷掉：任務可能已經建了，不能說「沒扣點」；用同一把 key 再送一次會拿回同一個任務。
  if (!(e instanceof ApiError)) return "interrupted";
  if (e.status === 401 || e.status === 403) return "reauth";
  if (e.status === 402) return "credits";
  if (e.status === 400 && e.code === "content_policy_violation") return "policy";
  if (e.status === 507) return "storage";
  return task ? "interrupted" : "failed";
}

async function submit() {
  if (running.value || props.access !== "ready") return;
  if (!pending.value && (!model.value || !prompt.value.trim() || !size.value)) return;
  failure.value = null;
  phase.value = "running";
  if (!pending.value) key ||= crypto.randomUUID();
  try {
    const c = await props.client();
    if (!task) {
      try {
        task = await c.create({ model: model.value!.id, prompt: prompt.value.trim(), size: size.value, n: count.value }, key);
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
    pending.value = false;
    if (task.status === "failed") {
      failure.value = task.code === "content_policy_violation" ? "policy" : "failed";
      task = null;
      return;
    }
    choices.value = task.urls;
  } catch (e) {
    failure.value = failureOf(e);
    if (failure.value !== "interrupted") {
      task = null;
      pending.value = false;
    }
  } finally {
    phase.value = "idle";
  }
}

/** 挑中一張：只存這一張進卡片資料夾，拿回資源庫網址填進欄位；其餘留在快取區。 */
async function choose(index: number) {
  if (!task || running.value) return;
  failure.value = null;
  phase.value = "saving";
  try {
    const [saved] = await (await props.client()).save(task.id, props.target, [{ index }]);
    track("studio_pick_into_field");
    task = null;
    choices.value = [];
    prompt.value = "";
    emit("saved", saved?.url ?? "", props.folder);
  } catch (e) {
    failure.value = failureOf(e) === "interrupted" ? "save" : failureOf(e);
  } finally {
    phase.value = "idle";
  }
}
/** 先不填：結果留在生圖頁。關掉框在挑圖時也是這個意思。 */
function keep() {
  task = null;
  choices.value = [];
  emit("kept");
}
function dismiss() {
  if (running.value && phase.value === "saving") return;
  if (choices.value.length) keep();
  else emit("close");
}
watch(choices, async (list) => {
  if (!list.length) return;
  await nextTick();
  box.value?.querySelector<HTMLElement>(".gen__choice")?.focus();
});

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
  document.removeEventListener("keydown", onKey);
});
const action = computed(() => (failure.value === "interrupted" ? "resource.gen.resume" : "resource.gen.submit"));
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
        <p v-else-if="!models.length" class="subtle">{{ $t("resource.gen.noModels") }}</p>
        <template v-else-if="choices.length">
          <p class="subtle gen__note">{{ $t("resource.gen.choose", { folder }) }}</p>
          <ul class="gen__choices">
            <li v-for="(u, i) in choices" :key="u">
              <button type="button" class="gen__choice" :disabled="running" :aria-label="$t('resource.gen.chooseOne', { n: i + 1 })" @click="choose(i)">
                <img :src="u" alt="" />
              </button>
            </li>
          </ul>
          <p v-if="phase === 'saving'" class="notice gen__progress" role="status">
            <span class="gen__spinner" aria-hidden="true" />{{ $t("resource.gen.saving", { folder }) }}
          </p>
          <div v-if="failure" class="notice notice--error gen__error" role="alert">
            <p>{{ $t("resource.gen.error." + failure) }}</p>
            <button v-if="failure === 'reauth'" type="button" class="btn btn--sm" @click="emit('reauth')">{{ $t("resource.gen.reauthAction") }}</button>
          </div>
          <div class="modal__actions">
            <button type="button" class="btn" :disabled="running" @click="keep">{{ $t("resource.gen.chooseNone") }}</button>
          </div>
        </template>
        <template v-else>
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
              <option v-for="m in models" :key="m.id" :value="m.id">
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
            {{ $t(model && model.priced > 1 ? "resource.gen.costFrom" : "resource.gen.cost", { n: cost }) }}
          </p>
          <p v-if="phase === 'running'" class="notice gen__progress" role="status">
            <span class="gen__spinner" aria-hidden="true" />{{ $t("resource.gen.running") }}
          </p>
          <div v-if="failure" class="notice notice--error gen__error" role="alert">
            <p>{{ $t("resource.gen.error." + failure) }}</p>
            <a v-if="failure === 'credits'" class="btn btn--sm" :href="TOP_UP" target="_blank" rel="noopener" @click="track('topup_click')">
              {{ $t("wallet.topUp") }} ↗
            </a>
            <button v-else-if="failure === 'reauth'" type="button" class="btn btn--sm" @click="emit('reauth')">
              {{ $t("resource.gen.reauthAction") }}
            </button>
          </div>
          <div class="modal__actions">
            <button type="button" class="btn" @click="dismiss">
              {{ $t(running ? "resource.gen.background" : "dialog.cancel") }}
            </button>
            <button type="submit" class="btn btn--primary" :disabled="running || (!pending && !prompt.trim())">
              {{ $t(action) }}
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
.gen__progress { display: flex; align-items: center; gap: var(--s-2); margin: 0; }
.gen__spinner {
  width: 16px; height: 16px; flex: none; border-radius: 50%;
  border: 2px solid var(--line); border-top-color: var(--accent);
  animation: gen-spin 0.9s linear infinite;
}
@keyframes gen-spin { to { transform: rotate(360deg); } }
.gen__error { display: grid; gap: var(--s-2); justify-items: start; margin: 0; }
.gen__error p { margin: 0; }
.gen__choices { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-2); }
.gen__choice {
  display: block; width: 100%; padding: 0; border: 0; border-radius: var(--r-md); overflow: hidden;
  background: var(--surface-2); box-shadow: 0 0 0 1px var(--line); cursor: pointer;
  transition: box-shadow var(--dur) var(--ease);
}
.gen__choice:hover:not(:disabled), .gen__choice:focus-visible { box-shadow: 0 0 0 2px var(--accent); outline: none; }
.gen__choice img { display: block; width: 100%; height: auto; max-height: 40vh; object-fit: contain; }
</style>
