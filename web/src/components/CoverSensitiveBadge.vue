<script setup lang="ts">
import CoverEye from "./CoverEye.vue";
</script>

<template>
  <span class="sensitive-cover-badge" role="img" :aria-label="$t('coverSensitive.label')" :title="$t('coverSensitive.label')"><CoverEye /></span>
</template>

<style scoped>
.sensitive-cover-badge {
  position: absolute; top: var(--s-1); left: var(--s-1);
  width: 22px; height: 22px; border-radius: var(--r-pill);
  color: white; background: rgba(16,16,19,.65); display: grid; place-items: center;
}
.sensitive-cover-badge svg { width: 13px; }
</style>
