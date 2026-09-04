<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { fetchRoleDetail, patchRole, type RoleDraft } from "@/lib/api";
import { useSession } from "@/lib/session";

const route = useRoute();
const session = useSession();
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
    error.value = err instanceof Error ? err.message : "載入失敗";
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
    if (!token) throw new Error("登入已失效，請重新登入");

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
    error.value = err instanceof Error ? err.message : "儲存失敗";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page page--narrow">
    <p class="eyebrow">作者工作區</p>
    <h1 class="display">編輯角色卡</h1>
    <p class="muted">
      改動會直接套用到這張卡。如果它已經登記在社群，榜單上的內容稍後也會跟著更新。
    </p>

    <p v-if="loading" class="muted">載入中…</p>

    <form v-else @submit.prevent="submit">
      <div class="field">
        <label for="name">角色名稱</label>
        <input id="name" v-model="form.roleName" class="input" maxlength="60" />
      </div>

      <div class="field">
        <label for="desc">簡介</label>
        <textarea id="desc" v-model="form.roleDesc" class="input" maxlength="500" rows="3" />
        <span class="subtle">榜單與搜尋結果顯示的就是這段。</span>
      </div>

      <div class="field">
        <label for="tags">標籤</label>
        <input id="tags" v-model="form.roleTag" class="input" placeholder="推理、民國、懸疑" />
        <span class="subtle">用頓號或逗號分隔。</span>
      </div>

      <div class="field">
        <label for="detail">角色設定</label>
        <textarea id="detail" v-model="form.roleDetailDesc" class="input" rows="12" />
        <span class="subtle">給 AI 看的完整設定，不會顯示在社群榜單上。</span>
      </div>

      <p v-if="error" class="notice notice--error">{{ error }}</p>
      <p v-else-if="saved" class="notice">已儲存。</p>

      <div class="actions">
        <button class="btn btn--primary" type="submit" :disabled="saving">
          {{ saving ? "儲存中…" : "儲存" }}
        </button>
        <RouterLink class="btn" :to="{ path: '/mine', query: { fresh: '1' } }">回到我的卡片</RouterLink>
      </div>
    </form>
  </div>
</template>

<style scoped>
h1 { margin: var(--s-1) 0 var(--s-3); font-size: clamp(30px, 5vw, 42px); }
h1 + .muted { margin: 0 0 var(--s-6); max-width: 52ch; }
.actions { display: flex; gap: var(--s-3); margin-top: var(--s-5); }
</style>
