<script setup lang="ts">
/**
 * 已登入首頁頂端的蘇綺面板（設定集 docs/design/hearthroom-mascot；畫板「首頁（桌機・已登入）」）。
 *
 * 一整張畫：左邊是看的人自己的（問候、四個選項），右邊是蘇綺，中間是她的說話泡泡，選項的結果都在泡泡裡。
 * 不替人挑卡（owner 2026-10-13）：
 *   - 接著上次的故事：自己最近的三段對話；一段都沒有就不出這個選項
 *   - 找新卡：不在這裡列卡，交給下面的榜單——切到日榜、捲過去
 *   - 隨便來一張：榜上隨機擲一張，結果就在泡泡裡
 *   - 提筆寫新卡：自己最近的一張卡接著寫，或另起一張；這家供應商不能寫卡就不出
 * 她說的話要跟畫面一致：說「這幾個」就列出那幾個，擲骰子只出一張。
 * 配色跟著場景（白天淺底深字、晚上深底淺字），不吃站台主題。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { fetchConversations, type ConversationSummary } from "@/lib/library";
import { fetchBoard, fetchMyCards, type MyCard } from "@/lib/api";
import { platformPath } from "@/lib/connection-ui";
import { contentLang, defaultZone } from "@/lib/i18n";
import { displayName } from "@/lib/display-name";
import { relativeTime } from "@/lib/format";
import { can } from "@/lib/provider";
import { viewerAdult } from "@/lib/adult-consent";
import { track } from "@/lib/track";
import { greetingOf, isNight, poseOf, sceneOf, slotOf, type HomeIntent } from "@/lib/mascot-home";
import type { CommunityCard } from "@/lib/types";

const emit = defineEmits<{ discover: [] }>();
const session = useSession();
const { t } = useI18n();
const { locale, lp } = useLocalePath();

const now = new Date();
const slot = slotOf(now);
const night = isNight(now);
const scene = sceneOf(now);
const dark = scene.night;

const chats = ref<ConversationSummary[] | null>(null);
const intent = ref<HomeIntent>("discover");
const rolled = ref<CommunityCard | null>(null);
const rollState = ref<"idle" | "busy" | "empty" | "failed">("idle");
const mine = ref<MyCard | null>(null);
const writeState = ref<"idle" | "busy" | "done" | "failed">("idle");

const canWrite = computed(() => can("editor"));
const intents = computed<HomeIntent[]>(() => [
  ...(chats.value?.length ? ["resume" as const] : []),
  "discover", "roll",
  ...(canWrite.value ? ["write" as const] : []),
]);
const ready = computed(() => chats.value !== null);

const name = computed(() => session.me?.nickName?.trim() || t("mascot.home.you"));
const greeting = computed(() => t(`mascot.home.greet.${greetingOf(now)}`, { name: name.value }));
const label = (k: HomeIntent) => k === "resume" ? t(`mascot.home.intent.resume.${night ? "night" : "day"}`) : t(`mascot.home.intent.${k}`);
/** 骰子沒擲到（榜上沒卡或讀不到）時換成撲空的那張，話跟表情對得上 */
const pose = computed(() => `/mascot/home/pose-${intent.value === "roll" && (rollState.value === "empty" || rollState.value === "failed") ? "fail" : poseOf(intent.value, now)}.webp`);

const line = computed(() => {
  switch (intent.value) {
    case "resume":
      if (night && viewerAdult(session)?.showNsfw) return t("mascot.home.line.resume.adult");
      if (slot === "late") return t("mascot.home.line.resume.late");
      return t(`mascot.home.line.resume.${night ? "night" : "day"}`);
    case "discover": return t("mascot.home.line.discover");
    case "roll":
      if (rollState.value === "busy") return t("mascot.home.line.rolling");
      if (rollState.value === "empty") return t("mascot.home.line.rollEmpty");
      if (rollState.value === "failed") return t("mascot.home.line.failed");
      return t("mascot.home.line.roll");
    case "write":
      if (writeState.value === "failed") return t("mascot.home.line.failed");
      if (mine.value) return t("mascot.home.line.write", { name: displayName(mine.value.name, locale.value) });
      return writeState.value === "done" ? t("mascot.home.line.writeFirst") : "";
  }
  return "";
});

