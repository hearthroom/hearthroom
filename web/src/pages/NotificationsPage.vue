<script setup lang="ts">
/**
 * 「通知」：登入者的通知清單與通知設定。
 *
 * 通知是「我的」層級的東西，Discord 私訊只是其中一種送達方式——所以清單與站內／瀏覽器的
 * 開關在這裡，Discord 綁定與私訊提醒留在社群頁，這裡只給一句引導。
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink,useRoute } from "vue-router";
import AccountIcon from "@/components/AccountIcon.vue";
import MascotSay from "@/components/MascotSay.vue";
import { communityRequest, type CommunityNotice, type CommunityView } from "@/lib/community";
import { pageTitle } from "@/lib/i18n";
import { noticeText, noticeUpdateNote, useNotifications } from "@/lib/notifications";
import { disablePush, enablePush, pushConfig, pushState, pushSupported, type PushConfig, type PushState } from "@/lib/push";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import NewMark from "@/components/NewMark.vue";

const route=useRoute();
const expanded=ref(new Set<string>());
function toggleLog(id:string){if(expanded.value.has(id))expanded.value.delete(id);else expanded.value.add(id);}
const session = useSession();
const store = useNotifications();
const { t } = useI18n();
const { lp, locale } = useLocalePath();
const view = ref<CommunityView | null>(null);
const push = ref<PushState>(pushSupported() ? "off" : "unsupported");
// 公鑰在進頁面時先抓好：按下開關的第一件事必須是瀏覽器的詢問，中間不能再等網路。
const config = ref<PushConfig>({ enabled: false, publicKey: null });
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
  void pushConfig().then(value => { config.value = value; });
  const value = await token();
  await store.load(locale.value);
  view.value = await communityRequest<CommunityView>("/me/community", value);
  push.value = await pushState(value);
}
function preference(key: string, value: boolean) {
  void run(async () => { view.value = await communityRequest<CommunityView>("/me/community/preferences", await token(), "PATCH", { [key]: value }); });
}
function togglePush() {
  void run(async () => { push.value = push.value === "on" ? await disablePush(await token()) : await enablePush(token, locale.value, config.value); });
}
function pick(n: CommunityNotice) { void store.read(n); }
watch(()=>[route.hash,store.items],async()=>{
 let id='';try{if(route.hash.startsWith('#notice-'))id=decodeURIComponent(route.hash.slice(8));}catch{return;}
 const n=store.items.find(n=>n.id===id);if(!n||!noticeUpdateNote(n))return;
 expanded.value.add(id);await nextTick();document.getElementById('notice-'+id)?.scrollIntoView?.({block:'nearest'});
},{immediate:true});
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
      <div v-else-if="!store.items.length" class="notices__empty">
        <MascotSay src="/mascot/chuchu-heart.webp" :size="112" />
        <p class="subtle">{{ t("notifications.empty") }}</p>
      </div>
      <ul v-else class="notices__list">
        <li v-for="n in store.items" :key="n.id" :id="'notice-'+n.id">
          <RouterLink :to="lp(n.path)" class="notices__item" :class="{ 'notices__item--unread': !n.read_at }" @click="pick(n)">
            <span>{{ noticeText(n) }}</span>
            <small>{{ when(n) }} · {{ t(n.read_at ? "community.read" : "community.unread") }}</small>
          </RouterLink>
          <div v-if="noticeUpdateNote(n)" class="notices__update">
            <strong class="subtle">{{t('cardUpdate.notice.updateLog')}}</strong>
            <p :id="'notice-log-'+n.id" class="notices__log" :class="{'notices__log--preview':!expanded.has(n.id)}">{{noticeUpdateNote(n)}}</p>
            <button type="button" class="link" :aria-expanded="expanded.has(n.id)" :aria-controls="'notice-log-'+n.id" @click="toggleLog(n.id)">{{t(expanded.has(n.id)?'cardUpdate.notice.hideUpdateLog':'cardUpdate.notice.showUpdateLog')}}</button>
          </div>
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
      <button type="button" class="notices__toggle" :aria-pressed="push === 'on'" :disabled="busy || push === 'unsupported'" @click="togglePush">
        <span>{{ t("community.push") }}<NewMark k="notifications.push" /></span>
        <strong>{{ t(push === "on" ? "community.on" : push === "blocked" ? "community.pushBlocked" : push === "dismissed" ? "community.pushDismissed" : push === "unsupported" ? "community.pushUnsupported" : "community.off") }}</strong>
      </button>
      <p v-if="push === 'blocked'" class="notice notice--error" role="status">{{ t("community.pushBlockedHint") }}</p>
      <p v-else-if="push === 'dismissed'" class="notice" role="status">{{ t("community.pushDismissedHint") }}</p>
      <p class="subtle">{{ t("community.pushHint") }}</p>
      <div class="notices__discord">
        <p>{{ t(discordHint) }}</p>
        <RouterLink :to="lp('/me/community')" class="btn">{{ t(linked ? "notifications.discordGoSettings" : "notifications.discordGoLink") }}<AccountIcon name="arrow" /></RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.notices__update { display:grid; gap:var(--s-2); padding:0 var(--s-3) var(--s-3); }
.notices__update button { color:var(--accent-text); justify-self:start; min-height:var(--h-lg); font-size:13px; }
.notices__log { white-space:pre-wrap; overflow-wrap:anywhere; font-size:14px; line-height:1.7; }
.notices__log--preview { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; }
.notices__list > li { scroll-margin-top:calc(var(--header-h) + var(--s-4)); }
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
.notices__empty { display: grid; justify-items: center; gap: var(--s-3); padding: var(--s-6) var(--s-4); text-align: center; }
.notices__empty .subtle { max-width: 36ch; font-size: 13.5px; line-height: 1.6; }
</style>
