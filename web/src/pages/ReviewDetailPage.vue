<script setup lang="ts">
/**
 * /review/:id — 一張待審卡的唯讀審核頁。
 *
 * 看的是原始碼，不是渲染後的卡（owner 2026-09-07）：人設、開場白、世界書條目（含停用的）、
 * 正規表示式規則與常駐區塊的原文，外加成本側寫。要看效果按「試玩」開遊玩頁。
 * 分區沿用編輯頁的分法（基本／人設／對話／世界書），只是每一格都是唯讀。不顯示作者。
 */
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, claimReview, fetchReviewDetail, releaseReview, stampReview, type ReviewDetail } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { pageTitle } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";

const route = useRoute();
const { t } = useI18n();
const { lp } = useLocalePath();
const session = useSession();

const id = computed(() => String(route.params.id || ""));
const data = ref<ReviewDetail | null>(null);
const loading = ref(true);
const error = ref("");
const done = ref("");
const busy = ref(false);
const note = ref("");
const section = ref<"basic" | "persona" | "dialogue" | "worldbook" | "display" | "cost">("basic");
const SECTIONS = ["basic", "persona", "dialogue", "worldbook", "display", "cost"] as const;

const doc = computed(() => data.value?.detail.document);
const claimedByMe = computed(() => !!data.value?.submission.claimedByMe);
const tags = computed(() => (doc.value?.roleTag ?? "").split(/[,，、]/).map((s) => s.trim()).filter(Boolean));
const decided = computed(() => !!data.value && data.value.submission.status !== "pending");

async function token() {
  const tok = await session.accessToken();
  if (!tok) throw new Error(t("auth.expired"));
  return tok;
}