const resumes = computed(() => (chats.value ?? []).slice(0, 3).map((c) => ({
  key: `${c.provider}:${c.conversationRoleId}`,
  href: platformPath(lp(`/play/${encodeURIComponent(c.cardNumber ?? c.conversationRoleId)}?resume=${encodeURIComponent(c.conversationId)}`), c.provider),
  title: c.conversationTitle || displayName(c.roleName, locale.value) || t("library.untitled"),
  avatar: c.roleAvatar,
  when: (() => { const v = Date.parse(c.lastChatTime || c.createTime || ""); return Number.isFinite(v) ? relativeTime(v) : ""; })(),
})));

async function loadChats() {
  try {
    const token = await session.accessToken();
    if (!token) { chats.value = []; return; }
    const got = await fetchConversations(token, contentLang(locale.value), 1);
    chats.value = Array.isArray(got?.conversations) ? got.conversations : [];
  } catch { chats.value = []; }
  if (chats.value.length) intent.value = "resume";
}

async function roll() {
  rollState.value = "busy";
  try {
    const page = await fetchBoard({ zone: defaultZone(locale.value), sort: "random", limit: 1, lang: contentLang(locale.value) });
    rolled.value = page.items[0] ?? null;
    rollState.value = rolled.value ? "idle" : "empty";
  } catch { rolled.value = null; rollState.value = "failed"; }
}

async function loadMine() {
  writeState.value = "busy";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error("auth");
    const page = await fetchMyCards(token, { pageSize: 1 });
    mine.value = page.items[0] ?? null;
    writeState.value = "done";
  } catch { mine.value = null; writeState.value = "failed"; }
}

function pick(k: HomeIntent) {
  intent.value = k;
  track("mascot_home", { detail: k });
  if (k === "discover") emit("discover");
  else if (k === "roll" && !rolled.value && rollState.value !== "busy") void roll();
  else if (k === "write" && writeState.value === "idle") void loadMine();
}

onMounted(loadChats);
watch(() => session.me?.accountNumId, (now, before) => { if (before !== undefined && now !== before) { chats.value = null; void loadChats(); } });
</script>

<template>
  <section class="home" :class="{ 'home--dark': dark }" :aria-label="$t('mascot.name')">
    <img class="home__scene" :src="`/mascot/home/scene-${scene.id}.webp`" alt="" decoding="async" />
    <div class="home__veil" aria-hidden="true" />

    <div class="home__lead">
      <p class="home__greet">{{ greeting }}</p>
      <h2 class="home__ask">{{ $t(`mascot.home.ask.${slot}`) }}</h2>
      <div v-if="ready" class="home__intents" role="group">
        <button v-for="k in intents" :key="k" type="button" class="home__intent" :class="{ 'home__intent--on': intent === k }" :aria-pressed="intent === k" @click="pick(k)">{{ label(k) }}</button>
      </div>
    </div>

    <div v-if="ready" class="home__bubble" aria-live="polite">
      <p v-if="line" class="home__line">「{{ line }}」</p>

      <div v-if="intent === 'resume'" class="home__rows">
        <a v-for="r in resumes" :key="r.key" :href="r.href" class="home__row">
          <img v-if="r.avatar" class="home__thumb" :src="r.avatar" alt="" loading="lazy" />
          <span v-else class="home__thumb" />
          <span class="home__rowtext"><b>{{ r.title }}</b><small v-if="r.when">{{ r.when }}</small></span>
          <span class="home__go">{{ $t("mascot.home.action.continue") }}</span>
        </a>
      </div>

      <div v-else-if="intent === 'discover'" class="home__actions">
        <button type="button" class="home__btn home__btn--primary" @click="emit('discover')">{{ $t("mascot.home.action.toBoard") }}</button>
      </div>

      <template v-else-if="intent === 'roll'">
        <RouterLink v-if="rolled" :to="lp(`/cards/${rolled.num ?? rolled.id}`)" class="home__rolled">
          <img v-if="rolled.avatarUrl" class="home__cover" :src="rolled.avatarUrl" alt="" />
          <span v-else class="home__cover" />
          <span class="home__rolledtext"><b>{{ displayName(rolled.name, locale) }}</b><small>{{ rolled.summary }}</small></span>
        </RouterLink>
        <div class="home__actions">
          <RouterLink v-if="rolled" :to="lp(`/cards/${rolled.num ?? rolled.id}`)" class="home__btn home__btn--primary">{{ $t("mascot.home.action.openCard") }}</RouterLink>
          <button type="button" class="home__btn" :disabled="rollState === 'busy'" @click="roll">{{ $t("mascot.home.action.reroll") }}</button>
        </div>
      </template>

      <template v-else-if="intent === 'write'">
        <RouterLink v-if="mine" :to="lp(`/cards/${encodeURIComponent(mine.roleId)}/edit`)" class="home__row">
          <img v-if="mine.avatarUrl" class="home__thumb" :src="mine.avatarUrl" alt="" />
          <span v-else class="home__thumb" />
          <span class="home__rowtext"><b>{{ displayName(mine.name, locale) }}</b></span>
          <span class="home__go">{{ $t("mascot.home.action.keepWriting") }}</span>
        </RouterLink>
        <div v-if="writeState !== 'busy'" class="home__actions">
          <RouterLink :to="lp('/create')" class="home__btn home__btn--primary">{{ $t("mascot.home.action.newCard") }}</RouterLink>
        </div>
      </template>
    </div>

    <img class="home__suki" :src="pose" alt="" decoding="async" />
  </section>
