<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { fetchBoard, fetchMyRoles, registerCard, unregisterCard } from "@/lib/api";
import { compact } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { MyRole } from "@/lib/types";

const session = useSession();
const roles = ref<MyRole[]>([]);
const registered = ref<Set<string>>(new Set());
const loading = ref(true);
const error = ref("");
const busy = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) return;
    const mine = await fetchMyRoles(token);
    roles.value = mine;
    // 用作者 ID 反查本站登記了哪些，這樣每張卡都知道自己是「已登記」還是「可登記」。
    const board = await fetchBoard({ author: session.me?.accountNumId, limit: 100 });
    registered.value = new Set(board.items.map((c) => c.roleId));
  } catch (err) {
    error.value = err instanceof Error ? err.message : "載入失敗";
  } finally {
    loading.value = false;
  }
}

async function toggle(role: MyRole) {
  busy.value = role.roleId;
  error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error("登入已失效，請重新登入");
    if (registered.value.has(role.roleId)) {
      await unregisterCard(role.roleId, token);
      registered.value.delete(role.roleId);
    } else {
      await registerCard(role.roleId, token);
      registered.value.add(role.roleId);
    }
    // Set 的增刪不會觸發 Vue 的響應，換一個實例。
    registered.value = new Set(registered.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "操作失敗";
  } finally {
    busy.value = null;
  }
}

const registeredCount = computed(() => roles.value.filter((r) => registered.value.has(r.roleId)).length);

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="mine__head">
      <div>
        <p class="eyebrow">作者工作區</p>
        <h1 class="mine__title display">我的角色卡</h1>
        <p class="muted mine__sub">
          登記後就會出現在榜單上。作品的內容與封面會自動保持最新，改了不必回來重新登記。
        </p>
      </div>
      <RouterLink to="/create" class="btn btn--primary">建立新卡</RouterLink>
    </header>

    <p v-if="error" class="notice notice--error">{{ error }}</p>
    <p v-if="loading" class="muted">載入中…</p>
    <p v-else-if="!roles.length" class="notice">
      你還沒有任何角色卡。<RouterLink to="/create">先建立一張</RouterLink>。
    </p>

    <template v-else>
      <p class="subtle mine__count">{{ roles.length }} 張卡，其中 {{ registeredCount }} 張已登記到社群</p>
      <ul class="mine__list">
        <li v-for="role in roles" :key="role.roleId" class="row">
          <img v-if="role.avatarUrl" :src="role.avatarUrl" alt="" class="row__art" />
          <div v-else class="row__art row__art--empty">無圖</div>

          <div class="row__body">
            <strong>{{ role.name }}</strong>
            <p class="row__summary subtle">{{ role.summary || "（沒有簡介）" }}</p>
            <p class="subtle">{{ compact(role.talkNum) }} 次對話 · {{ role.visibility }}</p>
          </div>

          <div class="row__actions">
            <RouterLink class="btn btn--sm" :to="`/cards/${role.roleId}/edit`">編輯</RouterLink>
            <button
              class="btn btn--sm"
              :class="registered.has(role.roleId) ? 'btn--danger' : 'btn--primary'"
              :disabled="busy === role.roleId"
              @click="toggle(role)"
            >
              {{ busy === role.roleId ? "處理中…" : registered.has(role.roleId) ? "取消登記" : "登記到社群" }}
            </button>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.mine__head {
  display: flex; flex-wrap: wrap; gap: var(--s-4);
  align-items: flex-end; justify-content: space-between;
  padding-bottom: var(--s-4); margin-bottom: var(--s-4);
  border-bottom: 1px solid var(--rule);
}
.mine__title { margin: var(--s-1) 0 var(--s-2); font-size: clamp(30px, 4.6vw, 42px); }
.mine__sub { margin: 0; font-size: 14px; max-width: 54ch; }
.mine__count { margin: 0 0 var(--s-4); }

/* 作者的清單是工作區不是展示牆：用行列讓一眼掃得完，不做卡片格 */
.mine__list { display: grid; margin: 0; padding: 0; list-style: none; }
.row {
  display: flex; align-items: center; gap: var(--s-4);
  padding: var(--s-3) 0;
  border-bottom: 1px solid var(--rule);
}
.row__art { width: 48px; height: 62px; border-radius: var(--r-sm); object-fit: cover; flex: none; }
.row__art--empty {
  display: grid; place-items: center;
  background: var(--paper-raised); color: var(--text-faint); font-size: 11px;
}
.row__body { flex: 1; min-width: 0; }
.row__body > strong { font-family: var(--font-display); font-size: 18px; font-weight: 400; }
.row__summary { margin: 1px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row__actions { display: flex; gap: var(--s-2); flex: none; }
@media (max-width: 620px) { .row { flex-wrap: wrap; } .row__actions { width: 100%; } }
</style>
