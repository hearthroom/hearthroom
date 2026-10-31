<script setup lang="ts">
/**
 * 存一張生成的圖：放進資源庫（選資料夾、取名字）或下載到這台裝置（取檔名）。
 * 名字預填描述的開頭，作者可以改；副檔名照圖片格式自動接上，不用打。
 * 實際存檔由頁面做：這裡只收名字與位置，忙碌與錯誤由頁面傳回來。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { LibraryFolder } from "@/lib/api";
import { wrapTab } from "@/lib/focus-trap";
import { cleanName } from "@/lib/studio";

const props = defineProps<{
  mode: "library" | "local";
  image: string;
  name: string;
  ext: string;
  folders: LibraryFolder[];
  folder: string;
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{ confirm: [name: string, folder: string]; close: [] }>();

const name = ref(props.name);
// 預設的資料夾可能還不存在（例如卡名資料夾）：照樣列出來，存的時候伺服器會建。資料夾清單晚到也不會蓋掉它。
const folder = ref(props.folder);
const options = computed(() => [...new Set([...props.folders.map((f) => f.name), ...(props.folder ? [props.folder] : [])])]);
const box = ref<HTMLFormElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
let restore: HTMLElement | null = null;

function submit() {
  const n = cleanName(name.value);
  if (!n || props.busy) return;
  emit("confirm", n, folder.value);
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); if (!props.busy) emit("close"); return; }
  wrapTab(e, box.value, "button:not(:disabled), input:not(:disabled), select:not(:disabled)");
}
onMounted(async () => {
  restore = document.activeElement as HTMLElement | null;
  document.addEventListener("keydown", onKey);
  await nextTick();
  input.value?.focus();
  input.value?.select();
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKey);
  restore?.focus?.();
});
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="!busy && emit('close')">
      <form ref="box" class="modal panel save" role="dialog" aria-modal="true" aria-labelledby="studio-save-title" @submit.prevent="submit">
        <h2 id="studio-save-title" class="modal__title">{{ $t(mode === "library" ? "studio.save.libraryTitle" : "studio.save.localTitle") }}</h2>
        <img class="save__img" :src="image" alt="" />
        <label class="save__field">
          <span>{{ $t("studio.save.name") }}</span>
          <span class="save__name">
            <input ref="input" v-model="name" class="input" maxlength="120" autocomplete="off" :disabled="busy" />
            <span class="subtle">.{{ ext }}</span>
          </span>
        </label>
        <label v-if="mode === 'library'" class="save__field">
          <span>{{ $t("studio.save.folder") }}</span>
          <select v-model="folder" class="input" :disabled="busy">
            <option value="">{{ $t("resource.root") }}</option>
            <option v-for="f in options" :key="f" :value="f">{{ f }}</option>
          </select>
        </label>
        <p v-if="error" class="notice notice--error save__error" role="alert">{{ error }}</p>
        <div class="modal__actions">
          <button type="button" class="btn" :disabled="busy" @click="emit('close')">{{ $t("dialog.cancel") }}</button>
          <button type="submit" class="btn btn--primary" :disabled="busy || !cleanName(name)" :aria-busy="busy">
            {{ $t(mode === "library" ? "studio.save.toLibrary" : "studio.save.download") }}
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.save { width: min(420px, 100%); }
.save__img { display: block; width: 100%; max-height: 36vh; object-fit: contain; border-radius: var(--r-md); background: var(--surface-2); }
.save__field { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
.save__field .input { font-weight: 400; }
.save__name { display: flex; align-items: center; gap: var(--s-2); }
.save__name .input { flex: 1; min-width: 0; }
.save__error { margin: 0; }
</style>
