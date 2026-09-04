<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<template>
  <div class="page lost">
    <p class="eyebrow">404</p>
    <h1 class="display">{{ $t("notFound.title") }}</h1>
    <p class="muted">{{ $t("notFound.hint") }}</p>
    <RouterLink to="/" class="btn">← {{ $t("notFound.back") }}</RouterLink>
  </div>
</template>

<style scoped>
.lost { padding-top: var(--s-8); }
h1 { margin: var(--s-2) 0 var(--s-3); font-size: clamp(34px, 6vw, 52px); }
h1 + .muted { margin: 0 0 var(--s-6); }
</style>