</template>

<style scoped>
/*
 * 版位照畫板（桌機 1152×320）：字 x 40–400、泡泡 x 492–832、人物 x 820 起站在底邊。
 * 用百分比跟著寬度縮，三塊不會互相壓到；窄到放不下就換成手機排法（字在上、泡泡在下、人物在右上角）。
 */
.home {
  --fg: #2a1d24; --sub: #5c4650; --chip: rgba(255, 255, 255, 0.8); --chip-on: #2a1d24; --chip-on-fg: #fff;
  --veil: linear-gradient(90deg, rgba(255, 247, 242, 0.94) 0%, rgba(255, 247, 242, 0.8) 32%, rgba(255, 247, 242, 0) 46%);
  position: relative; overflow: hidden; isolation: isolate;
  height: 320px; margin-bottom: var(--s-5);
  border-radius: var(--r-lg); color: var(--fg);
  box-shadow: 0 0 0 1px var(--line);
  background: #f3e3dc;
}
.home--dark {
  --fg: #f7f2ff; --sub: #c9c4e6; --chip: rgba(255, 255, 255, 0.14); --chip-on: #f7f2ff; --chip-on-fg: #14183a;
  --veil: linear-gradient(90deg, rgba(8, 16, 44, 0.86) 0%, rgba(8, 16, 44, 0.66) 32%, rgba(8, 16, 44, 0) 46%);
  background: #141a33;
}
.home__scene { position: absolute; inset: 0; z-index: -2; width: 100%; height: 100%; object-fit: cover; object-position: 70% 50%; }
.home__veil { position: absolute; inset: 0; z-index: -1; background: var(--veil); }

.home__lead { position: absolute; left: 3.5%; top: 50%; transform: translateY(-50%); width: min(360px, 34%); display: grid; gap: var(--s-3); }
.home__greet { margin: 0; font-size: 14px; color: var(--sub); }
.home__ask { margin: 0; font-size: 30px; font-weight: 800; line-height: 1.25; }
.home__intents { display: grid; grid-template-columns: repeat(2, max-content); gap: var(--s-2); margin-top: var(--s-1); }
.home__intent {
  height: 40px; padding: 0 16px; border: 0; border-radius: var(--r-pill); cursor: pointer; text-align: left;
  font-size: 14px; font-weight: 600; background: var(--chip); color: var(--fg);
}
.home__intent--on { background: var(--chip-on); color: var(--chip-on-fg); }

