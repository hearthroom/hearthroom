<script setup lang="ts">
/**
 * 申請表的截圖上傳：選檔、拖放、貼上，選完立刻逐張上傳。縮圖是本機預覽（createObjectURL），不打截圖路由。
 * v-model:ids 是這次新傳成功的截圖 id（依加入順序）；existing 是重送時已掛著的，計入上限、不能移除。
 * 上傳中 update:busy 為 true，父層據此停用提交。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { campaignErrorText, uploadEvidence } from "@/lib/campaign";
import { useSession } from "@/lib/session";

/** 服務端同樣會擋；這裡只是讓人早點知道。 */
const MAX_EVIDENCE = 6;

const props = defineProps<{ existing?: { id: string }[]; ids?: string[] }>();
const emit = defineEmits<{ "update:ids": [ids: string[]]; "update:busy": [busy: boolean] }>();
const { t } = useI18n();
const session = useSession();

interface Item { key: number; file: File; preview: string; state: "uploading" | "done" | "failed"; id: string; error: string }
const items = ref<Item[]>([]);
const total = computed(() => (props.existing?.length ?? 0) + items.value.length);
const full = computed(() => total.value >= MAX_EVIDENCE);
const overflowed = ref(false);
const rejected = ref("");
const busy = computed(() => items.value.some((i) => i.state === "uploading"));
const showLimit = computed(() => full.value || overflowed.value);

watch(busy, (v) => emit("update:busy", v));
// 不看誰先傳完：照加入順序
const doneIds = computed(() => items.value.filter((i) => i.state === "done").map((i) => i.id));
watch(() => doneIds.value.join("|"), () => emit("update:ids", doneIds.value));

let key = 0, chain: Promise<void> = Promise.resolve(), alive = true;
async function send(item: Item) {
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const res = await uploadEvidence(token, item.file);
    item.id = res.id; item.state = "done";
  } catch (e) {
    item.error = campaignErrorText(e); item.state = "failed";
  }
}
// 逐張傳：一張傳完才傳下一張，也比較不會撞到上傳頻率限制
function enqueue(item: Item) {
  item.state = "uploading"; item.error = "";
  chain = chain.then(() => (alive ? send(item) : undefined));
}

function add(list: FileList | File[] | null | undefined) {
  const all = [...(list ?? [])];
  const images = all.filter((f) => f.type.startsWith("image/"));
  rejected.value = images.length < all.length ? campaignErrorText("evidence_invalid") : "";
  const room = Math.max(0, MAX_EVIDENCE - total.value);
  overflowed.value = images.length > room;
  for (const file of images.slice(0, room)) {
    items.value.push({ key: ++key, file, preview: URL.createObjectURL(file), state: "uploading", id: "", error: "" });
    // 取響應式的那份，狀態變了畫面才會跟著變
    enqueue(items.value[items.value.length - 1]!);
  }
}
function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  add(input.files);
  input.value = "";
}
const onPaste = (e: ClipboardEvent) => {
  const files = [...(e.clipboardData?.files ?? [])];
  if (!files.length) return;
  e.preventDefault();
  add(files);
};
const onDrop = (e: DragEvent) => add(e.dataTransfer?.files);

function remove(item: Item) {
  URL.revokeObjectURL(item.preview);
  items.value = items.value.filter((i) => i !== item);
  overflowed.value = false;
}
onBeforeUnmount(() => {
  alive = false;
  // 上傳到一半就離開：讓父層的提交鈕不要永遠停用
  if (busy.value) emit("update:busy", false);
  for (const i of items.value) URL.revokeObjectURL(i.preview);
});
</script>

<template>
  <div class="ev-picker" tabindex="0" role="group" :aria-label="t('campaign.evidence.add')" @paste="onPaste" @drop.prevent="onDrop" @dragover.prevent>
    <p class="ev-picker__hint subtle">{{ t("campaign.evidence.hint") }}</p>
    <div v-if="items.length" class="ev-picker__grid">
      <div v-for="i in items" :key="i.key" class="ev-tile" :data-evidence="i.key" :data-state="i.state">
        <div class="ev-tile__thumb">
          <img :src="i.preview" alt="" />
          <div v-if="i.state === 'uploading'" class="ghost ev-tile__cover" role="status"><span>{{ t("campaign.evidence.uploading") }}</span></div>
        </div>
        <p v-if="i.state === 'failed'" class="notice notice--error ev-tile__error" role="alert"><span>{{ t("campaign.evidence.failed") }}</span><span>{{ i.error }}</span></p>
        <div class="ev-tile__actions">
          <button v-if="i.state === 'failed'" type="button" class="btn btn--sm" data-action="retry" @click="enqueue(i)">{{ t("campaign.evidence.retry") }}</button>
          <button type="button" class="btn btn--sm btn--ghost" data-action="remove" :disabled="i.state === 'uploading'" @click="remove(i)">{{ t("campaign.evidence.remove") }}</button>
        </div>
      </div>
    </div>
    <div class="ev-picker__bar">
      <label class="btn btn--sm" :aria-disabled="full">
        <input type="file" class="sr-only" accept="image/*" multiple :disabled="full" @change="onPick" />
        {{ t("campaign.evidence.add") }}
      </label>
      <span class="ev-picker__count subtle">{{ total }} / {{ MAX_EVIDENCE }}</span>
    </div>
    <p v-if="showLimit" class="subtle" role="status">{{ t("campaign.evidence.limit") }}</p>
    <p v-if="rejected" class="notice notice--error" role="alert">{{ rejected }}</p>
  </div>
</template>

<style scoped>
.ev-picker { display: grid; gap: var(--s-3); min-width: 0; }
.ev-picker__hint { margin: 0; font-size: 13px; }
.ev-picker__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: var(--s-3); }
.ev-tile { display: grid; gap: var(--s-2); align-content: start; min-width: 0; }
.ev-tile__thumb { position: relative; aspect-ratio: 1; border-radius: var(--r-md); overflow: hidden; background: var(--surface-2); }
.ev-tile__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ev-tile__cover { position: absolute; inset: 0; display: grid; place-items: center; border-radius: 0; background: color-mix(in srgb, var(--surface) 70%, transparent); font-size: 12px; color: var(--text-2); }
.ev-tile__cover span { position: relative; z-index: 1; }
.ev-tile__error { display: grid; gap: var(--s-1); margin: 0; padding: var(--s-2) var(--s-3); font-size: 12.5px; overflow-wrap: anywhere; }
.ev-tile__actions { display: flex; flex-wrap: wrap; gap: var(--s-1); }
.ev-picker__bar { display: flex; align-items: center; gap: var(--s-3); }
.ev-picker__bar .btn { position: relative; cursor: pointer; }
.ev-picker__bar .btn:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.ev-picker__bar .btn[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
.ev-picker__count { font-size: 13px; }
@media (max-width: 760px) { .ev-tile__actions .btn, .ev-picker__bar .btn { min-height: 44px; } }
</style>
