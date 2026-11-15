<script setup lang="ts">
/** 作者 DLC 帶了哪幾類內容：世界書、正則、開場。比簡介更快看出「它給我什麼」。線上的 "display" 就是正則。 */
import WorkshopIcon from "./WorkshopIcon.vue";
import type { WorkshopKind } from "@/lib/workshop";

defineProps<{ kinds: WorkshopKind[] }>();
const ICON = { lore: "book", display: "ui", opening: "open" } as const;
const LABEL = { lore: "workshop.kind.lore", display: "workshop.kind.regex", opening: "workshop.kind.opening" } as const;
</script>

<template>
  <ul class="kind-chips">
    <li v-for="k in kinds" :key="k" class="chip kind-chips__chip"><WorkshopIcon :name="ICON[k]" />{{ $t(LABEL[k]) }}</li>
  </ul>
</template>

<style scoped>
.kind-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; padding: 0; list-style: none; }
.kind-chips__chip { cursor: default; }
.kind-chips__chip:hover { background: var(--surface-2); color: var(--text-2); }
.kind-chips__chip svg { width: 13px; height: 13px; }
@media (max-width: 600px) { .kind-chips__chip { height: 22px; font-size: 11px; padding: 0 8px; } }
</style>
