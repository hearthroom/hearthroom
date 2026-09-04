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
h1 { margin: 2px 0 var(--s-2); font-size: 24px; }
h1 + .muted { margin: 0 0 var(--s-6); }
</style>
