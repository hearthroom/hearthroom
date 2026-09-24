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
import { ApiError, claimReview, fetchReviewDetail, fetchReviewOriginality, releaseReview, stampReview, type ReviewDetail, type ReviewOriginality } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { pageTitle } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { readTags, readTalkExample } from "@/lib/role-draft";

const route = useRoute();
const { t } = useI18n();
const { lp } = useLocalePath();
const session = useSession();

const id = computed(() => String(route.params.id || ""));
const data = ref<ReviewDetail | null>(null);
const loading = ref(true);
const error = ref("");
const needsClaim = ref(false);
const done = ref("");
const busy = ref(false);
const note = ref("");
const section = ref<"basic" | "persona" | "originality" | "dialogue" | "worldbook" | "display" | "cost">("basic");
const SECTIONS = ["basic", "persona", "originality", "dialogue", "worldbook", "display", "cost"] as const;
const REVIEW_SECTIONS: readonly string[] = ["originality", "display", "cost"];

// 查重只給審核人參考，不替審核人下結論；分開載入，查重慢或失敗都不擋審核頁。
const originality = ref<ReviewOriginality | null>(null);
const originalityError = ref("");
/** 只看某一張來源的重複段落；null＝全部來源 */
const picked = ref<string | null>(null);
const percent = (x: number) => `${Math.round(x * 100)}%`;
const marked = computed(() => {
  const text = doc.value?.roleDetailDesc ?? "";
  const r = originality.value;
  if (!r?.available) return [{ text, hit: false }];
  const segs = picked.value ? r.sources.find((x) => x.cardId === picked.value)?.segments ?? [] : r.segments;
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of segs) {
    if (a > at) out.push({ text: text.slice(at, a), hit: false });
    out.push({ text: text.slice(a, b), hit: true });
    at = b;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
});
const sectionLabel = (s: (typeof SECTIONS)[number]) => {
  const label = REVIEW_SECTIONS.includes(s) ? t(`review.section.${s}`) : t(`editor.section.${s}`);
  return s === "originality" && originality.value?.available ? `${label} · ${percent(originality.value.similarity)}` : label;
};

async function loadOriginality() {
  originalityError.value = "";
  try {
    originality.value = await fetchReviewOriginality(id.value, await token());
  } catch (err) {
    originalityError.value = err instanceof Error ? err.message : t("state.loadFailed");
  }
}

