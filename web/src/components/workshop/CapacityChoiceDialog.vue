<script setup lang="ts">
/**
 * 開始對話時放不下（原卡＋啟用中擴充的常駐總量超過目前的上下文）：不硬擋，三選一（ui.md §3.4b、§4.3.4）。
 *   1. 換成建議檔位（推薦）：先存設定，存好才開始
 *   2. 關掉部分擴充：回到管理
 *   3. 照樣開始：清單最上面的擴充，常駐改成關鍵詞命中才帶進對話（面板會一直標示）
 * 只在放不下時出現；低於建議但放得下時開始對話仍是一鍵。選項是整列可點的卡；「取消」是預設焦點。
 * 沒有建議檔位（最高一檔也放不下）時不給第一項。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { wrapTab } from "@/lib/focus-trap";
import { tierLabel, type UsageSummary } from "@/lib/workshop";

const props = defineProps<{ usage: UsageSummary; busy?: boolean; error?: string }>();
const emit = defineEmits<{ close: []; choose: ["switch" | "manage" | "go"] }>();
const { locale } = useI18n();
const box = ref<HTMLElement | null>(null);
const rec = computed(() => tierLabel(props.usage.recommendedContextTokens));
const cur = computed(() => tierLabel(props.usage.currentContextTokens));
const total = computed(() => new Intl.NumberFormat(locale.value).format(props.usage.totalConstantChars));

let restore: HTMLElement | null = null;
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); emit("close"); return; }
  wrapTab(e, box.value);
}
onMounted(async () => {
  restore = document.activeElement as HTMLElement | null;
  document.addEventListener("keydown", onKey);
  await nextTick();
  box.value?.querySelector<HTMLElement>("[data-cancel]")?.focus();
});
onBeforeUnmount(() => { document.removeEventListener("keydown", onKey); restore?.focus?.(); });
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <section ref="box" class="modal panel ws-cap" role="dialog" aria-modal="true" aria-labelledby="ws-cap-title" aria-describedby="ws-cap-body">
        <h2 id="ws-cap-title" class="modal__title">{{ $t("workshop.capacity.title") }}</h2>
        <p id="ws-cap-body" class="ws-cap__body ws-text">{{ $t("workshop.capacity.body", { total, tier: cur }) }}</p>
        <div class="ws-cap__opts">
          <button v-if="rec" type="button" class="ws-opt ws-opt--rec" :disabled="busy" @click="emit('choose', 'switch')">
            <strong>{{ $t("workshop.capacity.opt.switch", { tier: rec }) }}</strong>
            <span class="ws-text">{{ $t("workshop.capacity.opt.switch.desc", { tier: rec }) }}</span>
          </button>
          <button type="button" class="ws-opt" :disabled="busy" @click="emit('choose', 'manage')">
            <strong>{{ $t("workshop.capacity.opt.manage") }}</strong>
            <span class="ws-text">{{ $t("workshop.capacity.opt.manage.desc") }}</span>
          </button>
          <button type="button" class="ws-opt" :disabled="busy" @click="emit('choose', 'go')">
            <strong>{{ $t("workshop.capacity.opt.go") }}</strong>
            <span class="ws-text">{{ $t("workshop.capacity.opt.go.desc") }}</span>
          </button>
        </div>
        <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
        <div class="modal__actions">
          <button type="button" class="btn" data-cancel @click="emit('close')">{{ $t("workshop.capacity.cancel") }}</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.ws-cap__body { margin: 0; font-size: 14px; color: var(--text-2); line-height: 1.6; }
.ws-cap__opts { display: grid; gap: var(--s-2); }
.ws-opt {
  display: grid; gap: 4px; width: 100%; padding: var(--s-3) var(--s-4); text-align: start;
  border: 1px solid var(--border-strong); border-radius: var(--r-md); background: var(--surface); color: var(--text);
  font: inherit; cursor: pointer; transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.ws-opt:hover { border-color: var(--accent); }
.ws-opt strong { font-size: 15px; }
.ws-opt span { font-size: 12.5px; color: var(--text-2); line-height: 1.5; }
.ws-opt--rec { border-color: var(--accent); background: var(--accent-tint); }
.ws-opt:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
