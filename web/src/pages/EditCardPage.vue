<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { fetchRoleDetail, patchRole, type RoleDraft } from "@/lib/api";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";

const route = useRoute();
const session = useSession();
const { lp } = useLocalePath();
const { t } = useI18n();
const roleId = route.params.roleId as string;

const form = ref({ roleName: "", roleDesc: "", roleDetailDesc: "", roleTag: "" });
const original = ref({ ...form.value });
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const saved = ref(false);

onMounted(async () => {
  try {
    const token = await session.accessToken();
    const raw = await fetchRoleDetail(roleId, token ?? undefined);
    const tags = Array.isArray(raw.roleTag)
      ? (raw.roleTag as unknown[]).map((t) => (typeof t === "string" ? t : String((t as { tagName?: string })?.tagName ?? ""))).filter(Boolean)
      : [];
    form.value = {
      roleName: String(raw.roleName ?? ""),
      roleDesc: String(raw.roleDesc ?? ""),
      roleDetailDesc: String(raw.roleDetailDesc ?? ""),
      roleTag: tags.join("、"),
    };
    original.value = { ...form.value };
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
});

async function submit() {
  saving.value = true;
  error.value = "";
  saved.value = false;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));

    // 只送真的改過的欄位。整包送的話，載入失敗留下的空字串會把原內容洗掉。
    const patch: RoleDraft = {};
    if (form.value.roleName !== original.value.roleName) patch.roleName = form.value.roleName.trim();
    if (form.value.roleDesc !== original.value.roleDesc) patch.roleDesc = form.value.roleDesc;
    if (form.value.roleDetailDesc !== original.value.roleDetailDesc) patch.roleDetailDesc = form.value.roleDetailDesc;
    if (form.value.roleTag !== original.value.roleTag) {
      patch.roleTag = form.value.roleTag.split(/[、,，\s]+/).map((t) => t.trim()).filter(Boolean);
    }
    if (!Object.keys(patch).length) {
      saved.value = true;
      return;
    }

    await patchRole(roleId, patch, token);
    original.value = { ...form.value };
    saved.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.saveFailed");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page page--narrow">
    <p class="eyebrow">{{ $t("mine.eyebrow") }}</p>
    <h1 class="display">{{ $t("edit.title") }}</h1>
    <p class="muted">
      {{ $t("edit.lede") }}
    </p>

    <p v-if="loading" class="muted">{{ $t("state.loading") }}</p>

    <form v-else @submit.prevent="submit">
      <div class="field">
        <label for="name">{{ $t("edit.name") }}</label>
        <input id="name" v-model="form.roleName" class="input" maxlength="60" />
      </div>

      <div class="field">
        <label for="desc">{{ $t("edit.summary") }}</label>
        <textarea id="desc" v-model="form.roleDesc" class="input" maxlength="500" rows="3" />
        <span class="subtle">{{ $t("edit.summary.hint") }}</span>
      </div>

      <div class="field">
        <label for="tags">{{ $t("edit.tags") }}</label>
        <input id="tags" v-model="form.roleTag" class="input" :placeholder="$t('edit.tags.placeholder')" />
        <span class="subtle">{{ $t("edit.tags.hint") }}</span>
      </div>

      <div class="field">
        <label for="detail">{{ $t("edit.detail") }}</label>
        <textarea id="detail" v-model="form.roleDetailDesc" class="input" rows="12" />
        <span class="subtle">{{ $t("edit.detail.hint") }}</span>
      </div>

      <p v-if="error" class="notice notice--error">{{ error }}</p>
      <p v-else-if="saved" class="notice">{{ $t("edit.saved") }}</p>

      <div class="actions">
        <button class="btn btn--primary" type="submit" :disabled="saving">
          {{ saving ? $t("edit.saving") : $t("edit.save") }}
        </button>
        <RouterLink class="btn" :to="{ path: lp('/mine'), query: { fresh: '1' } }">{{ $t("edit.back") }}</RouterLink>
      </div>
    </form>
  </div>
</template>

<style scoped>
h1 { margin: var(--s-1) 0 var(--s-3); font-size: clamp(30px, 5vw, 42px); }
h1 + .muted { margin: 0 0 var(--s-6); max-width: 52ch; }
.actions { display: flex; gap: var(--s-3); margin-top: var(--s-5); }
</style>
