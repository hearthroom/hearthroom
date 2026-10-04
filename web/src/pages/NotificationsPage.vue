<script setup lang="ts">
/**
 * 「通知」：登入者的通知清單與通知設定。
 *
 * 通知是「我的」層級的東西，Discord 私訊只是其中一種送達方式——所以清單與站內／瀏覽器的
 * 開關在這裡，Discord 綁定與私訊提醒留在社群頁，這裡只給一句引導。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import AccountIcon from "@/components/AccountIcon.vue";
import { communityRequest, type CommunityNotice, type CommunityView } from "@/lib/community";
import { pageTitle } from "@/lib/i18n";
import { noticeText, useNotifications } from "@/lib/notifications";
import { disablePush, enablePush, pushState, pushSupported, type PushState } from "@/lib/push";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";

const session = useSession();
const store = useNotifications();
const { t } = useI18n();
const { lp, locale } = useLocalePath();
const view = ref<CommunityView | null>(null);
const push = ref<PushState>(pushSupported() ? "off" : "unsupported");
const busy = ref(false);
const error = ref("");

const prefs = [["notifications", "notifications"], ["likeNotifications", "like_notifications"]] as const;
const linked = computed(() => !!view.value?.link && view.value.link.state !== "cleanup");
const dmOn = computed(() => linked.value && view.value?.preferences.discord_dm === 1);
const discordHint = computed(() => (!linked.value ? "notifications.discordUnlinked" : dmOn.value ? "notifications.discordOn" : "notifications.discordOff"));

async function token(): Promise<string> {
  const value = await session.accessToken();
  if (!value) throw new Error(t("auth.expired"));
  return value;
}
async function run(task: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; error.value = "";
  try { await task(); } catch (e) { error.value = e instanceof Error ? e.message : t("community.failed"); } finally { busy.value = false; }
}
async function load() {
  const value = await token();
  await store.load(locale.value);
  view.value = await communityRequest<CommunityView>("/me/community", value);
  push.value = await pushState(value);
}
function preference(key: string, value: boolean) {
  void run(async () => { view.value = await communityRequest<CommunityView>("/me/community/preferences", await token(), "PATCH", { [key]: value }); });
}
function togglePush() {
  void run(async () => { const value = await token(); push.value = push.value === "on" ? await disablePush(value) : await enablePush(value, locale.value); });
}
function pick(n: CommunityNotice) { void store.read(n); }
const when = (n: CommunityNotice) => new Date(n.created_at).toLocaleDateString(locale.value);
onMounted(() => { document.title = pageTitle(t("nav.notifications")); void run(load); });
</script>

<template>
  <div v-if="session.me" class="page page--narrow notices" :aria-busy="busy">
    <RouterLink :to="lp('/me')" class="notices__back"><AccountIcon name="arrow" />{{ t("community.backToProfile") }}</RouterLink>
    <header class="notices__head">
      <h1>{{ t("nav.notifications") }}</h1>
      <button v-if="store.unread" type="button" class="btn" :disabled="busy" @click="store.readAll()">{{ t("notifications.readAll") }}</button>
    </header>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <section class="notices__card" :aria-label="t('nav.notifications')">
      <p v-if="store.busy && !store.loaded" class="subtle">{{ t("state.loading") }}</p>
      <p v-else-if="!store.items.length" class="subtle">{{ t("notifications.empty") }}</p>
      <ul v-else class="notices__list">
        <li v-for="n in store.items" :key="n.id">
          <RouterLink :to="lp(n.path)" class="notices__item" :class="{ 'notices__item--unread': !n.read_at }" @click="pick(n)">
            <span>{{ noticeText(n) }}</span>
            <small>{{ when(n) }} · {{ t(n.read_at ? "community.read" : "community.unread") }}</small>
          </RouterLink>
        </li>
      </ul>
    </section>

    <section class="notices__card" aria-labelledby="notices-settings">
      <h2 id="notices-settings">{{ t("notifications.settings") }}</h2>
      <template v-if="view">
        <button v-for="[key, column] in prefs" :key="key" type="button" class="notices__toggle" :aria-pressed="!!view.preferences[column]" :disabled="busy" @click="preference(key, !view.preferences[column])">
          <span>{{ t("community." + key) }}</span><strong>{{ t(view.preferences[column] ? "community.on" : "community.off") }}</strong>
        </button>
      </template>
      <button type="button" class="notices__toggle" :aria-pressed="push === 'on'" :disabled="busy || push === 'unsupported' || push === 'blocked'" @click="togglePush">
        <span>{{ t("community.push") }}</span>
        <strong>{{ t(push === "on" ? "community.on" : push === "blocked" ? "community.pushBlocked" : push === "unsupported" ? "community.pushUnsupported" : "community.off") }}</strong>
      </button>
      <p class="subtle">{{ t("community.pushHint") }}</p>
      <div class="notices__discord">
        <p>{{ t(discordHint) }}</p>
        <RouterLink :to="lp('/me/community')" class="btn">{{ t(linked ? "notifications.discordGoSettings" : "notifications.discordGoLink") }}<AccountIcon name="arrow" /></RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.notices { display: grid; gap: var(--s-4); }
.notices__back { display: inline-flex; align-items: center; justify-self: start; gap: var(--s-2); min-height: var(--h-lg); color: var(--text-2); }
.notices__back:hover { color: var(--accent-text); }
.notices__back svg { width: 1rem; height: 1rem; transform: rotate(180deg); }
.notices__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.notices__head h1 { margin: 0; font-size: 24px; }
.notices__card { display: grid; gap: var(--s-4); padding: var(--s-5); border: 1px solid var(--line-strong); border-radius: var(--r-md); background: var(--surface); }
.notices__card h2 { margin: 0; font-size: 16px; }
.notices__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.notices__item { display: grid; gap: var(--s-1); padding: var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); color: var(--text); }
.notices__item:hover { background: var(--line); }
.notices__item--unread { background: var(--accent-tint); }
.notices__item small { color: var(--text-3); font-size: 12px; }
.notices__toggle { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); min-height: 44px; border: 0; border-bottom: 1px solid var(--line-strong); background: transparent; color: var(--text); text-align: start; cursor: pointer; padding: var(--s-3) 0; }
.notices__toggle strong { color: var(--text-3); flex: none; }
.notices__toggle[aria-pressed="true"] strong { color: var(--accent-text); }
.notices__discord { display: grid; gap: var(--s-3); justify-items: start; padding-top: var(--s-3); border-top: 1px solid var(--line-strong); }
.notices__discord p { margin: 0; color: var(--text-2); font-size: 14px; }
.notices__discord .btn { display: inline-flex; align-items: center; gap: var(--s-2); }
.notices__discord .btn svg { width: 1rem; height: 1rem; }
</style>
