<script setup lang="ts">
/**
 * 截圖縮圖格，只在審核頁與「我的申請」用。截圖路由只認令牌，<img src> 帶不了：每張抓成 blob 網址再顯示，
 * 同一張只抓一次，卸載時釋放每一個。已過保留期限的不抓；抓失敗的顯示中性佔位。點縮圖開放大對話框。
 */
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { evidenceBlobUrl } from "@/lib/campaign";
import { wrapTab } from "@/lib/focus-trap";
import { useSession } from "@/lib/session";

const props = defineProps<{ items: { id: string; purged?: boolean }[]; token?: () => Promise<string> }>();
const { t } = useI18n();
const session = useSession();

/** id → blob 網址；null 是載入失敗。沒有這個 key 就是還在載入或還沒開始。 */
const urls = reactive<Record<string, string | null>>({});
const asked = new Set<string>();
const made: string[] = [];
let alive = true;

async function getToken() {
  const value = props.token ? await props.token() : await session.accessToken();
  if (!value) throw new Error(t("auth.expired"));
  return value;
}
async function load(id: string) {
  asked.add(id);
  try {
    const url = await evidenceBlobUrl(await getToken(), id);
    // 等到一半頁面就離開了
    if (!alive) return URL.revokeObjectURL(url);
    made.push(url);
    urls[id] = url;
  } catch {
    urls[id] = null;
  }
}
const sync = () => { for (const i of props.items) if (!i.purged && !asked.has(i.id)) void load(i.id); };
onMounted(sync);
watch(() => props.items.map((i) => i.id + (i.purged ? "!" : "")).join("|"), sync);
onBeforeUnmount(() => { alive = false; document.removeEventListener("keydown", onKey); for (const u of made) URL.revokeObjectURL(u); });

const stateOf = (i: { id: string; purged?: boolean }) => (i.purged ? "purged" : !(i.id in urls) ? "loading" : urls[i.id] ? "ready" : "failed");

// ---- 放大 ----
const opened = ref("");
const box = ref<HTMLElement | null>(null);
let opener: HTMLElement | null = null;
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") return void close();
  wrapTab(e, box.value);
}
async function open(id: string, e: Event) {
  // 從點擊本身拿：Safari、Firefox 點按鈕不一定會讓它取得焦點
  opener = e.currentTarget as HTMLElement | null;
  opened.value = id;
  document.addEventListener("keydown", onKey);
  await nextTick();
  box.value?.querySelector<HTMLElement>("button")?.focus();
}
async function close() {
  document.removeEventListener("keydown", onKey);
  opened.value = "";
  await nextTick();
  if (opener?.isConnected) opener.focus();
  opener = null;
}
</script>

<template>
  <div class="ev-viewer">
    <template v-for="i in items" :key="i.id">
      <button v-if="stateOf(i) === 'ready'" type="button" class="ev-viewer__tile ev-viewer__open" :data-evidence="i.id" data-state="ready" data-action="open" :aria-label="t('campaign.evidence.open')" @click="open(i.id, $event)">
        <img :src="urls[i.id]!" alt="" />
      </button>
      <div v-else-if="stateOf(i) === 'purged'" class="ev-viewer__tile ev-viewer__note" :data-evidence="i.id" data-state="purged"><span>{{ t("campaign.evidence.purged") }}</span></div>
      <div v-else-if="stateOf(i) === 'failed'" class="ev-viewer__tile ev-viewer__note" :data-evidence="i.id" data-state="failed" aria-hidden="true" />
      <div v-else class="ev-viewer__tile ghost" :data-evidence="i.id" data-state="loading" />
    </template>

    <Teleport to="body">
      <div v-if="opened" class="modal-backdrop" @click.self="close">
        <div ref="box" class="modal panel ev-zoom" role="dialog" aria-modal="true" :aria-label="t('campaign.evidence.open')">
          <img :src="urls[opened]!" alt="" class="ev-zoom__img" />
          <div class="modal__actions"><button type="button" class="btn" @click="close">{{ t("dialog.close") }}</button></div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ev-viewer { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: var(--s-2); min-width: 0; }
.ev-viewer__tile { aspect-ratio: 1; border-radius: var(--r-md); overflow: hidden; background: var(--surface-2); min-width: 0; }
.ev-viewer__open { padding: 0; border: 0; cursor: zoom-in; display: block; }
.ev-viewer__open img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ev-viewer__note { display: grid; place-items: center; padding: var(--s-2); text-align: center; font-size: 12px; color: var(--text-2); }
.ev-zoom { width: min(720px, 100%); }
.ev-zoom__img { width: 100%; max-height: calc(100dvh - 160px); object-fit: contain; border-radius: var(--r-sm); }
</style>