.home__bubble {
  position: absolute; left: 42.7%; top: 32px; width: min(340px, 29.5%); box-sizing: border-box;
  padding: 16px; border-radius: 20px; display: grid; gap: var(--s-3);
  background: rgba(255, 255, 255, 0.96); color: #2a1d24;
  box-shadow: 0 10px 28px -10px rgba(0, 0, 0, 0.4);
}
/* 尖角指向她 */
.home__bubble::after {
  content: ""; position: absolute; right: -8px; top: 44px; width: 18px; height: 18px;
  background: rgba(255, 255, 255, 0.96); transform: rotate(45deg); border-radius: 3px;
}
.home__line { margin: 0; font-size: 14.5px; line-height: 1.6; position: relative; z-index: 1; }
.home__rows { display: grid; gap: 4px; position: relative; z-index: 1; }
.home__row {
  display: flex; align-items: center; gap: 12px; padding: 6px 10px 6px 6px;
  border-radius: 12px; color: inherit; text-decoration: none; background: rgba(42, 29, 36, 0.04);
  position: relative; z-index: 1;
}
.home__row:hover { background: rgba(42, 29, 36, 0.09); }
.home__thumb { width: 32px; height: 42px; flex: none; border-radius: 8px; object-fit: cover; background: linear-gradient(160deg, #f6c1cf, #ef4f6f); }
.home__rowtext { flex: 1; min-width: 0; display: grid; font-size: 13px; line-height: 1.45; }
.home__rowtext b, .home__rolledtext b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home__rowtext small { color: #7a6670; font-size: 12px; }
.home__go { font-size: 13px; font-weight: 700; color: #c9224d; flex: none; }
.home__rolled { display: flex; gap: 12px; color: inherit; text-decoration: none; position: relative; z-index: 1; }
.home__cover { width: 64px; height: 86px; flex: none; border-radius: 10px; object-fit: cover; background: linear-gradient(160deg, #f6c1cf, #ef4f6f); }
.home__rolledtext { min-width: 0; display: grid; align-content: start; gap: 4px; font-size: 14px; }
.home__rolledtext small {
  color: #7a6670; font-size: 13px; line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.home__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); position: relative; z-index: 1; }
.home__btn {
  height: 36px; padding: 0 18px; display: inline-flex; align-items: center;
  border-radius: var(--r-pill); border: 1px solid rgba(42, 29, 36, 0.18); background: transparent;
  color: #2a1d24; font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer;
}
.home__btn--primary { background: #e6153f; border-color: #e6153f; color: #fff; font-weight: 700; }
.home__btn:disabled { opacity: 0.5; cursor: default; }

.home__suki { position: absolute; left: 71.2%; bottom: 0; height: 280px; width: auto; max-width: none; pointer-events: none; }

/* 中等寬度：人物縮一點、往右靠，泡泡跟著縮 */
@media (max-width: 1100px) {
  .home__suki { left: auto; right: 1%; height: 240px; }
  .home__bubble { left: 40%; width: min(320px, 34%); }
}

/*
 * 手機：整塊壓在四分之一螢幕左右，下面的榜單第一屏就看得到卡（owner 2026-10-13）。
 * 問句一行、選項一排橫滑，下面是泡泡＋她（跟桌機同一個關係：泡泡在左、尖角朝右指她）。
 * 泡泡最多兩筆；問候和問句省掉，選項本身就是在問。
 */
@media (max-width: 760px) {
  .home { height: auto; padding: 12px; display: flex; flex-direction: column; gap: var(--s-2); }
  .home--dark .home__veil { background: linear-gradient(180deg, rgba(8, 16, 44, 0.7), rgba(8, 16, 44, 0.35)); }
  .home:not(.home--dark) .home__veil { background: linear-gradient(180deg, rgba(255, 247, 242, 0.86), rgba(255, 247, 242, 0.5)); }
  .home__lead { display: contents; }
  .home__greet, .home__ask { display: none; }
  .home__intents {
    order: 2; display: flex; gap: 6px; margin: 0 -12px; padding: 0 12px;
    overflow-x: auto; scrollbar-width: none;
  }
  .home__intents::-webkit-scrollbar { display: none; }
  .home__intent { flex: none; height: 32px; padding: 0 12px; font-size: 13px; }
  .home__bubble { order: 3; position: relative; left: auto; top: auto; width: auto; margin-right: 104px; padding: 10px 12px; gap: var(--s-2); border-radius: 16px; }
  .home__bubble::after { top: 22px; }
  .home__line { font-size: 13px; line-height: 1.5; }
  .home__rows .home__row:nth-child(n + 3) { display: none; }
  .home__row { padding: 4px 8px 4px 4px; gap: 10px; }
  .home__thumb { width: 26px; height: 34px; border-radius: 6px; }
  .home__rowtext { font-size: 12.5px; line-height: 1.35; }
  .home__cover { width: 40px; height: 54px; border-radius: 8px; }
  .home__rolledtext { font-size: 13px; }
  .home__rolledtext small { -webkit-line-clamp: 2; font-size: 12px; }
  .home__btn { height: 32px; padding: 0 14px; font-size: 13px; }
  .home__suki { left: auto; right: 4px; bottom: 0; height: 112px; }
}
</style>
