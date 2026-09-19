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
  compact?: boolean;

}>();
const emit=defineEmits<{updated:[copies:CardCopy[]]}>();
const session = useSession();
const { lp } = useLocalePath();
const source = computed(() => props.provider ?? currentProvider());
const providers = ref<{ id: ProviderId; name: string }[]>([]);
const selected = ref<ProviderId[]>([]);
const states = ref<CardCopy[]>([]);
const errors = ref<Record<string, string>>({});
const rawErrors = ref<Record<string, unknown>>({});
const busy = ref(false);
const loadError = ref("");
const connected = (p: ProviderId) =>
  session.profile?.identities.some((i) => i.provider === p);
async function load() {
  loadError.value = "";
  try {
    states.value = await copies(props.roleId, source.value);
    emit("updated",states.value);
  } catch (e) {
    loadError.value = connectionMessage(e);
  }
}
onMounted(async () => {
  providers.value = await availableProviders();
  if (props.initialOpen || props.compact) await load();
});
// 託管同步與 HearthRoom 送審分開：只儲存副本，不觸發 SaaS 審核。
// 已綁定的目標服務預設全勾，之後沿用作者上次的選擇。
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
function validate() {
  if (props.disabled) return false;
  return true;
}
async function run() {
  if (busy.value || props.disabled) return false;
  if (!validate()) return false;
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
        false
      );
      states.value = [...states.value.filter((x) => x.provider !== p), r];
      emit("updated",states.value);
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
  // Recovery creates a private hosting copy.
  const result=await synchronize(props.roleId,source.value,p,false,false,true);
  states.value=[...states.value.filter(x=>x.provider!==p),result];
  emit("updated",states.value);
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
  <div v-if="compact" class="copy-summary" :aria-label="$t('linked.platforms')">
    <span v-for="p in providers.filter(p=>connected(p.id))" :key="p.id" class="copy-status">
      <span class="copy-status__dot" :class="{'copy-status__dot--saved':p.id===source || ['synced','pending','published'].includes(states.find(x=>x.provider===p.id)?.status??'')}" />
      <span>{{ p.name }}<small>{{ p.id===source ? $t('workspace.saved') : loadError ? $t('workspace.unknown') : $t(`linked.status.${states.find(x=>x.provider===p.id)?.status||'missing'}`) }}</small></span>
    </span>
  </div>
  <details
    class="distribution"
    :open="initialOpen"
    @toggle="($event.target as HTMLDetailsElement).open && load()"
  >
    <summary>{{ $t(compact ? "workspace.manageSync" : "linked.platforms") }}</summary>
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
.distribution .btn, .target label { min-height:44px; }
.target label { display:flex; align-items:center; gap:var(--s-2); }
.copy-summary{display:flex;flex-wrap:wrap;gap:var(--s-3);padding-top:var(--s-3);margin-top:var(--s-2);border-top:1px solid var(--line)}
.copy-status{display:flex;gap:6px;align-items:baseline;font-size:12px;color:var(--text-2)}
.copy-status small{display:block;color:var(--text-3);font-size:11px;margin-top:2px}.copy-status__dot{width:6px;height:6px;border-radius:50%;background:var(--text-3);flex-shrink:0}.copy-status__dot--saved{background:var(--success)}
.copy-summary + .distribution{border-top:0;margin-top:0;padding-top:var(--s-2)}
.distribution {
  border-top: 1px solid var(--line);
  padding-top: var(--s-3);
  margin-top: var(--s-3);
}
summary {
  cursor: pointer;
  min-height:44px;
  align-content:center;
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
