<script setup lang="ts">
/**
 * 遊客在對話頁按下送出時彈的登入框（owner 2026-10-10）：他已經看了開場、挑好開場、打好字，
 * 這時候最想玩，所以在原地請他登入，不把他帶離這張卡。登入就是註冊（沒有帳號的會自動建立），
 * 登入完回到同一頁，舞台會把剛才的草稿放回輸入框（stage 的 canvas-guest）。
 * 字跟登入頁共用（login.*），按鈕的邏輯也一樣：照這個部署有的幾家列出來。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { currentProvider, legalPage, PROVIDERS } from "@/lib/provider";
import { availableProviders, chooseProvider } from "@/lib/provider-switch";
import { connectionMessage } from "@/lib/connection-ui";
import { useSession } from "@/lib/session";

const props = defineProps<{ returnTo: string }>();
const emit = defineEmits<{ close: [] }>();
const session = useSession();
const { locale } = useI18n();
const providers = ref<typeof PROVIDERS>([PROVIDERS[0]]);
const busy = ref(false);
const error = ref("");
const box = ref<HTMLElement | null>(null);

async function go(id: (typeof PROVIDERS)[number]["id"]) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await chooseProvider(id, { signedIn: false, logout: () => session.logout(), login: () => session.login(props.returnTo) });
  } catch (e) {
    error.value = connectionMessage(e);
    busy.value = false;
  }
}

function close() { if (!busy.value) emit("close"); }
function onKey(e: KeyboardEvent) { if (e.key === "Escape") { e.preventDefault(); close(); } }
let restore: HTMLElement | null = null;
onMounted(async () => {
  restore = document.activeElement as HTMLElement | null;
  document.addEventListener("keydown", onKey);
  providers.value = await availableProviders();
  await nextTick();
  box.value?.querySelector<HTMLElement>("button.btn--primary")?.focus();
});
onBeforeUnmount(() => { document.removeEventListener("keydown", onKey); restore?.focus?.(); });
</script>

<template>
  <Teleport to="body">
    <div class="sheet-backdrop" @click.self="close">
      <section ref="box" class="sheet panel" role="dialog" aria-modal="true" aria-labelledby="guest-signin-title">
        <h2 id="guest-signin-title" class="sheet__title">{{ $t("login.headline") }}</h2>
        <p class="sheet__lead">{{ $t("login.lead") }}</p>
        <p v-if="error" role="alert" class="notice notice--error">{{ error }}</p>
        <div class="sheet__actions">
          <button
            v-for="p in providers"
            :key="p.id"
            type="button"
            class="btn btn--lg"
            :class="p.id === currentProvider() ? 'btn--primary' : 'btn--ghost'"
            :disabled="busy"
            @click="go(p.id)"
          >
            {{ $t("login.continueWith", { provider: p.name }) }}
          </button>
          <button type="button" class="btn btn--ghost" :disabled="busy" @click="close">{{ $t("dialog.cancel") }}</button>
        </div>
        <i18n-t keypath="login.legal" tag="p" class="subtle sheet__legal">
          <template #provider>{{ providers[0].name }}</template>
          <template #terms><a :href="legalPage(providers[0].id, 'terms', locale)" target="_blank" rel="noopener">{{ $t("login.terms") }}</a></template>
          <template #privacy><a :href="legalPage(providers[0].id, 'privacy', locale)" target="_blank" rel="noopener">{{ $t("login.privacy") }}</a></template>
        </i18n-t>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet-backdrop {
  position: fixed; inset: 0; z-index: 105;
  display: grid; place-items: center; padding: var(--s-5);
  background: rgba(16, 16, 24, 0.45);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.sheet { width: min(420px, 100%); padding: var(--s-5); display: grid; gap: var(--s-3); text-align: center; box-shadow: 0 0 0 1px var(--line), var(--shadow-md); }
.sheet__title { font-size: 18px; font-weight: 600; line-height: 1.4; margin: 0; }
.sheet__lead { margin: 0; font-size: 14px; line-height: 1.6; color: var(--text-2); }
.sheet__actions { display: grid; gap: var(--s-2); margin-top: var(--s-1); }
.sheet__actions .btn { width: 100%; }
.sheet__legal { margin: 0; font-size: 12px; }
.sheet__legal a { color: inherit; text-decoration: underline; }

@media (max-width: 480px) {
  .sheet-backdrop { place-items: end center; padding: var(--s-3); padding-bottom: calc(var(--s-3) + env(safe-area-inset-bottom)); }
}
</style>
