<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { confirmDialog } from "@/lib/confirm";
import {
  communityRequest,
  takeDiscordReceipt,
  communityRequestId,
  forgetCommunityRequest,
  type CommunityView,
  type CommunityNotice,
  type CommunityCase,
} from "@/lib/community";
const session = useSession(),
  { t } = useI18n(),
  { lp } = useLocalePath(),
  route = useRoute();
const data = ref<CommunityView | null>(null),
  error = ref(""),
  busy = ref(false),
  notices = ref<CommunityNotice[]>([]),
  cases = ref<CommunityCase[]>([]),
  selected = ref<CommunityCase | null>(null),
  reply = ref("");
const caseLoaded = ref(false);
const showForm = ref(false),
  title = ref(""),
  body = ref(""),
  category = ref("bug"),
  caseOffset = ref(0);
const card =
  typeof route.query.reportCard === "string" ? route.query.reportCard : "";
const categories = [
  "bug",
  "billing",
  "account",
  "card_error",
  "review",
  "card_report",
];
const prefs = [
  ["publicBadges", "public_badges"],
  ["notifications", "notifications"],
  ["discordDm", "discord_dm"],
  ["caseAccess", "case_access"],
] as const;
const linked = computed(
  () => !!data.value?.link && data.value.link.state !== "cleanup",
);
const caseAllowed = computed(
  () => linked.value && data.value?.preferences.case_access === 1,
);
const state = computed(() => data.value?.link?.state ?? "unlinked");
let alive = true,
  timer: ReturnType<typeof setInterval> | undefined;
