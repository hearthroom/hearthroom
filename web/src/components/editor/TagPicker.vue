<script setup lang="ts">
/**
 * 站內分類詞表。作者手打的標籤榜單不一定認得；這裡列的是榜單真的會拿來分類的那一份，
 * 點一下就加進標籤欄，跟手打的走同一條路。
 *
 * 詞表拿不到（舊版上游、沒登入）就整塊不顯示，不擋建卡——它是輔助，不是必經。
 */
import { onMounted, ref, watch } from "vue";
import { fetchCanonicalTags, type CanonicalTag } from "@/lib/api";
import { useSession } from "@/lib/session";

const props = defineProps<{ selected: string[]; language: string; max: number }>();
const emit = defineEmits<{ toggle: [string] }>();

const session = useSession();
const groups = ref<{ dimension: string; tags: CanonicalTag[] }[]>([]);
const open = ref(false);

async function load() {
  try {
    const token = await session.accessToken();
    if (!token) return;
    groups.value = await fetchCanonicalTags(token, props.language);
  } catch {
    groups.value = [];
  }
}
onMounted(load);
// 詞表的名字跟卡片語區走：換了語區就重抓，不然簡體卡會拿到繁體標籤
watch(() => props.language, load);

const picked = (tag: CanonicalTag) => props.selected.includes(tag.name);
const full = () => props.selected.length >= props.max;
</script>

<template>
  <div v-if="groups.length" class="picker">
    <button type="button" class="btn btn--sm btn--ghost picker__toggle" :aria-expanded="open" @click="open = !open">
      {{ $t("editor.tags.pick") }}
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :class="{ flip: open }">
        <path d="M4 6l4 4 4-4" />
      </svg>
    </button>
    <div v-if="open" class="picker__groups">
      <div v-for="group in groups" :key="group.dimension" class="picker__group">
        <p class="eyebrow">{{ $t(`editor.tags.dimension.${group.dimension}`, group.dimension) }}</p>
        <ul class="picker__tags">
          <li v-for="tag in group.tags" :key="tag.slug">
            <button type="button" class="chip" :class="{ 'chip--on': picked(tag) }" :aria-pressed="picked(tag)"
                    :disabled="!picked(tag) && full()" @click="emit('toggle', tag.name)">
              {{ tag.name }}
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker { display: grid; gap: var(--s-2); }
.picker__toggle { justify-self: start; }
.picker__toggle svg { transition: transform var(--dur) var(--ease); }
.picker__toggle svg.flip { transform: rotate(180deg); }
.picker__groups { display: grid; gap: var(--s-3); padding: var(--s-3); background: var(--surface-2); border-radius: var(--r-md); }
.picker__group { display: grid; gap: 6px; }
.picker__group .eyebrow { margin: 0; }
.picker__tags { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.chip--on { background: var(--accent-tint); color: var(--accent-text); box-shadow: inset 0 0 0 1px var(--accent); }
.chip:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
