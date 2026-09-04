<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { completeLogin } from "@/lib/oauth";
import { useSession } from "@/lib/session";

const router = useRouter();
const session = useSession();
const error = ref("");

onMounted(async () => {
  try {
    const { token, returnTo } = await completeLogin(new URLSearchParams(location.search));
    await session.adopt(token);
    // 用 replace：回上一頁不該再回到帶著授權碼的網址。
    await router.replace(returnTo);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "登入失敗";
  }
});
</script>

<template>
  <div class="page page--narrow">
    <template v-if="error">
      <p class="notice notice--error">{{ error }}</p>
      <button class="btn" @click="session.login('/')">重新登入</button>
    </template>
    <p v-else class="muted">正在完成登入…</p>
  </div>
</template>
