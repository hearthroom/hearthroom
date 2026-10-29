<script setup lang="ts">
/** 舊登入沒同意過預設的權限：跳去授權前先說明為什麼，同意後回到這一頁。 */
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <section class="panel reauth" data-testid="preset-reauth">
    <h2>{{ $t("preset.reauth.title") }}</h2>
    <p class="muted">{{ $t("preset.reauth.body") }}</p>
    <div class="reauth__actions">
      <button type="button" class="btn" @click="emit('cancel')">{{ $t("preset.reauth.cancel") }}</button>
      <button type="button" class="btn btn--primary" data-testid="preset-reauthorize" @click="emit('confirm')">{{ $t("preset.reauth.confirm") }}</button>
    </div>
  </section>
</template>

<style scoped>
.reauth { padding: var(--s-5); display: grid; gap: var(--s-3); }
.reauth h2 { margin: 0; font-size: 16px; }
.reauth p { margin: 0; }
.reauth__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
</style>
