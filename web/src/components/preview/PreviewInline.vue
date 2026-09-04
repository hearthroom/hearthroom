<script setup lang="ts">
import type { Inline, Mark } from "@/lib/preview-doc";

defineProps<{ nodes: Inline[] }>();

function cls(marks: Mark[]): string[] {
  return marks.map((m) => `pv-m-${m.type}`);
}
function style(marks: Mark[]): Record<string, string> {
  const s: Record<string, string> = {};
  for (const m of marks) {
    if (m.type === "color") s.color = m.value;
    if (m.type === "highlight") s.background = m.bg;
  }
  return s;
}
</script>

<template>
  <span class="pv-inline">
    <template v-for="(n, i) in nodes" :key="i">
      <br v-if="n.kind === 'hardBreak'" />
      <span v-else :class="cls(n.marks)" :style="style(n.marks)">{{ n.text }}</span>
    </template>
  </span>
</template>
