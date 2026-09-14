<script setup lang="ts">
/**
 * 使用者設定：遊玩任何卡片時，角色預設怎麼叫你、把你當成誰。
 *
 * 這份住在上游帳號層級（全局人設），所有卡片共用。卡片自己那份（試玩頁裡「用戶人設」
 * 選「單獨設置」）優先於這裡；稱呼留空時角色用你的暱稱（owner 2026-09-07）。
 * 建卡表單不再有「玩家稱呼」——那是卡片層級的舊欄位，酒館格式的卡不用它。
 *
 * 內容：成人內容開關（owner 2026-09-08）。這是本站自己的設定，住在成員上；第一次開要填出生日期，
 * 伺服器只用它算滿不滿 18、不保存。原生 <input type="date"> 在手機上就是日期選擇器，不另外拉套件。
 *
 * 不想看的類型（owner 2026-09-14）：勾起來的類型不會出現在榜單和搜尋裡。不分頁不分區——首頁還是一個池子，
 * 每個人自己拉窗簾。勾一下就存（跟成人開關一樣），存在成員上、換裝置跟著走；榜單排尾的「已隱藏 N 類」帶回這裡。
 */
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError, fetchPlayerPersona, savePlayerPersona, updateSiteSettings, type PlayerPersona } from "@/lib/api";
import { pageTitle } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { TAG_CATALOG, tagLabel } from "../../../shared/tag-catalog";

const session = useSession();
const { t } = useI18n();
const { locale } = useLocalePath();

const NAME_MAX = 20;
const DEFINE_MAX = 1000;
const SEX_OPTIONS = ["", "man", "women", "other"] as const;

const loading = ref(true);
const saving = ref(false);
const error = ref("");
const saved = ref(false);
const nickName = ref("");
const draft = reactive<PlayerPersona>({ userName: "", userSex: "", userDefine: "" });
let snapshot: PlayerPersona = { userName: "", userSex: "", userDefine: "" };

async function token(): Promise<string> {
  const value = await session.accessToken();
  if (!value) throw new Error(t("auth.expired"));
  return value;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const p = await fetchPlayerPersona(await token());
    nickName.value = p.nickName;
    snapshot = { userName: p.userName, userSex: p.userSex, userDefine: p.userDefine };
    Object.assign(draft, snapshot);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
}

/** 只送動到的欄位：上游每個欄位都是指標，沒送＝不動。 */
async function save() {
  if (saving.value) return;
  const patch: Partial<PlayerPersona> = {};
  for (const key of ["userName", "userSex", "userDefine"] as const) {
    if ((draft[key] || "") !== (snapshot[key] || "")) patch[key] = draft[key] || "";
  }
  saved.value = false;
  error.value = "";
  if (!Object.keys(patch).length) {
    saved.value = true;
    return;
  }
  saving.value = true;
  try {
    const p = await savePlayerPersona(patch, await token());
    snapshot = { userName: p.userName, userSex: p.userSex, userDefine: p.userDefine };
    Object.assign(draft, snapshot);
    saved.value = true;
  } catch (err) {
    // 稱呼與自我介紹會過內容審核，被擋下時上游講的是原因——原樣講。
    error.value = err instanceof ApiError || err instanceof Error ? err.message : t("state.saveFailed");
  } finally {
    saving.value = false;
  }
}

// ---- 成人內容開關 ----
const showNsfw = computed(() => !!session.profile?.showNsfw);
const ageVerified = computed(() => !!session.profile?.ageVerified);
const askingAge = ref(false);
const birthdate = ref("");
const nsfwBusy = ref(false);
const nsfwError = ref("");
const today = new Date().toISOString().slice(0, 10);

async function setNsfw(on: boolean) {
  nsfwError.value = "";
  // 還沒驗過年齡：先要生日，按「確認並開啟」才真的送
  if (on && !ageVerified.value && !askingAge.value) { askingAge.value = true; return; }
  if (nsfwBusy.value) return;
  nsfwBusy.value = true;
  try {
    const result = await updateSiteSettings({ showNsfw: on, ...(on && !ageVerified.value ? { birthdate: birthdate.value } : {}) }, await token());
    if (session.profile) { session.profile.showNsfw = result.showNsfw; session.profile.ageVerified = result.ageVerified; }
    askingAge.value = false;
    birthdate.value = "";
  } catch (err) {
    nsfwError.value = err instanceof ApiError || err instanceof Error ? err.message : t("state.saveFailed");
  } finally {
    nsfwBusy.value = false;
  }
}