async function load() {
  error.value = "";
  loading.value = !data.value;
  try {
    data.value = await fetchReviewDetail(id.value, await token());
    document.title = pageTitle(`${t("review.detail.title")} · ${data.value.detail.document.roleName}`);
  } catch (err) {
    error.value = err instanceof ApiError && err.status === 409 ? t("review.revoked") : err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function claim() {
  busy.value = true;
  error.value = "";
  try {
    await claimReview(id.value, await token());
    if (data.value) data.value.submission.claimedByMe = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = false;
  }
}

async function release() {
  busy.value = true;
  try {
    await releaseReview(id.value, await token());
    if (data.value) data.value.submission.claimedByMe = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = false;
  }
}

async function stamp(verdict: "approve" | "reject") {
  if (!claimedByMe.value) {
    error.value = t("review.claimFirst");
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const res = await stampReview(id.value, await token(), { verdict, note: note.value });
    done.value = verdict === "reject" ? t("review.done.rejected") : res.cardStatus === "approved" ? t("review.done.approved") : t("review.done.approve");
    if (data.value) {
      data.value.submission.status = res.status;
      data.value.submission.claimedByMe = false;
      data.value.submission.stamps.push({ verdict, note: note.value, at: Date.now() });
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = false;
  }
}

onMounted(() => { void load(); });
</script>

<template>
  <div class="page">
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <p v-if="done" class="notice" role="status">{{ done }} <RouterLink :to="lp('/review')">← {{ $t("review.eyebrow") }}</RouterLink></p>

    <div v-if="loading" class="ghost detail-ghost" aria-hidden="true" />

    <template v-else-if="data && doc">
      <header class="head">
        <div class="head__text">
          <p class="eyebrow">
            <RouterLink :to="lp('/review')">{{ $t("review.eyebrow") }}</RouterLink>
            · {{ $t(`review.kind.${data.submission.kind}`) }}
            · {{ $t("review.stamps", { n: data.submission.stamps.filter((s) => s.verdict === 'approve').length, required: data.submission.required }) }}
          </p>
          <h1 class="head__title display">{{ doc.roleName }}</h1>
          <p class="subtle">{{ doc.roleDesc }}</p>
        </div>
        <div class="head__acts">
          <RouterLink class="btn btn--sm" :to="lp(`/play/${data.card.roleId}`)" target="_blank">{{ $t("review.action.play") }}</RouterLink>
          <button v-if="claimedByMe" class="btn btn--sm" :disabled="busy || decided" @click="release">{{ $t("review.action.release") }}</button>
          <button v-else class="btn btn--sm btn--primary" :disabled="busy || decided" @click="claim">{{ $t("review.action.claim") }}</button>
        </div>
      </header>

      <div class="seg tabs">
        <button v-for="s in SECTIONS" :key="s" class="seg__item" :class="{ 'seg__item--on': section === s }" :aria-pressed="section === s" @click="section = s">
          {{ s === "display" || s === "cost" ? $t(`review.section.${s}`) : $t(`editor.section.${s}`) }}
        </button>
      </div>

      <section v-show="section === 'basic'" class="pane panel">
        <div class="field"><label>{{ $t("editor.name") }}</label><input class="input" :value="doc.roleName" readonly /></div>
        <div class="field"><label>{{ $t("editor.summary") }}</label><textarea class="input" rows="3" :value="doc.roleDesc" readonly /></div>
        <div class="field">
          <label>{{ $t("review.tags") }}</label>
          <ul class="tags"><li v-for="tag in tags" :key="tag" class="chip">{{ tag }}</li></ul>
        </div>
        <div class="field"><label>{{ $t("editor.userName") }}</label><input class="input" :value="doc.userName" readonly /></div>
        <div v-if="doc.roleAvatar" class="field"><label>{{ $t("editor.section.media") }}</label><img class="art" :src="doc.roleAvatar" alt="" /></div>
      </section>

      <section v-show="section === 'persona'" class="pane panel">
        <div class="field"><label>{{ $t("editor.detail") }}</label><textarea class="input mono" rows="18" :value="doc.roleDetailDesc" readonly /></div>
        <div class="field"><label>{{ $t("editor.contract") }}</label><textarea class="input mono" rows="6" :value="doc.roleOutputContract" readonly /></div>
        <div class="field"><label>{{ $t("editor.jailbreak") }}</label><textarea class="input mono" rows="6" :value="doc.jailbreak" readonly /></div>
      </section>

      <section v-show="section === 'dialogue'" class="pane panel">
        <div class="field"><label>{{ $t("editor.welcome") }}</label><textarea class="input mono" rows="10" :value="data.detail.greetings.welcome" readonly /></div>
        <div v-if="data.detail.greetings.alternates.length" class="field">
          <label>{{ $t("editor.alternates") }}</label>
          <textarea v-for="(a, i) in data.detail.greetings.alternates" :key="i" class="input mono" rows="5" :value="a" readonly />
        </div>
        <div v-if="data.detail.greetings.prologue.length" class="field">
          <label>{{ $t("editor.prologue") }}</label>
          <ul class="tags"><li v-for="(p, i) in data.detail.greetings.prologue" :key="i" class="chip">{{ p }}</li></ul>
        </div>
        <div class="field"><label>{{ $t("editor.talkExample") }}</label><textarea class="input mono" rows="8" :value="doc.talkExample" readonly /></div>
      </section>

      <section v-show="section === 'worldbook'" class="pane panel">
        <p v-if="!data.detail.worldbook" class="subtle">{{ $t("review.wb.none") }}</p>
        <template v-else>
          <p class="subtle">{{ data.detail.worldbook.name }} · {{ data.detail.worldbook.entries.length }}</p>
          <article v-for="e in data.detail.worldbook.entries" :key="e.entryId" class="entry" :class="{ 'entry--off': !e.isEnabled }">
            <header class="entry__head">
              <strong>{{ e.name || $t("wb.entry.untitled") }}</strong>
              <span v-if="e.isConstant" class="chip">{{ $t("review.entry.constant") }}</span>
              <span v-if="!e.isEnabled" class="chip">{{ $t("review.entry.disabled") }}</span>
              <span v-if="e.keywords.length" class="subtle">{{ e.keywords.join("、") }}</span>
              <span v-if="e.secondaryKeywords.length" class="subtle">+ {{ e.secondaryKeywords.join("、") }}</span>
            </header>
            <pre class="entry__body">{{ e.content }}</pre>
          </article>
        </template>
      </section>

      <section v-show="section === 'display'" class="pane panel">
        <p v-if="!data.detail.authorAsset.rules.length" class="subtle">{{ $t("review.rules.none") }}</p>
        <article v-for="r in data.detail.authorAsset.rules" :key="r.id" class="entry" :class="{ 'entry--off': !r.enabled }">
          <header class="entry__head">
            <strong>{{ r.name || r.id }}</strong>
            <span v-if="!r.enabled" class="chip">{{ $t("review.entry.disabled") }}</span>
          </header>
          <pre class="entry__body">{{ r.find }}</pre>
          <pre class="entry__body entry__body--replace">{{ r.replace }}</pre>
        </article>
        <div v-if="data.detail.authorAsset.mountTrigger" class="field">
          <label>{{ $t("review.mount") }}</label>
          <input class="input" :value="`${data.detail.authorAsset.mountTrigger} · ${data.detail.authorAsset.mountLayer} · ${data.detail.authorAsset.pageMode}`" readonly />
        </div>
      </section>

      <section v-show="section === 'cost'" class="pane panel">
        <dl class="cost">
          <dt>{{ $t("review.cost.persona") }}</dt><dd>{{ data.detail.costProfile.personaChars }}</dd>
          <dt>{{ $t("review.cost.entries") }}</dt>
          <dd>{{ data.detail.costProfile.worldbookEntryCount }}（{{ data.detail.costProfile.worldbookEnabledCount }} / {{ data.detail.costProfile.worldbookConstantCount }}）</dd>
          <dt>{{ $t("review.contentHash") }}</dt><dd class="mono small">{{ data.submission.contentHash }}</dd>
        </dl>
        <p class="notice">{{ $t("review.cost.constantTokens", { n: data.detail.costProfile.estimatedConstantTokens }) }}</p>
        <p class="notice">{{ $t("review.cost.maxTokens", { n: data.detail.costProfile.estimatedMaxTokens }) }}</p>
      </section>

      <section class="verdict panel">
        <p v-if="data.submission.stamps.length" class="subtle">
          {{ $t("review.stampsList") }}：
          <span v-for="(s, i) in data.submission.stamps" :key="i" class="chip" :class="{ 'chip--reject': s.verdict === 'reject' }">
            {{ $t(`review.action.${s.verdict}`) }} · {{ dateTime(s.at) }}<template v-if="s.note">：{{ s.note }}</template>
          </span>
        </p>
        <div class="field">
          <label for="review-note">{{ $t("review.note.label") }}</label>
          <textarea id="review-note" v-model="note" class="input" rows="3" :disabled="decided" />
        </div>
        <p v-if="!claimedByMe && !decided" class="subtle">{{ $t("review.claimFirst") }}</p>
        <div class="verdict__acts">
          <button class="btn btn--danger" :disabled="busy || decided || !claimedByMe || !note.trim()" @click="stamp('reject')">{{ $t("review.action.reject") }}</button>
          <button class="btn btn--primary" :disabled="busy || decided || !claimedByMe" @click="stamp('approve')">{{ $t("review.action.approve") }}</button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.head { display: flex; flex-wrap: wrap; gap: var(--s-4); align-items: flex-start; justify-content: space-between; margin-bottom: var(--s-4); }
.head__title { font-size: clamp(20px, 2.6vw, 24px); margin: 2px 0; }
.head__acts { display: flex; gap: var(--s-2); }
.tabs { margin-bottom: var(--s-4); overflow-x: auto; }
.pane { padding: var(--s-4); margin-bottom: var(--s-4); }
.pane .field:last-child { margin-bottom: 0; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
.small { font-size: 12px; word-break: break-all; }
.art { max-width: 200px; border-radius: var(--r-md); }
.tags { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--s-2); }
.entry { padding: var(--s-3) 0; border-top: 1px solid var(--line); }
.entry:first-of-type { border-top: 0; }
.entry--off { opacity: 0.6; }
.entry__head { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; margin-bottom: var(--s-2); }
.entry__body { margin: 0; padding: var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
.entry__body--replace { margin-top: var(--s-2); border-left: 3px solid var(--accent); }
.cost { display: grid; grid-template-columns: auto 1fr; gap: var(--s-2) var(--s-4); margin: 0 0 var(--s-3); }
.cost dt { color: var(--text-3); font-size: 13px; }
.cost dd { margin: 0; font-variant-numeric: tabular-nums; }
.verdict { padding: var(--s-4); display: grid; gap: var(--s-3); }
.verdict__acts { display: flex; justify-content: flex-end; gap: var(--s-2); }
.chip--reject { background: color-mix(in srgb, var(--danger) 12%, var(--surface)); color: var(--danger); }
.detail-ghost { height: 60vh; border-radius: var(--r-md); }
</style>
