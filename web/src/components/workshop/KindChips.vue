<script setup lang="ts">
/** 擴充帶了哪幾類內容：世界書、介面（正規表示式）、開場。比簡介更快看出「它給我什麼」。 */
import WorkshopIcon from "./WorkshopIcon.vue";
import type { WorkshopKind } from "@/lib/workshop";

defineProps<{ kinds: WorkshopKind[] }>();
const ICON = { lore: "book", display: "ui", opening: "open" } as const;
</script>

<template>
  <ul class="kind-chips">
    <li v-for="k in kinds" :key="k" class="chip kind-chips__chip"><WorkshopIcon :name="ICON[k]" />{{ $t(`workshop.kind.${k}`) }}</li>
  </ul>
</template>

<style scoped>
.kind-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; padding: 0; list-style: none; }
.kind-chips__chip { cursor: default; }
.kind-chips__chip:hover { background: var(--surface-2); color: var(--text-2); }
.kind-chips__chip svg { width: 13px; height: 13px; }
@media (max-width: 600px) { .kind-chips__chip { height: 22px; font-size: 11px; padding: 0 8px; } }
</style>
