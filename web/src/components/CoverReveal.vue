<script setup lang="ts">
import CoverEye from "./CoverEye.vue";

const emit = defineEmits<{ reveal: [] }>();
</script>

<template>
  <button type="button" class="cover-reveal" :aria-label="$t('coverSensitive.revealLabel')" @click.stop.prevent="emit('reveal')">
    <span class="cover-reveal__content" aria-hidden="true">
      <span class="cover-reveal__label"><CoverEye />{{ $t("coverSensitive.label") }}</span>
      <span class="cover-reveal__pill">{{ $t("coverSensitive.show") }}</span>
    </span>
  </button>
</template>

<style scoped>
.cover-reveal {
  position: absolute; z-index: 1; inset: 0;
  display: grid; place-items: center;
  padding: var(--s-2); border: 0;
  color: white; background: rgba(16, 16, 19, .52);
  font: inherit; cursor: pointer;
}
.cover-reveal:focus-visible { outline: 2px solid white; outline-offset: -3px; }
.cover-reveal__content { display: grid; justify-items: center; gap: 6px; max-width: 100%; }
.cover-reveal__label {
  display: flex; align-items: center; justify-content: center; gap: 5px;
  color: rgba(255, 255, 255, .9); font-size: 11px; font-weight: 400;
  overflow-wrap: anywhere;
}
.cover-reveal__label svg { width: 13px; height: 13px; flex: none; }
.cover-reveal__pill {
  padding: 4px 11px; border: 1px solid rgba(255, 255, 255, .5);
  border-radius: var(--r-pill); background: rgba(16, 16, 19, .24);
  font-size: 12px; line-height: 1.3;
}
@media (hover: hover) {
  .cover-reveal:hover .cover-reveal__pill { background: rgba(16, 16, 19, .58); }
}
</style>
