<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { currentProvider, type ProviderId } from "@/lib/provider";
import { availableProviders } from "@/lib/provider-switch";
import { useSession } from "@/lib/session";
import {
  copies,
  synchronize,
  connectionMessage,
  canRecreateCopy,
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
const rawErrors = ref<Record<string, unknown>>({});
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
// 登記即分發（owner 2026-09-17）：作者在「我的卡片」按登記時，站台在背景同步到所有已綁定的渠道。
// 這個面板是手動重送／補送：已綁定的目標站預設全勾，作者不想送某一家再自己取消。
// 身分清單可能晚於面板載入，所以跟著 profile 一起算。
const defaults = computed(() =>
  providers.value.filter((p) => p.id !== source.value && connected(p.id)).map((p) => p.id)
);
function remembered(next:ProviderId[]) {
 try {const saved=JSON.parse(localStorage.getItem(`hearthroom.save-platforms.${source.value}.${props.roleId}`)||'null');if(Array.isArray(saved))return next.filter(p=>saved.includes(p));}catch{}
 return next;
}
function remember() {try {localStorage.setItem(`hearthroom.save-platforms.${source.value}.${props.roleId}`,JSON.stringify([source.value,...selected.value]));}catch{}}
watch(defaults, (next) => { selected.value = remembered(next); }, { immediate: true });
watch(
  () => [props.roleId, props.provider],
  () => {
    states.value = [];
    errors.value = {};
    rawErrors.value = {};
    selected.value = remembered(defaults.value);
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
      delete rawErrors.value[p];
    } catch (e) {
      ok = false;
      errors.value[p] = connectionMessage(e);
      rawErrors.value[p] = e;
    }
  }
  busy.value = false;
  return ok;
}
function missingCopy(p:ProviderId) {
 return canRecreateCopy(rawErrors.value[p] ?? new Error(states.value.find(x=>x.provider===p)?.error),p);
}
async function recreate(p:ProviderId) {
 if(busy.value || props.disabled || !connected(p) || !missingCopy(p))return;
 busy.value=true;
 try {
  // Recovery always creates a private copy, regardless of the review checkbox.
  const result=await synchronize(props.roleId,source.value,p,false,false,true);
  states.value=[...states.value.filter(x=>x.provider!==p),result];
  delete errors.value[p];
  delete rawErrors.value[p];
 } catch(error) {
  errors.value[p]=connectionMessage(error);
  rawErrors.value[p]=error;
 } finally {busy.value=false;}
}
defineExpose({ run, validate, load });
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
          @change="remember"
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
      <div v-if="p.id !== source && connected(p.id) && missingCopy(p.id)" class="recovery">
        <p class="subtle">{{ $t("linked.recreateHint") }}</p>
        <button class="btn btn--sm" :disabled="busy || disabled" @click="recreate(p.id)">
          {{ busy ? $t("linked.syncing") : $t("linked.recreateCopy") }}
        </button>
      </div>
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
.recovery {
  flex-basis: 100%;
  display: grid;
  gap: var(--s-2);
  justify-items: start;
}
.recovery button { min-height: var(--h-lg); height: auto; max-width: 100%; white-space: normal; }
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
