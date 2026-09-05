<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink, onBeforeRouteLeave, useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { fetchRoleDetail, patchRole, type RoleDraft } from "@/lib/api";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { confirmDialog } from "@/lib/confirm";
import { track } from "@/lib/track";

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

const SUMMARY_MAX = 500;
/** 有沒有改過：儲存鈕只在有東西可存時才亮，離開前也靠它判斷要不要攔 */
const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(original.value));

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

/* 改到一半離開要問一聲：站內換頁與關分頁都攔 */
/* 儲存中不放行：鍵盤也走得到返回連結，這時彈「放棄修改？」文不對題 */
onBeforeRouteLeave(async () => !saving.value && (!dirty.value || await confirmDialog({ message: t("edit.discard"), confirmText: t("dialog.leave"), danger: true })));
const guard = (e: BeforeUnloadEvent) => { if (dirty.value) e.preventDefault(); };
onMounted(() => window.addEventListener("beforeunload", guard));
onBeforeUnmount(() => window.removeEventListener("beforeunload", guard));

async function submit() {
  if (!dirty.value) return;
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
      // 只認頓號與逗號：英文標籤裡有空白（slice of life），拆了就變三個沒意義的字
      patch.roleTag = form.value.roleTag.split(/[、,，]+/).map((t) => t.trim()).filter(Boolean);
    }

    await patchRole(roleId, patch, token);
    original.value = { ...form.value };
    saved.value = true;
    track("card_edit", { subject: roleId });
  } catch (err) {
    track("card_edit", { subject: roleId, ok: false });
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

    <div v-if="loading" class="ghosts" aria-hidden="true">
      <div class="ghost" style="height: 36px" />
      <div class="ghost" style="height: 96px" />
      <div class="ghost" style="height: 36px" />
      <div class="ghost" style="height: 240px" />
    </div>

    <form v-else @submit.prevent="submit">
      <div class="field">
        <label for="name">{{ $t("edit.name") }}</label>
        <input id="name" v-model="form.roleName" class="input" maxlength="60" />
      </div>

      <div class="field">
        <label for="desc">{{ $t("edit.summary") }}</label>
        <textarea id="desc" v-model="form.roleDesc" class="input" :maxlength="SUMMARY_MAX" rows="3" />
        <span class="field__foot">
          <span class="subtle">{{ $t("edit.summary.hint") }}</span>
          <span class="subtle" :class="{ over: form.roleDesc.length >= SUMMARY_MAX }">{{ $t("edit.chars", { n: form.roleDesc.length, max: SUMMARY_MAX }) }}</span>
        </span>
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

      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <p v-else-if="saved && !dirty" class="notice" role="status">{{ $t("edit.saved") }}</p>

      <div class="actions">
        <button class="btn btn--primary" type="submit" :disabled="saving || !dirty">
          {{ saving ? $t("edit.saving") : $t("edit.save") }}
        </button>
        <RouterLink class="btn" :class="{ 'is-off': saving }" :aria-disabled="saving || undefined" :to="{ path: lp('/mine'), query: { fresh: '1' } }">{{ $t("edit.back") }}</RouterLink>
      </div>
    </form>
  </div>
</template>

<style scoped>
h1 { margin: 2px 0 var(--s-2); font-size: 24px; }
h1 + .muted { margin: 0 0 var(--s-6); max-width: 52ch; }
.ghosts { display: grid; gap: var(--s-4); }
.actions { display: flex; gap: var(--s-3); margin-top: var(--s-5); }
.over { color: var(--danger); }
.is-off { pointer-events: none; opacity: 0.45; }
</style>
