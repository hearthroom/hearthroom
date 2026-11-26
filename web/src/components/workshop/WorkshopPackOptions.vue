<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import WorkshopPackList from "./WorkshopPackList.vue";
import { filterWorkshopPacks } from "@/lib/workshop-mods";

const props = defineProps<{
  packs: readonly { id: string; name: string; description?: string }[];
  selected?: string | null;
}>();
const emit = defineEmits<{ select: [id: string] }>();
const { t, n } = useI18n();
const search = ref("");
const filtered = computed(() => filterWorkshopPacks(props.packs, search.value));
</script>

<template>
  <div class="pack-options">
    <input v-model="search" class="input" type="search" :aria-label="t('wb.packs.search')"
           :placeholder="t('wb.packs.search')" />
    <p v-if="search.trim()" class="subtle" role="status">
      {{ filtered.length ? t("wb.packs.matches", { n: n(filtered.length) }) : t("wb.packs.noMatches") }}
    </p>
    <WorkshopPackList v-if="filtered.length" :items="filtered" :label="t('wb.packs.title')" :row-height="44" :reset-on="search">
      <template #default="{ item }">
        <button type="button" class="btn btn--ghost pack-options__option" :aria-pressed="selected === item.id"
                @click="emit('select', item.id)">
          <span>{{ item.name }}</span><span v-if="selected === item.id" aria-hidden="true">✓</span>
        </button>
      </template>
    </WorkshopPackList>
  </div>
</template>

<style scoped>
.pack-options { display: grid; gap: var(--s-2); min-width: 0; }
.pack-options p { margin: 0; }
.pack-options__option { width: 100%; height: 100%; justify-content: space-between; border-radius: var(--r-sm); gap: var(--s-2); }
.pack-options__option span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pack-options__option[aria-pressed="true"] { background: var(--accent-tint); color: var(--accent-text); }
</style>
