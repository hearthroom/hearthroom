<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { currentProvider, type ProviderId } from "@/lib/provider";
import { availableProviders } from "@/lib/provider-switch";
import { useSession } from "@/lib/session";
import {
  copies,
  synchronize,
  connectionMessage,
  type CardCopy,
} from "@/lib/distribution";
import { useLocalePath } from "@/lib/use-locale";
const props = defineProps<{
  roleId: string;
  provider?: ProviderId;
  disabled?: boolean;
  initialOpen?: boolean;
}>();
const session = useSession();
const { lp } = useLocalePath();
const source = computed(() => props.provider ?? currentProvider());
const providers = ref<{ id: ProviderId; name: string }[]>([]);
const selected = ref<ProviderId[]>([]);
const states = ref<CardCopy[]>([]);
const errors = ref<Record<string, string>>({});
const busy = ref(false);
const publish = ref(false);
const loadError = ref("");
const connected = (p: ProviderId) =>
  session.profile?.identities.some((i) => i.provider === p);
async function load() {
  loadError.value = "";
  try {
    states.value = await copies(props.roleId, source.value);
  } catch (e) {
    loadError.value = connectionMessage(e);
  }
}
onMounted(async () => {
  providers.value = await availableProviders();
  if (props.initialOpen) await load();
});
watch(
  () => [props.roleId, props.provider],
  () => {
    states.value = [];
    selected.value = [];
  }
);
function validate(sendForReview = false) {
  if (props.disabled) return false;
  return true;
}
async function run(sendForReview = publish.value) {
  if (busy.value || props.disabled) return false;
  if (!validate(sendForReview)) return false;
  loadError.value = "";
  busy.value = true;
  errors.value = {};
  let ok = true;
  for (const p of selected.value) {
    try {
      const r = await synchronize(
        props.roleId,
        source.value,
        p,
        sendForReview
      );
      states.value = [...states.value.filter((x) => x.provider !== p), r];
    } catch (e) {
      ok = false;
      errors.value[p] = connectionMessage(e);
    }
  }
  busy.value = false;
  return ok;
}
defineExpose({ run, validate });
</script>
<template>
  <details
    class="distribution"
    :open="initialOpen"
    @toggle="($event.target as HTMLDetailsElement).open && load()"
  >
    <summary>{{ $t("linked.platforms") }}</summary>
    <p class="subtle">{{ $t("linked.syncHint") }}</p>
    <p v-if="loadError" role="alert">
      {{ loadError }}
      <button class="btn btn--sm" @click="load">
        {{ $t("linked.retry") }}
      </button>
    </p>
    <div v-for="p in providers" :key="p.id" class="target">
      <label
        ><input
          v-if="p.id !== source && connected(p.id)"
          v-model="selected"
          type="checkbox"
          :value="p.id"
          :disabled="busy || disabled"
        />
        {{ p.name }}</label
      >
      <span class="subtle">{{
        p.id === source
          ? $t("linked.source")
          : !connected(p.id)
          ? $t("linked.notConnected")
          : $t(
              `linked.status.${
                states.find((x) => x.provider === p.id)?.status || "missing"
              }`
            )
      }}</span>
      <a v-if="!connected(p.id)" :href="lp('/me')">{{
        $t("linked.connect")
      }}</a>
      <p
        v-if="errors[p.id] || states.find((x) => x.provider === p.id)?.error"
        role="alert"
        class="notice notice--error"
      >
        {{
          errors[p.id] ||
          connectionMessage(
            new Error(states.find((x) => x.provider === p.id)?.error)
          )
        }}
      </p>
    </div>
    <label class="option"
      ><input v-model="publish" type="checkbox" :disabled="busy || disabled" />
      {{ $t("linked.submitToo") }}</label
    >
    <button
      class="btn btn--sm"
      :disabled="busy || disabled || !selected.length"
      @click="run()"
    >
      {{ busy ? $t("linked.syncing") : $t("linked.sync") }}
    </button>
    <p v-if="disabled" class="subtle">{{ $t("editor.publish.saveFirst") }}</p>
  </details>
</template>
<style scoped>
.distribution {
  border-top: 1px solid var(--line);
  padding-top: var(--s-3);
  margin-top: var(--s-3);
}
summary {
  cursor: pointer;
  font-weight: 600;
}
.target {
  display: flex;
  gap: var(--s-2);
  align-items: center;
  flex-wrap: wrap;
  padding: var(--s-2) 0;
}
.target p {
  flex-basis: 100%;
  margin: 0;
}
.option {
  display: flex;
  gap: var(--s-2);
  align-items: center;
  margin: var(--s-3) 0;
}
.distribution p {
  font-size: 13px;
}
.target label {
  margin-right: auto;
}
</style>
