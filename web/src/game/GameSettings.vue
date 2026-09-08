<script setup lang="ts">
/**
 * 遊戲內設定：模型／線路／思考深度、玩家人設、長期指令。
 * 讀寫的是開放 API 的玩家設定，跟對話頁同一份；這裡只做遊戲裡最常動的幾項。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { addDirective, deleteDirective, fetchDirectives, fetchModels, fetchRoleSettings, saveRoleSettings, type DirectiveList, type ModelGroup, type ModelVariant, type RoleSettings } from "@/game/settings-client";

const props = defineProps<{ base: string; token: string; lang: string; roleId: string; conversationId: string }>();
const emit = defineEmits<{ (e: "close"): void; (e: "saved", s: RoleSettings): void; (e: "needConversation"): void }>();
const { t } = useI18n();

type Tab = "model" | "persona" | "directives";
const tab = ref<Tab>("model");
const loading = ref(true);
const error = ref("");
const groups = ref<ModelGroup[]>([]);
const original = ref<RoleSettings | null>(null);
const draft = ref<RoleSettings>({ personaMode: "", userName: "", userSex: "", userDefine: "", selectModel: "", context: 1, thinkingDepth: "" });
const globalPersona = ref<{ userName?: string; userSex?: string; userDefine?: string }>({});
const saving = ref(false);
const savedTick = ref(false);
const directives = ref<DirectiveList>({ list: [], maxCount: 10, maxLength: 200 });
const directiveDraft = ref("");
const directiveBusy = ref(false);

const dirty = computed(() => !!original.value && JSON.stringify(original.value) !== JSON.stringify(draft.value));
const variants = computed<ModelVariant[]>(() => groups.value.flatMap((g) => g.families.flatMap((f) => f.variants)));
const current = computed(() => variants.value.find((v) => v.value === draft.value.selectModel) || null);
const thinkingOptions = computed(() => current.value?.thinkingDepthOptions || []);
const contextOptions = computed(() => current.value?.contextBudgetOptions || []);

onMounted(async () => {
  try {
    const [models, bundle] = await Promise.all([fetchModels(props.base, props.token, props.lang, props.roleId), fetchRoleSettings(props.base, props.token, props.lang, props.roleId)]);
    groups.value = models;
    original.value = bundle.settings;
    draft.value = { ...bundle.settings };
    globalPersona.value = bundle.globalPersona;
  } catch (e) {
    console.error("[game] settings load failed", e);
    error.value = t("game.settings.loadFailed");
  } finally {
    loading.value = false;
  }
  if (props.conversationId) void loadDirectives();
});

watch(() => props.conversationId, (id) => { if (id) void loadDirectives(); });

async function loadDirectives() {
  try { directives.value = await fetchDirectives(props.base, props.token, props.lang, props.conversationId); }
  catch (e) { console.error("[game] directives load failed", e); }
}

function pick(v: ModelVariant) {
  draft.value.selectModel = v.value;
  // 換模型後思考深度與檔位要落在新模型有的選項上
  const depths = v.thinkingDepthOptions || [];
  if (depths.length && !depths.some((d) => d.value === draft.value.thinkingDepth)) draft.value.thinkingDepth = v.defaultThinkingDepth || depths[0].value;
  if (!depths.length) draft.value.thinkingDepth = "";
  const ctxs = v.contextBudgetOptions || [];
  if (ctxs.length && !ctxs.some((c) => c.value === draft.value.context)) draft.value.context = ctxs[0].value;
}

async function save() {
  if (!original.value || saving.value) return;
  saving.value = true; error.value = "";
  try {
    const r = await saveRoleSettings(props.base, props.token, props.lang, props.roleId, original.value, draft.value);
    if (!r.ok) { error.value = r.reason || t("game.settings.saveFailed"); return; }
    original.value = { ...draft.value };
    emit("saved", draft.value);
    savedTick.value = true; setTimeout(() => { savedTick.value = false; }, 1600);
  } catch (e) {
    console.error("[game] settings save failed", e);
    error.value = t("game.settings.saveFailed");
  } finally {
    saving.value = false;
  }
}

async function addOne() {
  const text = directiveDraft.value.trim();
  if (!text || directiveBusy.value) return;
  if (!props.conversationId) { emit("needConversation"); return; }
  directiveBusy.value = true;
  try { directives.value = await addDirective(props.base, props.token, props.lang, props.conversationId, text); directiveDraft.value = ""; }
  catch (e) { console.error("[game] directive add failed", e); error.value = t("game.settings.saveFailed"); }
  finally { directiveBusy.value = false; }
}
async function removeOne(sourceId: string) {
  if (directiveBusy.value) return;
  directiveBusy.value = true;
  try { directives.value = await deleteDirective(props.base, props.token, props.lang, props.conversationId, sourceId); }
  catch (e) { console.error("[game] directive delete failed", e); error.value = t("game.settings.saveFailed"); }
  finally { directiveBusy.value = false; }
}

const statusDot = (v: ModelVariant) => (v.status?.level || v.status?.state || "").toString();
const cost = (v: ModelVariant) => (v.maxScore && v.maxScore !== v.costScore ? `${v.costScore ?? 0}–${v.maxScore}` : String(v.costScore ?? 0));
</script>

<template>
  <div class="gs" role="dialog" :aria-label="$t('game.settings.title')">
    <div class="gs__head">
      <b>{{ $t("game.settings.title") }}</b>
      <div class="gs__tabs" role="tablist">
        <button v-for="k in (['model', 'persona', 'directives'] as const)" :key="k" type="button" role="tab" class="gs__tab" :class="{ 'gs__tab--on': tab === k }" :aria-selected="tab === k" @click="tab = k">{{ $t(`game.settings.${k}`) }}</button>
      </div>
      <button type="button" class="btn btn--ghost btn--sm" @click="emit('close')">✕</button>
    </div>

    <p v-if="loading" class="gs__muted">{{ $t("game.thinking") }}</p>
    <p v-if="error" class="gs__error" role="alert">{{ error }}</p>

    <!-- 模型 -->
    <div v-if="!loading && tab === 'model'" class="gs__body">
      <div v-for="g in groups" :key="g.group" class="gs__group">
        <div class="gs__eyebrow">{{ g.group }}</div>
        <div v-for="f in g.families" :key="f.family" class="gs__family">
          <div class="gs__family-name">{{ f.family }}<small v-if="f.description">{{ f.description }}</small></div>
          <label v-for="v in f.variants" :key="v.value" class="gs__variant" :class="{ 'gs__variant--on': draft.selectModel === v.value }">
            <input type="radio" name="model" :value="v.value" :checked="draft.selectModel === v.value" @change="pick(v)" />
            <span class="gs__dot" :data-s="statusDot(v)"></span>
            <span class="gs__vname">{{ v.name }}<small v-if="v.channelLabel"> · {{ v.channelLabel }}</small></span>
            <span class="gs__cost">{{ cost(v) }}</span>
            <span v-if="v.isMember" class="gs__badge">VIP</span>
          </label>
        </div>
      </div>
      <div v-if="thinkingOptions.length" class="gs__row">
        <span class="gs__label">{{ $t("game.settings.thinking") }}</span>
        <div class="gs__seg">
          <button v-for="d in thinkingOptions" :key="d.value" type="button" class="gs__segbtn" :class="{ 'gs__segbtn--on': draft.thinkingDepth === d.value }" @click="draft.thinkingDepth = d.value">{{ d.label || d.value }}</button>
        </div>
      </div>
      <div v-if="contextOptions.length" class="gs__row">
        <span class="gs__label">{{ $t("game.settings.context") }}</span>
        <div class="gs__seg">
          <button v-for="c in contextOptions" :key="c.value" type="button" class="gs__segbtn" :class="{ 'gs__segbtn--on': draft.context === c.value }" @click="draft.context = c.value">{{ c.text }}</button>
        </div>
      </div>
    </div>

    <!-- 人設 -->
    <div v-if="!loading && tab === 'persona'" class="gs__body">
      <div class="gs__row">
        <span class="gs__label">{{ $t("game.settings.personaMode") }}</span>
        <div class="gs__seg">
          <button v-for="m in (['global', 'custom', 'name_only'] as const)" :key="m" type="button" class="gs__segbtn" :class="{ 'gs__segbtn--on': (draft.personaMode || 'global') === m }" @click="draft.personaMode = m">{{ $t(`game.settings.persona.${m}`) }}</button>
        </div>
      </div>
      <p v-if="(draft.personaMode || 'global') === 'global'" class="gs__muted">{{ $t("game.settings.persona.globalHint", { name: globalPersona.userName || "—" }) }}</p>
      <template v-else>
        <label class="gs__field"><span>{{ $t("game.settings.userName") }}</span><input v-model="draft.userName" class="input" maxlength="30" /></label>
        <div class="gs__row">
          <span class="gs__label">{{ $t("game.settings.userSex") }}</span>
          <div class="gs__seg">
            <button v-for="s in (['man', 'women', 'other'] as const)" :key="s" type="button" class="gs__segbtn" :class="{ 'gs__segbtn--on': draft.userSex === s }" @click="draft.userSex = s">{{ $t(`game.settings.sex.${s}`) }}</button>
          </div>
        </div>
        <label v-if="draft.personaMode === 'custom'" class="gs__field"><span>{{ $t("game.settings.userDefine") }}</span><textarea v-model="draft.userDefine" class="input" rows="4" maxlength="500"></textarea></label>
      </template>
    </div>

    <!-- 長期指令 -->
    <div v-if="!loading && tab === 'directives'" class="gs__body">
      <p class="gs__muted">{{ $t("game.settings.directivesHint") }}</p>
      <p v-if="!conversationId" class="gs__muted">{{ $t("game.settings.directivesNeedChat") }}</p>
      <ul class="gs__list">
        <li v-for="d in directives.list" :key="d.sourceId" class="gs__item">
          <span>{{ d.text }}</span>
          <button type="button" class="btn btn--ghost btn--sm" :disabled="directiveBusy" @click="removeOne(d.sourceId)">{{ $t("game.settings.remove") }}</button>
        </li>
      </ul>
      <form class="gs__add" @submit.prevent="addOne">
        <input v-model="directiveDraft" class="input" :maxlength="directives.maxLength" :placeholder="$t('game.settings.directivePlaceholder')" :disabled="directiveBusy || directives.list.length >= directives.maxCount" />
        <button type="submit" class="btn" :disabled="!directiveDraft.trim() || directiveBusy || directives.list.length >= directives.maxCount">{{ $t("game.settings.add") }}</button>
      </form>
      <small class="gs__muted">{{ directives.list.length }} / {{ directives.maxCount }}</small>
    </div>

    <div v-if="!loading && tab !== 'directives'" class="gs__foot">
      <span v-if="savedTick" class="gs__saved">{{ $t("game.settings.saved") }}</span>
      <button type="button" class="btn btn--primary" :disabled="!dirty || saving" @click="save">{{ $t("game.settings.save") }}</button>
    </div>
  </div>
</template>

<style scoped>
.gs { display: grid; grid-template-rows: auto 1fr auto; gap: var(--s-3); max-height: 100%; min-height: 0; color: var(--ink, #f4f6fb); font-size: 13px; }
.gs__head { display: flex; align-items: center; gap: var(--s-3); }
.gs__head > b { font-size: 15px; }
.gs__tabs { display: flex; gap: 2px; margin-left: auto; }
.gs__tab { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 3px; color: var(--ink-2, #ccd); }
.gs__tab--on { background: rgba(143, 214, 255, 0.18); color: #fff; }
.gs__body { overflow-y: auto; min-height: 0; display: grid; gap: var(--s-3); padding-right: 4px; }
.gs__group { display: grid; gap: var(--s-2); }
.gs__eyebrow { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--cyan, #8fd6ff); }
.gs__family { display: grid; gap: 2px; }
.gs__family-name { font-weight: 600; margin-top: 4px; }
.gs__family-name small { display: block; font-weight: 400; color: var(--ink-3, #99a); }
.gs__variant { display: grid; grid-template-columns: auto auto 1fr auto auto; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer; border: 1px solid transparent; }
.gs__variant:hover { background: rgba(255, 255, 255, 0.06); }
.gs__variant--on { background: rgba(143, 214, 255, 0.12); border-color: rgba(143, 214, 255, 0.35); }
.gs__variant input { margin: 0; }
.gs__dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; }
.gs__dot[data-s="green"] { background: #3ddc84; } .gs__dot[data-s="yellow"] { background: #ffd54a; } .gs__dot[data-s="red"] { background: #ff6b66; }
.gs__vname small { color: var(--ink-3, #99a); }
.gs__cost { font-variant-numeric: tabular-nums; color: var(--ink-2, #ccd); }
.gs__badge { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: rgba(242, 176, 30, 0.2); color: #ffd35c; }
.gs__row { display: grid; gap: 6px; }
.gs__label { color: var(--ink-3, #99a); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.gs__seg { display: flex; flex-wrap: wrap; gap: 4px; }
.gs__segbtn { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 3px; border: 1px solid rgba(255, 255, 255, 0.14); color: var(--ink-2, #ccd); }
.gs__segbtn--on { background: rgba(143, 214, 255, 0.18); border-color: rgba(143, 214, 255, 0.5); color: #fff; }
.gs__field { display: grid; gap: 4px; }
.gs__field span { color: var(--ink-3, #99a); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.gs__field .input, .gs__add .input { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.14); color: inherit; }
.gs__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.gs__item { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); padding: 6px 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.06); }
.gs__add { display: flex; gap: var(--s-2); }
.gs__foot { display: flex; align-items: center; justify-content: flex-end; gap: var(--s-3); }
.gs__saved { color: #3ddc84; }
.gs__muted { margin: 0; color: var(--ink-3, #99a); }
.gs__error { margin: 0; color: #ff9b96; }
</style>
