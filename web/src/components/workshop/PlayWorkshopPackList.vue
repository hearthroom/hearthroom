<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import WorkshopPackList from "./WorkshopPackList.vue";
import { filterWorkshopPacks, type ModPack } from "@/lib/workshop-mods";

const props = defineProps<{ packs: ModPack[]; busy: boolean; scriptManaged?: boolean }>();
const emit = defineEmits<{ toggle: [pack: ModPack] }>();
const { t, n } = useI18n();
const search = ref("");
const results = computed(() => filterWorkshopPacks(props.packs, search.value));
</script>

<template>
  <section class="player-packs">
    <p v-if="scriptManaged" class="mod-window__muted">{{ t("workshop.window.pack.scriptManagedHint") }}</p>
    <input v-model="search" class="input" type="search" :aria-label="t('wb.packs.search')" :placeholder="t('wb.packs.search')" />
    <p v-if="search.trim()" class="mod-window__muted" role="status">
      {{ results.length ? t("wb.packs.matches", { n: n(results.length) }) : t("wb.packs.noMatches") }}
    </p>
    <WorkshopPackList v-if="results.length" :items="results" :label="t('wb.packs.title')" :reset-on="search">
      <template #default="{ item }">
        <div class="mod-window__row player-packs__row">
          <div class="mod-window__row-copy">
            <strong>{{ item.name }}</strong>
            <div class="mod-window__meta player-packs__meta">
              <span v-if="item.description">{{ item.description }}</span>
              <span v-if="item.residentChars">{{ t("workshop.window.row.resident", { chars: n(item.residentChars) }) }}</span>
            </div>
          </div>
          <button class="mod-window__switch mod-window__switch--pack" role="switch" type="button" :aria-checked="item.enabled"
                  :aria-label="t('workshop.window.pack.a11yToggle', { name: item.name })" :disabled="busy"
                  @click="emit('toggle', item)"><span /></button>
        </div>
      </template>
    </WorkshopPackList>
  </section>
</template>

<style scoped>
.player-packs { display: grid; gap: var(--s-2); padding: var(--s-2); background: var(--surface-2); border-radius: var(--r-sm); }
.player-packs p { margin: 0; }
.player-packs__row { min-height: 0; height: 100%; }
.player-packs__meta { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.player-packs__meta span + span { margin-inline-start: var(--s-2); }
</style>
