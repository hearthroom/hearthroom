<script setup lang="ts">
/**
 * /play/:roleId — 在站內玩一張卡。
 *
 * 整頁交給舞台（stage/ 打成的 moonstage/stage 套件）：沒有站台的頁首頁尾（route.meta.bare），
 * 因為魅魔島那類卡靠全頁樣式換背景與輸入框，套上站台外框會打架。
 * 這頁只負責三件事：把套件載進來並接上宿主、把 roleId 交給畫布、畫舞台丟出來的提示。
 */
import { computed, getCurrentInstance, onMounted, shallowRef, watch, type Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ensureStage, remergeStageMessages, stageToasts } from "@/lib/stage-host";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { pageTitle } from "@/lib/i18n";
import { track } from "@/lib/track";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { locale, lp } = useLocalePath();
const { t } = useI18n();

const roleId = computed(() => String(route.params.roleId || ""));
const Stage = shallowRef<Component | null>(null);
const error = shallowRef("");

// 路由守衛每次導航都會把標題設回預設，換卡（同一個元件實例）之後要再蓋一次
watch(roleId, () => { document.title = pageTitle(t("play.title")); }, { immediate: true });

onMounted(async () => {
  const app = getCurrentInstance()?.appContext.app;
  if (!app) return;
  try {
    Stage.value = await ensureStage({
      app,
      router,
      session,
      currentPath: () => route.fullPath,
      lp,
    });
    track("play_open", { subject: roleId.value });
  } catch (e) {
    console.error("[play] stage failed to load", e);
    error.value = t("play.loadFailed");
  }
});

watch(locale, () => { void remergeStageMessages(); });
</script>

<template>
  <div class="play">
    <component :is="Stage" v-if="Stage" :key="roleId" :role-id="roleId" />
    <div v-else class="play__state">
      <p v-if="error" class="play__error" role="alert">{{ error }}</p>
      <p v-else class="subtle">{{ $t("play.loading") }}</p>
      <RouterLink v-if="error" class="btn" :to="lp(`/cards/${roleId}`)">{{ $t("play.backToCard") }}</RouterLink>
    </div>
    <div class="play__toasts" aria-live="polite">
      <div v-for="toast in stageToasts.list" :key="toast.id" class="play__toast" :class="`play__toast--${toast.kind}`">{{ toast.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.play { min-height: 100vh; }
.play__state { min-height: 60vh; display: grid; place-content: center; gap: var(--s-4); text-align: center; padding: var(--s-6); }
.play__error { color: var(--danger); }
.play__toasts { position: fixed; left: 50%; top: var(--s-4); transform: translateX(-50%); z-index: 1200; display: grid; gap: var(--s-2); pointer-events: none; }
.play__toast { padding: var(--s-2) var(--s-4); border-radius: var(--r-md); background: var(--surface); color: var(--text); box-shadow: var(--shadow-2); font-size: 14px; max-width: min(90vw, 480px); }
.play__toast--error { border-left: 3px solid var(--danger); }
.play__toast--success { border-left: 3px solid var(--accent); }
</style>