// ---- 不想看的類型 ----
const hidden = computed(() => session.profile?.hiddenTags ?? []);
const hiddenBusy = ref(false);
const hiddenError = ref("");
const isHidden = (key: string) => hidden.value.includes(key);
async function toggleHidden(key: string) {
  if (hiddenBusy.value) return;
  hiddenError.value = "";
  const next = isHidden(key) ? hidden.value.filter((k) => k !== key) : [...hidden.value, key];
  hiddenBusy.value = true;
  try {
    const result = await updateSiteSettings({ hiddenTags: next }, await token());
    if (session.profile) session.profile.hiddenTags = result.hiddenTags;
  } catch (err) {
    hiddenError.value = err instanceof ApiError || err instanceof Error ? err.message : t("state.saveFailed");
  } finally {
    hiddenBusy.value = false;
  }
}

onMounted(() => {
  document.title = pageTitle(t("settings.title"));
  void load();
  // 從榜單「已隱藏 N 類」來的：捲到那一區
  if (location.hash === "#hidden") requestAnimationFrame(() => document.getElementById("hidden")?.scrollIntoView({ block: "start" }));
});
</script>

<template>
  <div class="page page--narrow">
    <header class="head">
      <h1 class="head__title display">{{ $t("settings.title") }}</h1>
    </header>

    <section class="panel persona">
      <p class="eyebrow">{{ $t("settings.persona.title") }}</p>
      <p class="subtle">{{ $t("settings.persona.desc") }}</p>

      <div v-if="loading" class="ghost persona__ghost" aria-hidden="true" />
      <form v-else class="persona__form" @submit.prevent="save">
        <div class="field">
          <label for="persona-name">{{ $t("settings.persona.name") }}</label>
          <input id="persona-name" v-model="draft.userName" class="input" :maxlength="NAME_MAX" :placeholder="$t('settings.persona.namePlaceholder')" />
          <p class="field__foot subtle">
            <span v-if="!draft.userName && nickName">{{ $t("settings.persona.nickHint", { name: nickName }) }}</span>
            <span class="persona__count">{{ draft.userName.length }} / {{ NAME_MAX }}</span>
          </p>
        </div>

        <div class="field">
          <label for="persona-sex">{{ $t("settings.persona.sex") }}</label>
          <select id="persona-sex" v-model="draft.userSex" class="input">
            <option v-for="opt in SEX_OPTIONS" :key="opt" :value="opt">{{ $t(`settings.persona.sex.${opt || "unset"}`) }}</option>
          </select>
        </div>

        <div class="field">
          <label for="persona-define">{{ $t("settings.persona.define") }}</label>
          <textarea id="persona-define" v-model="draft.userDefine" class="input" rows="6" :maxlength="DEFINE_MAX" :placeholder="$t('settings.persona.definePlaceholder')" />
          <p class="field__foot subtle"><span class="persona__count">{{ draft.userDefine.length }} / {{ DEFINE_MAX }}</span></p>
        </div>

        <p class="subtle persona__priority">{{ $t("settings.persona.priority") }}</p>

        <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
        <div class="persona__acts">
          <span v-if="saved" class="subtle" role="status">{{ $t("settings.saved") }}</span>
          <button type="submit" class="btn btn--primary" :disabled="saving">{{ saving ? $t("state.loading") : $t("settings.save") }}</button>
        </div>
      </form>
    </section>

    <section class="panel content">
      <p class="eyebrow">{{ $t("settings.content.title") }}</p>
      <label class="content__row">
        <span class="content__text">
          <strong>{{ $t("settings.content.nsfw") }}</strong>
          <span class="subtle">{{ $t("settings.content.nsfwDesc") }}</span>
          <span v-if="ageVerified" class="subtle content__verified">{{ $t("settings.content.verified") }}</span>
        </span>
        <input type="checkbox" class="content__switch" :checked="showNsfw" :disabled="nsfwBusy" @change="setNsfw(($event.target as HTMLInputElement).checked)" />
      </label>
      <form v-if="askingAge && !ageVerified" class="content__age" @submit.prevent="setNsfw(true)">
        <label for="birthdate">{{ $t("settings.content.birthdate") }}</label>
        <input id="birthdate" v-model="birthdate" type="date" class="input" :max="today" required />
        <p class="subtle">{{ $t("settings.content.birthdateHint") }}</p>
        <div class="persona__acts">
          <button type="button" class="btn btn--sm" @click="askingAge = false">{{ $t("dialog.cancel") }}</button>
          <button type="submit" class="btn btn--sm btn--primary" :disabled="nsfwBusy || !birthdate">{{ $t("settings.content.confirmAge") }}</button>
        </div>
      </form>
      <p v-if="nsfwError" class="notice notice--error" role="alert">{{ nsfwError }}</p>
    </section>

    <section id="hidden" class="panel content hidden">
      <p class="eyebrow">{{ $t("settings.hidden.title") }}</p>
      <p class="subtle hidden__desc">{{ $t("settings.hidden.desc") }}</p>
      <div class="hidden__chips" role="group" :aria-label="$t('settings.hidden.title')" :aria-busy="hiddenBusy">
        <button v-for="x in TAG_CATALOG" :key="x.key" type="button" class="tagchip" :class="{ 'is-on': isHidden(x.key) }" :aria-pressed="isHidden(x.key)" :disabled="hiddenBusy" @click="toggleHidden(x.key)">
          {{ tagLabel(x, locale) }}
        </button>
      </div>
      <p class="subtle" role="status">{{ hidden.length ? $t("settings.hidden.count", { n: hidden.length }) : $t("settings.hidden.none") }}</p>
      <p v-if="hiddenError" class="notice notice--error" role="alert">{{ hiddenError }}</p>
    </section>
  </div>