const doc = computed(() => data.value?.detail.document);
// 對話示例入庫是一串 JSON，作者在編輯頁看到的是一輪一輪的「誰說、說什麼」；審核頁照編輯頁的樣子畫，不倒原始字串。
const talkTurns = computed(() => readTalkExample(doc.value?.talkExample));
const claimedByMe = computed(() => !!data.value?.submission.claimedByMe);
const stampedByMe = computed(() => !!data.value?.submission.stampedByMe);
const tags = computed(() => readTags(doc.value?.roleTag));
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
    needsClaim.value=false;
    data.value = await fetchReviewDetail(id.value, await token());
    void loadOriginality();
    document.title = pageTitle(`${t("review.detail.title")} · ${data.value.detail.document.roleName}`);
  } catch (err) {
    needsClaim.value=err instanceof ApiError && err.status===409 && err.message==="claim this submission first";
    error.value = needsClaim.value ? t("review.claimFirst") : err instanceof ApiError && err.status===410 ? t("review.inactive") : err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function claim() {
  busy.value = true;
  error.value = "";
  try {
    await claimReview(id.value, await token());
    await load();
  } catch (err) {
    error.value = err instanceof ApiError && err.status===409 ? t("review.claimChanged") : err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = false;
  }
}

async function release() {
  busy.value = true;
  try {
    await releaseReview(id.value, await token(),data.value?.submission.claimGeneration);
    if (data.value) data.value.submission.claimedByMe = false;
  } catch (err) {
    error.value = err instanceof ApiError && err.status===409 ? t("review.claimChanged") : err instanceof Error ? err.message : t("state.actionFailed");
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
    const res = await stampReview(id.value, await token(), { verdict, note: note.value, generation:data.value?.submission.claimGeneration });
    done.value = verdict === "reject" ? t("review.done.rejected") : res.cardStatus === "approved" ? t("review.done.approved") : t("review.done.approve");
    if (data.value) {
      data.value.submission.status = res.status;
      data.value.submission.claimedByMe = false;
      data.value.submission.stamps.push({ verdict, note: note.value, at: Date.now() });
    }
  } catch (err) {
    error.value = err instanceof ApiError && err.status===409 ? t("review.claimChanged") : err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = false;
  }
}

onMounted(() => { void load(); });
</script>

<template>
  <section class="review-detail">
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <RouterLink v-if="error && !data" :to="lp('/review')">{{ $t("review.backToQueue") }}</RouterLink>
    <button v-if="needsClaim" class="btn btn--primary" :disabled="busy" @click="claim">{{ $t("review.action.claim") }}</button>
    <p v-if="data?.detail.closed" class="notice" role="status">{{ $t("review.closedPartial") }}</p>
    <p v-else-if="data?.detail.partial" class="notice" role="status">{{ $t("review.partial") }}</p>
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
          <h2 class="head__title display">{{ doc.roleName }}</h2>
          <p class="subtle">{{ doc.roleDesc }}</p>
          <!-- 作者的分級宣告放最上面：審核人第一件事就是對照內容跟它符不符 -->
          <p class="rating" :class="{ 'rating--nsfw': data.submission.nsfw }">
            {{ $t("review.rating.declared") }}
            <strong>{{ data.submission.nsfw ? $t("review.rating.nsfw") : $t("review.rating.sfw") }}</strong>
            · {{ $t("review.rating.hint") }}
          </p>
        </div>
        <div class="head__acts">
          <RouterLink class="btn btn--sm" :to="lp(`/play/${data.card.id}?review=${encodeURIComponent(id)}`)" target="_blank">{{ $t("review.action.play") }}</RouterLink>
          <button v-if="claimedByMe" class="btn btn--sm" :disabled="busy || decided" @click="release">{{ $t("review.action.release") }}</button>
          <button v-else-if="!stampedByMe" class="btn btn--sm btn--primary" :disabled="busy || decided" @click="claim">{{ $t("review.action.claim") }}</button>
        </div>
      </header>

      <div class="seg tabs">
        <button v-for="s in SECTIONS" :key="s" class="seg__item" :class="{ 'seg__item--on': section === s }" :aria-pressed="section === s" @click="section = s">
          {{ sectionLabel(s) }}
        </button>
      </div>

      <section v-show="section === 'basic'" class="pane panel">
        <div class="field"><label>{{ $t("editor.name") }}</label><input class="input" :value="doc.roleName" readonly /></div>
        <div class="field"><label>{{ $t("editor.summary") }}</label><pre class="text">{{ doc.roleDesc }}</pre></div>
        <div class="field">
          <label>{{ $t("review.tags") }}</label>
          <ul class="tags"><li v-for="tag in tags" :key="tag" class="chip">{{ tag }}</li></ul>
        </div>
        <div v-if="doc.roleBackground || doc.roleAvatar" class="field"><label>{{ $t("editor.section.media") }}</label><img class="art" :src="doc.roleBackground || doc.roleAvatar" alt="" /></div>
      </section>

      <section v-show="section === 'persona'" class="pane panel">
        <div class="field"><label>{{ $t("editor.detail") }}</label><pre class="text mono">{{ doc.roleDetailDesc }}</pre></div>
        <div class="field"><label>{{ $t("editor.contract") }}</label><pre class="text mono">{{ doc.roleOutputContract }}</pre></div>
        <div class="field"><label>{{ $t("editor.jailbreak") }}</label><pre class="text mono">{{ doc.customInstructions ?? doc.jailbreak }}</pre></div>
      </section>

      <section v-show="section === 'originality'" class="pane panel">
        <p v-if="originalityError" class="notice notice--error" role="alert">{{ originalityError }}</p>
        <div v-else-if="!originality" class="ghost originality-ghost" aria-hidden="true" />
        <p v-else-if="!originality.available" class="subtle">{{ $t(`review.originality.unavailable.${originality.reason}`) }}</p>
        <template v-else>
          <div class="score">
            <strong class="score__value">{{ percent(originality.similarity) }}</strong>
            <span class="score__label">{{ $t("review.originality.similarity") }}</span>
            <span class="subtle">{{ $t("review.originality.compared", { n: originality.comparedCards }) }}</span>
          </div>
          <p class="subtle small-note">{{ $t("review.originality.hint") }}</p>
          <p v-if="!originality.sources.length" class="notice">{{ $t("review.originality.none") }}</p>
          <div v-else class="field">
            <label>{{ $t("review.originality.sources") }}</label>
            <ul class="sources">
              <li>
                <button type="button" class="source" :class="{ 'source--on': picked === null }" :aria-pressed="picked === null" @click="picked = null">
                  <span class="source__name">{{ $t("review.originality.all") }}</span>
                  <span class="source__pct">{{ percent(originality.similarity) }}</span>
                </button>
              </li>
              <li v-for="src in originality.sources" :key="src.cardId">
                <button type="button" class="source" :class="{ 'source--on': picked === src.cardId }" :aria-pressed="picked === src.cardId" @click="picked = src.cardId">
                  <span class="source__name">{{ src.name || $t("review.originality.untitled") }}</span>
                  <span class="chip">{{ $t(`review.originality.status.${src.status}`) }}</span>
                  <span class="subtle">{{ $t(src.earlier ? "review.originality.earlier" : "review.originality.later") }} · {{ dateTime(src.firstSeenAt) }}</span>
                  <span class="source__pct">{{ percent(src.similarity) }}</span>
                </button>
                <!-- 只連已上榜的卡：審核中的卡還在盲審，公開頁不該成為認出作者的途徑 -->
                <RouterLink v-if="src.status === 'approved'" class="source__open" :to="lp(`/cards/${src.cardId}`)" target="_blank">{{ $t("review.action.open") }}</RouterLink>
              </li>
            </ul>
          </div>
          <div class="field">
            <label>{{ $t("editor.detail") }}</label>
            <p v-if="originality.segments.length" class="subtle small-note">{{ $t("review.originality.marked") }}</p>
            <pre class="text mono marked"><template v-for="(piece, i) in marked" :key="i"><mark v-if="piece.hit" class="hit">{{ piece.text }}</mark><template v-else>{{ piece.text }}</template></template></pre>
          </div>
        </template>
      </section>

      <section v-show="section === 'dialogue'" class="pane panel">
        <div class="field"><label>{{ $t("editor.welcome") }}</label><pre class="text mono">{{ data.detail.greetings.welcome }}</pre></div>
        <div v-if="data.detail.greetings.alternates.length" class="field">
          <label>{{ $t("editor.alternates") }}</label>
          <pre v-for="(a, i) in data.detail.greetings.alternates" :key="i" class="text mono">{{ a }}</pre>
        </div>
        <div v-if="data.detail.greetings.prologue.length" class="field">
          <label>{{ $t("editor.prologue") }}</label>
          <ul class="tags"><li v-for="(p, i) in data.detail.greetings.prologue" :key="i" class="chip">{{ p }}</li></ul>
        </div>
        <div class="field">
          <label>{{ $t("editor.talkExample") }}</label>
          <ol v-if="talkTurns.length" class="turns">
            <li v-for="(turn, i) in talkTurns" :key="i" class="turn" :class="`turn--${turn.roleType}`">
              <span class="turn__who">{{ $t(turn.roleType === "user" ? "editor.talkExample.user" : "editor.talkExample.ai") }}</span>
              <pre class="text">{{ turn.content }}</pre>
            </li>
          </ol>
          <!-- 解不開的才原樣給看：那代表資料本身有問題，審核人該看到 -->
          <pre v-else-if="doc.talkExample" class="text mono">{{ doc.talkExample }}</pre>
          <p v-else class="subtle">—</p>
        </div>
      </section>

      <section v-show="section === 'worldbook'" class="pane panel">
        <p v-if="!data.detail.worldbook" class="subtle">{{ $t("review.wb.none") }}</p>
        <template v-else>
          <!-- 整本預設收起：三百條世界書沒人看得完，審核人抽查幾條就夠；展開後每條也先只露標題與關鍵詞 -->
          <details class="book">
            <summary class="book__sum">
              <strong>{{ data.detail.worldbook.name }}</strong>
              <span class="subtle">{{ $t("review.wb.book", { n: data.detail.worldbook.entries.length }) }}</span>
            </summary>
            <details v-for="e in data.detail.worldbook.entries" :key="e.entryId" class="entry" :class="{ 'entry--off': !e.isEnabled }">
              <summary class="entry__head">
                <strong>{{ e.name || $t("wb.entry.untitled") }}</strong>
                <span v-if="e.isConstant" class="chip">{{ $t("review.entry.constant") }}</span>
                <span v-if="!e.isEnabled" class="chip">{{ $t("review.entry.disabled") }}</span>
                <span v-if="e.keywords.length" class="subtle">{{ e.keywords.join("、") }}</span>
                <span v-if="e.secondaryKeywords.length" class="subtle">+ {{ e.secondaryKeywords.join("、") }}</span>
              </summary>
              <pre class="entry__body">{{ e.content }}</pre>
            </details>
          </details>
        </template>
      </section>

      <section v-show="section === 'display'" class="pane panel">
        <p v-if="!data.detail.authorAsset.rules.length" class="subtle">{{ $t("review.rules.none") }}</p>
        <template v-else>
          <!-- 只列數量與名字：規則內容是給機器讀的，又長又佔位；審核人要驗效果直接去試玩 -->
          <p class="subtle">{{ $t("review.rules.count", { n: data.detail.authorAsset.rules.length }) }}</p>
          <ul class="tags">
            <li v-for="r in data.detail.authorAsset.rules" :key="r.id" class="chip" :class="{ 'chip--off': !r.enabled }">{{ r.name || r.id }}</li>
          </ul>
        </template>
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
          <!-- 常見的駁回理由一鍵填入；審核人不改作者的宣告，只駁回 -->
          <button type="button" class="btn btn--sm btn--ghost" :disabled="decided" @click="note = $t('review.rating.mismatch')">{{ $t("review.rating.mismatchFill") }}</button>
        </div>
        <p v-if="stampedByMe" class="subtle">{{ $t("review.stampedByMe") }}</p>
        <p v-else-if="!claimedByMe && !decided" class="subtle">{{ $t("review.claimFirst") }}</p>
        <div class="verdict__acts">
          <button class="btn btn--danger" :disabled="busy || decided || !claimedByMe || !note.trim()" @click="stamp('reject')">{{ $t("review.action.reject") }}</button>
          <button class="btn btn--primary" :disabled="busy || decided || !claimedByMe" @click="stamp('approve')">{{ $t("review.action.approve") }}</button>
        </div>
      </section>
    </template>
  </section>
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
.text { margin: 0; padding: var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.text + .text { margin-top: var(--s-2); }
.turns { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.turn { display: grid; gap: 4px; }
.turn__who { font-size: 12px; font-weight: 600; color: var(--text-3); }
.turn--ai .turn__who { color: var(--accent-text); }
.book__sum { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; cursor: pointer; padding: var(--s-2) 0; }
.book[open] > .book__sum { margin-bottom: var(--s-2); border-bottom: 1px solid var(--line); }
.entry { padding: var(--s-3) 0; border-top: 1px solid var(--line); }
.entry:first-of-type { border-top: 0; }
.entry > summary { cursor: pointer; }
.chip--off { opacity: 0.55; text-decoration: line-through; }
.entry--off { opacity: 0.6; }
.entry__head { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; margin-bottom: var(--s-2); }
.entry__body { margin: 0; padding: var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
.cost { display: grid; grid-template-columns: auto 1fr; gap: var(--s-2) var(--s-4); margin: 0 0 var(--s-3); }
.cost dt { color: var(--text-3); font-size: 13px; }
.cost dd { margin: 0; font-variant-numeric: tabular-nums; }
.verdict { padding: var(--s-4); display: grid; gap: var(--s-3); }
.verdict__acts { display: flex; justify-content: flex-end; gap: var(--s-2); }
.chip--reject { background: color-mix(in srgb, var(--danger) 12%, var(--surface)); color: var(--danger); }
.rating { margin: 6px 0 0; font-size: 13px; color: var(--text-2); }
.rating--nsfw strong { color: var(--danger); }
.detail-ghost { height: 60vh; border-radius: var(--r-md); }
.originality-ghost { height: 120px; border-radius: var(--r-md); }
.score { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-2) var(--s-3); margin-bottom: var(--s-2); }
.score__value { font-size: 32px; font-variant-numeric: tabular-nums; }
.score__label { font-weight: 600; }
.small-note { font-size: 13px; margin: 0 0 var(--s-3); }
.sources { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.sources li { display: flex; align-items: center; gap: var(--s-2); }
.source { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); padding: var(--s-2) var(--s-3); border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.source--on { border-color: var(--accent); background: var(--surface-2); }
.source__name { font-weight: 600; overflow-wrap: anywhere; }
.source__pct { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; }
.source__open { flex: none; font-size: 13px; }
.marked { display: block; }
.hit { display: inline; background: color-mix(in srgb, var(--accent) 30%, transparent); color: inherit; border-radius: 2px; }
</style>
