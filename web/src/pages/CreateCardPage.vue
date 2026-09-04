<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { createRole } from "@/lib/api";
import { useSession } from "@/lib/session";

const router = useRouter();
const session = useSession();

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
    if (!token) throw new Error("登入已失效，請重新登入");
    const created = await createRole({ roleName: roleName.value.trim(), language: language.value }, token);
    // 建立後直接進編輯頁把設定寫完——只有名字的卡沒辦法對話。
    if (created.roleId) await router.push(`/cards/${created.roleId}/edit`);
    else await router.push("/mine");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "建立失敗";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page page--narrow">
    <p class="eyebrow">作者工作區</p>
    <h1 class="display">建立角色卡</h1>
    <p class="muted">
      先取個名字，建立後再補上簡介與設定。新卡預設是私有的，只有你看得到；
      要出現在社群榜單上，得由你自己去登記。
    </p>

    <form @submit.prevent="submit">
      <div class="field">
        <label for="name">角色名稱</label>
        <input id="name" v-model="roleName" class="input" maxlength="60" placeholder="例如：夜行偵探 沈墨" required />
      </div>

      <div class="field">
        <label for="lang">主要語言</label>
        <select id="lang" v-model="language" class="input">
          <option v-for="l in LANGS" :key="l.value" :value="l.value">{{ l.label }}</option>
        </select>
      </div>

      <p v-if="error" class="notice notice--error">{{ error }}</p>

      <button class="btn btn--primary" type="submit" :disabled="saving || !roleName.trim()">
        {{ saving ? "建立中…" : "建立並繼續編輯" }}
      </button>
    </form>
  </div>
</template>

<style scoped>
h1 { margin: var(--s-1) 0 var(--s-3); font-size: clamp(30px, 5vw, 42px); }
h1 + .muted { margin: 0 0 var(--s-6); max-width: 52ch; }
</style>
