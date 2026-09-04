<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { createRole } from "@/lib/api";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";

const router = useRouter();
const session = useSession();
const { lp } = useLocalePath();
const { t } = useI18n();

const roleName = ref("");
const language = ref("zh-Hant");
const saving = ref(false);
const error = ref("");

const LANGS = [
  { value: "zh-Hant", label: "繁體中文" },
  { value: "zh-Hans", label: "简体中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

async function submit() {
  if (!roleName.value.trim()) return;
  saving.value = true;
  error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const created = await createRole({ roleName: roleName.value.trim(), language: language.value }, token);
    // 建立後直接進編輯頁把設定寫完——只有名字的卡沒辦法對話。
    if (created.roleId) await router.push(lp(`/cards/${created.roleId}/edit`));
    else await router.push({ path: lp("/mine"), query: { fresh: "1" } });
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.createFailed");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page page--narrow">
    <p class="eyebrow">{{ $t("mine.eyebrow") }}</p>
    <h1 class="display">{{ $t("create.title") }}</h1>
    <p class="muted">
      {{ $t("create.lede") }}
    </p>

    <form @submit.prevent="submit">
      <div class="field">
        <label for="name">{{ $t("create.name") }}</label>
        <input id="name" v-model="roleName" class="input" maxlength="60" :placeholder="$t('create.name.placeholder')" required />
      </div>

      <div class="field">
        <label for="lang">{{ $t("create.language") }}</label>
        <select id="lang" v-model="language" class="input">
          <option v-for="l in LANGS" :key="l.value" :value="l.value">{{ l.label }}</option>
        </select>
      </div>

      <p v-if="error" class="notice notice--error">{{ error }}</p>

      <button class="btn btn--primary" type="submit" :disabled="saving || !roleName.trim()">
        {{ saving ? $t("create.submitting") : $t("create.submit") }}
      </button>
    </form>
  </div>
</template>

<style scoped>
h1 { margin: 2px 0 var(--s-2); font-size: 24px; }
h1 + .muted { margin: 0 0 var(--s-6); max-width: 52ch; }
</style>
