<script setup lang="ts">
/** 工坊用到、AccountIcon 沒有的幾個圖示：viewBox 24、線寬 1.75、跟著文字顏色走。 */
defineProps<{ name: "layers" | "book" | "ui" | "open" | "up" | "down" | "info" | "lock" | "warn" }>();
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name === 'layers'"><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="m3 13 9 5 9-5" /></template>
    <template v-else-if="name === 'book'"><path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z" /><path d="M5 17a3 3 0 0 1 3-3h10" /></template>
    <template v-else-if="name === 'ui'"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 9v11" /></template>
    <template v-else-if="name === 'open'"><path d="M5 5h14v10H9l-4 4V5Z" /><path d="M9 10h6" /></template>
    <template v-else-if="name === 'up'"><path d="m6 15 6-6 6 6" /></template>
    <template v-else-if="name === 'down'"><path d="m6 9 6 6 6-6" /></template>
    <template v-else-if="name === 'info'"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></template>
    <template v-else-if="name === 'lock'"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></template>
    <template v-else-if="name === 'warn'"><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4M12 17h.01" /></template>
  </svg>
</template>