</template>

<style scoped>
.head { margin-bottom: var(--s-4); }
.head__title { font-size: clamp(20px, 2.6vw, 24px); margin: 0; }
.persona { padding: var(--s-4); display: grid; gap: var(--s-3); }
.persona__form { display: grid; gap: var(--s-3); }
.persona__ghost { height: 240px; border-radius: var(--r-md); }
.persona__count { margin-left: auto; font-variant-numeric: tabular-nums; }
.field__foot { display: flex; gap: var(--s-2); justify-content: space-between; }
.persona__priority { margin: 0; }
.persona__acts { display: flex; align-items: center; justify-content: flex-end; gap: var(--s-3); }
.content { padding: var(--s-4); display: grid; gap: var(--s-3); margin-top: var(--s-4); }
.content__row { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); cursor: pointer; }
.content__text { display: grid; gap: 2px; }
.content__verified { color: var(--accent-text); }
.content__switch { width: 22px; height: 22px; flex: none; accent-color: var(--accent); }
.content__age { display: grid; gap: var(--s-2); padding: var(--s-3); border: 1px solid var(--line); border-radius: var(--r-md); }
.hidden { scroll-margin-top: calc(var(--header-h, 56px) + var(--s-3)); }
.hidden__desc { margin: 0; }
.hidden__chips { display: flex; flex-wrap: wrap; gap: 6px; }
/* 跟榜單那排長得一樣；勾起來＝反白 */
.tagchip {
  display: inline-flex; align-items: center; gap: 5px;
  height: var(--h-sm); padding: 0 12px; white-space: nowrap;
  background: var(--surface); border: 0; border-radius: var(--r-pill);
  box-shadow: 0 0 0 1px var(--line);
  font-size: 13px; font-weight: 500; color: var(--text-2); cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.tagchip:hover { color: var(--text); box-shadow: 0 0 0 1px var(--line-strong); }
.tagchip.is-on { background: var(--text); color: var(--surface); box-shadow: none; }
.tagchip:disabled { cursor: progress; opacity: 0.7; }
</style>