const request = async <T,>(path = "", method = "GET", input?: unknown) => {
  const token = await session.accessToken();
  if (!token) throw new Error(t("auth.expired"));
  return communityRequest<T>("/me/community" + path, token, method, input);
};
async function load() {
  data.value = await request<CommunityView>();
  if (data.value.preferences.notifications)
    notices.value = (
      await request<{ items: CommunityNotice[] }>("/notifications")
    ).items;
  else notices.value = [];
}
async function run(task: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await task();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("community.failed");
  } finally {
    busy.value = false;
  }
}
async function connect() {
  await run(async () => {
    const nonce = crypto.randomUUID() + crypto.randomUUID();
    sessionStorage.setItem("community.discord.nonce", nonce);
    sessionStorage.setItem("community.discord.return", route.fullPath);
    const result = await request<{ url: string }>("/link", "POST", { nonce });
    const url = new URL(result.url);
    if (url.origin !== "https://discord.com")
      throw new Error(t("community.failed"));
    location.assign(url.toString());
  });
}
async function disconnect() {
  if (
    !(await confirmDialog({
      title: t("community.unlink"),
      message: t("community.unlinkDetail", {
        name: data.value?.link?.name ?? "",
      }),
      confirmText: t("community.unlink"),
      danger: true,
    }))
  )
    return;
  await run(async () => {
    data.value = await request<CommunityView>("/link", "DELETE");
    cases.value = [];
    selected.value = null;
  });
}
async function preference(key: string, value: boolean) {
  await run(async () => {
    data.value = await request<CommunityView>("/preferences", "PATCH", {
      [key]: value,
    });
    if (key === "caseAccess" && !value) {
      cases.value = [];
      selected.value = null;
    }
    await load();
  });
}
async function retry() {
  await run(async () => {
    data.value = await request<CommunityView>("/retry", "POST", {});
  });
}
// A timed-out action keeps its request ID until the same input gets a durable result.
async function caseRequest<T>(input: Record<string, unknown>): Promise<T> {
  const scope = session.profile?.handle;
  if (!scope) throw new Error(t("community.failed"));
  const requestId = await communityRequestId(scope, input);
  const job = await request<{ id: string }>("/cases", "POST", {
    ...input,
    requestId,
  });
  for (let i = 0; i < 20 && alive; i++) {
    const result = await request<{
      status: string;
      result: T & { error?: string };
    }>("/cases/" + job.id);
    if (result.status === "done") {
      await forgetCommunityRequest(scope, input);
      if (result.result?.error) throw new Error(t("community.caseError"));
      return result.result;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(t("community.pendingCase"));
}
async function listCases(offset = 0) {
  await run(async () => {
    cases.value = (
      await caseRequest<{ items: CommunityCase[] }>({ action: "list", offset })
    ).items;
    caseOffset.value = offset;
    caseLoaded.value = true;
    selected.value = null;
  });
}
async function openCase(c: CommunityCase) {
  await run(async () => {
    selected.value = await caseRequest<CommunityCase>({
      action: "read",
      caseId: c.id,
    });
    reply.value = "";
  });
}
async function submitCase() {
  await run(async () => {
    selected.value = await caseRequest<CommunityCase>({
      action: "create",
      title: title.value,
      body: body.value,
      category: category.value,
      ...(card ? { card } : {}),
    });
    showForm.value = false;
    title.value = "";
    body.value = "";
  });
}
async function act(action: string) {
  if (
    action === "request_close" &&
    !(await confirmDialog({ message: t("community.closeConfirm") }))
  )
    return;
  await run(async () => {
    const c = selected.value!;
    selected.value = await caseRequest<CommunityCase>({
      action,
      caseId: c.id,
      version: c.version,
      body: action === "supplement" ? reply.value : "",
    });
    reply.value = "";
  });
}
async function readNotice(n: CommunityNotice) {
  try {
    await request("/notifications/read", "POST", { id: n.id });
    n.read_at = Date.now();
  } catch {
    error.value = t("community.failed");
  }
}
onMounted(
  () =>
    void run(async () => {
      const receipt = takeDiscordReceipt(),
        nonce = sessionStorage.getItem("community.discord.nonce");
      if (receipt) {
        try {
          if (!nonce) throw new Error(t("community.expired"));
          await request("/complete", "POST", { receipt, nonce });
        } catch (e) {
          error.value = e instanceof Error ? e.message : t("community.expired");
        } finally {
          sessionStorage.removeItem("community.discord.nonce");
        }
      }
      if (sessionStorage.getItem("community.discord.error")) {
        sessionStorage.removeItem("community.discord.error");
        error.value = t("community.expired");
      }
      await load();
      timer = setInterval(() => {
        if (!busy.value && document.visibilityState === "visible")
          void load().catch(() => {});
      }, 15000);
    }),
);
onBeforeUnmount(() => {
  alive = false;
  if (timer) clearInterval(timer);
});
</script>
<template>
  <section
    class="community"
    aria-labelledby="community-title"
    :aria-busy="busy"
  >
    <header>
      <div>
        <h2 id="community-title">{{ t("community.title") }}</h2>
        <p class="subtle">{{ t("community.hint") }}</p>
      </div>
      <a
        v-if="data?.invite"
        :href="data.invite"
        target="_blank"
        rel="noopener noreferrer"
        class="btn"
        >{{ t("community.join") }}</a
      >
    </header>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <div v-if="!data" class="community__loading">
      <p>{{ t("state.loading") }}</p>
      <button v-if="error" class="btn" :disabled="busy" @click="run(load)">
        {{ t("community.retry") }}
      </button>
    </div>
    <template v-else>
      <p v-if="!data.enabled" class="notice">
        {{ t("community.unavailable") }}
      </p>
      <template v-else>
        <div class="community__identity">
          <div>
            <strong>{{ data.link?.name || t("community.unlinked") }}</strong>
            <p role="status">{{ t("community.states." + state) }}</p>
          </div>
          <button
            v-if="!data.link"
            class="btn btn--primary"
            :disabled="busy"
            @click="connect"
          >
            {{ t("community.link") }}</button
          ><button v-else class="btn" :disabled="busy" @click="retry">
            {{ t("community.retry") }}
          </button>
        </div>
        <div class="community__progress">
          <strong>{{ t("community.level", { level: data.level }) }}</strong
          ><span>{{ data.xp }} XP</span
          ><progress
            :value="data.xp - data.level * data.level * 10"
            :max="((data.level + 1) ** 2 - data.level ** 2) * 10"
            :aria-label="t('community.progress')"
          /><small>{{ t("community.xpRule") }}</small>
        </div>
        <p v-if="data.badges.length" class="community__badges">
          <span v-for="badge in data.badges" :key="badge">{{
            t("community.badges." + badge)
          }}</span>
        </p>
        <details>
          <summary>{{ t("community.preferences") }}</summary>
          <div class="community__preferences">
            <button
              v-for="[key, column] in prefs"
              :key="key"
              type="button"
              class="community__toggle"
              :aria-pressed="!!data.preferences[column]"
              :disabled="
                busy ||
                ((key === 'discordDm' || key === 'caseAccess') && !linked)
              "
              @click="preference(key, !data.preferences[column])"
            >
              <span>{{ t("community." + key) }}</span
              ><strong>{{
                t(data.preferences[column] ? "community.on" : "community.off")
              }}</strong></button
            ><button
              v-if="linked"
              class="community__toggle"
              :aria-pressed="data.xpEnabled"
              :disabled="busy"
              @click="preference('xpEnabled', !data.xpEnabled)"
            >
              <span>{{ t("community.xpEnabled") }}</span
              ><strong>{{
                t(data.xpEnabled ? "community.on" : "community.off")
              }}</strong>
            </button>
            <p class="subtle">{{ t("community.privacy") }}</p>
            <button
              v-if="linked"
              class="btn"
              :disabled="busy"
              @click="disconnect"
            >
              {{ t("community.unlink") }}
            </button>
          </div>
        </details>
        <section
          v-if="data.preferences.notifications"
          class="community__section"
        >
          <h3>{{ t("community.notificationsTitle") }}</h3>
          <p v-if="!notices.length" class="subtle">
            {{ t("community.noNotifications") }}
          </p>
          <ul v-else class="community__list">
            <li v-for="n in notices" :key="n.id">
              <RouterLink :to="lp(n.path)" @click="readNotice(n)"
                ><span>{{ t("community.notices." + n.kind) }}</span
                ><small
                  >{{ new Date(n.created_at).toLocaleDateString() }} ·
                  {{
                    t(n.read_at ? "community.read" : "community.unread")
                  }}</small
                ></RouterLink
              >
            </li>
          </ul>
        </section>
        <section class="community__section">
          <h3>{{ t("community.cases") }}</h3>
          <p v-if="!caseAllowed" class="subtle">
            {{ t("community.caseConsent") }}
          </p>
          <template v-else>
            <div class="community__actions">
              <button class="btn" :disabled="busy" @click="listCases()">
                {{ t("community.refreshCases") }}</button
              ><button
                class="btn"
                :disabled="busy"
                @click="showForm = !showForm"
              >
                {{ t(showForm ? "community.cancel" : "community.newCase") }}
              </button>
            </div>
            <form
              v-if="showForm"
              class="community__form"
              @submit.prevent="submitCase"
            >
              <label
                >{{ t("community.category")
                }}<select :disabled="busy" v-model="category">
                  <option v-for="c in categories" :key="c" :value="c">
                    {{ t("community.categories." + c) }}
                  </option>
                </select></label
              ><label
                >{{ t("community.caseTitle")
                }}<input
                  :disabled="busy"
                  v-model="title"
                  required
                  maxlength="80" /></label
              ><label
                >{{ t("community.content")
                }}<textarea
                  :disabled="busy"
                  v-model="body"
                  required
                  maxlength="1000"
                  rows="5"
                />
              </label>
              <p v-if="card" class="subtle">
                {{ t("community.cardContext", { card }) }}
              </p>
              <p class="subtle">{{ t("community.casePrivacy") }}</p>
              <button
                class="btn btn--primary"
                :disabled="busy || !title.trim() || !body.trim()"
              >
                {{ t("community.submit") }}
              </button>
            </form>
            <p v-if="caseLoaded && !cases.length" class="subtle">
              {{ t("community.noCases") }}
            </p>
            <ul v-if="cases.length" class="community__list">
              <li v-for="c in cases" :key="c.id">
                <button :disabled="busy" @click="openCase(c)">
                  <strong>{{ c.title }}</strong
                  ><small>{{ t("community.caseStates." + c.state) }}</small>
                </button>
              </li>
            </ul>
            <div v-if="cases.length || caseOffset" class="community__actions">
              <button
                v-if="caseOffset"
                class="btn"
                :disabled="busy"
                @click="listCases(Math.max(0, caseOffset - 10))"
              >
                {{ t("pager.prev") }}</button
              ><button
                v-if="cases.length === 10"
                class="btn"
                :disabled="busy"
                @click="listCases(caseOffset + 10)"
              >
                {{ t("pager.next") }}
              </button>
            </div>
            <article v-if="selected" class="community__case">
              <h4>{{ selected.title }}</h4>
              <p>{{ t("community.caseStates." + selected.state) }}</p>
              <p
                v-for="event in selected.events"
                :key="event.seq"
                class="community__message"
              >
                {{ event.body }}
              </p>
              <a
                v-if="selected.conversation"
                :href="selected.conversation"
                target="_blank"
                rel="noopener noreferrer"
                class="btn"
                >{{ t("community.conversation") }}</a
              >
              <form
                v-if="selected.state !== 'closed'"
                class="community__form"
                @submit.prevent="act('supplement')"
              >
                <label
                  >{{ t("community.reply")
                  }}<textarea
                    :disabled="busy"
                    v-model="reply"
                    required
                    maxlength="1400"
                    rows="3"
                  /></label
                ><button
                  class="btn btn--primary"
                  :disabled="busy || !reply.trim()"
                >
                  {{ t("community.submit") }}
                </button>
              </form>
              <button
                class="btn"
                :disabled="busy"
                @click="
                  act(
                    selected.state === 'closed'
                      ? 'request_reopen'
                      : 'request_close',
                  )
                "
              >
                {{
                  t(
                    selected.state === "closed"
                      ? "community.reopen"
                      : "community.close",
                  )
                }}
              </button>
            </article>
          </template>
        </section>
      </template>
    </template>
  </section>
</template>
<style scoped>
.community {
  display: grid;
  gap: var(--s-5);
  padding: var(--s-5);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  min-width: 0;
}
.community header,
.community__identity {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  flex-wrap: wrap;
}
.community h2,
.community h3,
.community h4,
.community p {
  margin: 0;
}
.community h2 {
  font-size: 18px;
}
.community h3 {
  font-size: 16px;
}
.community header p,
.community__identity p {
  margin-top: var(--s-2);
  font-size: 14px;
}
.community__progress {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--s-2);
  padding: var(--s-4);
  border-radius: var(--r-sm);
  background: var(--surface-2);
}
progress {
  width: 100%;
  grid-column: 1/-1;
  accent-color: var(--accent);
}
.community small {
  color: var(--text-3);
  line-height: 1.6;
}
.community__progress small {
  grid-column: 1/-1;
}
.community__badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
}
.community__badges span {
  padding: var(--s-2) var(--s-3);
  border-radius: var(--r-pill);
  background: var(--accent-tint);
  color: var(--accent-text);
  font-size: 13px;
}
.community summary {
  cursor: pointer;
  min-height: 44px;
  display: flex;
  align-items: center;
  font-weight: 600;
}
.community details:not([open]) > .community__preferences {
  display: none;
}
.community__preferences,
.community__section,
.community__form,
.community__case {
  display: grid;
  gap: var(--s-4);
}
.community__toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  min-height: 44px;
  border: 0;
  border-bottom: 1px solid var(--line-strong);
  background: transparent;
  color: var(--text);
  text-align: start;
  cursor: pointer;
  padding: var(--s-3) 0;
}
.community__toggle strong {
  color: var(--text-3);
  flex: none;
}
.community__toggle[aria-pressed="true"] strong {
  color: var(--accent-text);
}
.community__section {
  border-top: 1px solid var(--line-strong);
  padding-top: var(--s-5);
}
.community__actions {
  display: flex;
  gap: var(--s-3);
  flex-wrap: wrap;
}
.community__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--s-2);
}
.community__list a,
.community__list button {
  display: grid;
  gap: var(--s-1);
  width: 100%;
  min-height: 44px;
  padding: var(--s-3);
  background: var(--surface-2);
  border: 0;
  border-radius: var(--r-sm);
  text-align: start;
  color: var(--text);
  cursor: pointer;
  overflow-wrap: anywhere;
}
.community__form label {
  display: grid;
  gap: var(--s-2);
  font-size: 14px;
}
.community__form input,
.community__form textarea,
.community__form select {
  width: 100%;
  min-height: 44px;
  padding: var(--s-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  box-sizing: border-box;
}
.community__form .btn,
.community__case > .btn {
  justify-self: start;
}
.community__message {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: var(--s-3);
  border-inline-start: 2px solid var(--line-strong);
}
.community .btn {
  min-height: 44px;
}
.community summary::after {
  content: "+";
  margin-inline-start: auto;
}
.community details[open] summary::after {
  content: "−";
}
.community button:disabled {
  opacity: 0.5;
  cursor: default;
}
.community__loading {
  min-height: 100px;
}
.community :focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
@media (max-width: 700px) {
  .community {
    padding: var(--s-4);
  }
}
</style>
