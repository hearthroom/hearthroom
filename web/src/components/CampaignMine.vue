<script setup lang="ts">
/**
 * 活動中心「我參加的」（/campaigns?tab=mine）：自己送出的分享，依活動分組。每份內容一張卡：分享連結、「已核准」與「已入帳」兩欄
 * （spec §3.2 要分開，免得把核准的金額當成已經拿到）、每個位置的審核狀態，理由只在需要補件或未通過時顯示。
 * 需要補件的位置可以補充資料：平台不能改，送出時只帶改過的欄位與新截圖；同樣的內容失敗後重按沿用同一個 operationId。
 * 補件截止（活動公開資料的 submitDeadline）後不給重送；伺服器回 campaign_submit_closed 也一樣收起。
 * 活動讀不到（例如改回草稿）就只顯示代號，不顯示截止，補件交給伺服器把關。
 * 這裡不顯示點數池、餘額、審核人與發放錯誤碼。沒登入的人看到一句說明和登入按鈕，登入後回到這個頁籤。
 */
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute } from "vue-router";
import CampaignShareLinks from "@/components/CampaignShareLinks.vue";
import DateTimeField from "@/components/DateTimeField.vue";
import EvidencePicker from "@/components/EvidencePicker.vue";
import EvidenceViewer from "@/components/EvidenceViewer.vue";
import {
  CampaignError, DEFAULT_TIMEZONE, TIERS, campaignErrorText, epochToZoned, fetchCampaign, fetchMyContents, fetchPublicCampaigns, fieldLabel, formatPoints,
  isWebUrl, localized, resubmitPlacement, zonedToEpoch, zoneName,
  type CampaignSummary, type ContentView, type PlacementView, type PublicCampaign, type ResubmitBody, type Tier,
} from "@/lib/campaign";
import { ApiError } from "@/lib/api";
import { loginPath } from "@/lib/login-return";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";

const { t } = useI18n();
const { lp, locale } = useLocalePath();
const session = useSession();
const route = useRoute();

async function token() {
  const tk = await session.accessToken();
  if (!tk) throw new Error(t("auth.expired"));
  return tk;
}

const contents = ref<ContentView[] | null>(null);
const loadError = ref("");
/** 活動公開資料；null 是 404（不存在或改回草稿）。其他失敗不記，下次重新讀。 */
const campaigns = ref<Record<string, PublicCampaign | null>>({});
const openCampaign = ref<CampaignSummary | null>(null);
const now = ref(Date.now());

let seq = 0;
async function load() {
  const mine = ++seq;
  loadError.value = "";
  try {
    const { items } = await fetchMyContents(await token());
    const missing = [...new Set(items.map((c) => c.campaignSlug))].filter((s) => !(s in campaigns.value));
    // 活動資料先到再畫，補件按鈕才不會在截止後先閃一下
    const read = await Promise.all(missing.map((s) => fetchCampaign(s).catch((e) => (e instanceof ApiError && e.status === 404 ? null : undefined))));
    if (!items.length && !openCampaign.value) openCampaign.value = (await fetchPublicCampaigns().catch(() => ({ items: [] }))).items.find((c) => c.phase === "open") ?? null;
    if (mine !== seq) return;
    missing.forEach((s, i) => { if (read[i] !== undefined) campaigns.value[s] = read[i]!; });
    now.value = Date.now();
    contents.value = items;
  } catch {
    if (mine === seq) loadError.value = t("campaign.mine.error");
  }
}
watch(() => session.me?.accountNumId ?? null, (id) => { if (id) void load(); }, { immediate: true });

const groups = computed(() => {
  const by = new Map<string, ContentView[]>();
  for (const c of (session.me ? contents.value : null) ?? []) by.set(c.campaignSlug, [...(by.get(c.campaignSlug) ?? []), c]);
  return [...by].map(([slug, items]) => {
    const campaign = campaigns.value[slug] ?? null;
    return { slug, campaign, items, title: campaign ? localized(campaign.title, locale.value) || slug : slug };
  });
});
/** 活動讀不到就不知道它的時區：回 null，不猜。 */
const tzOf = (slug: string) => (campaigns.value[slug] ? campaigns.value[slug]!.timezone || DEFAULT_TIMEZONE : null);
/** 時區不明時用看的人自己的時區顯示，時刻本身還是對的。 */
const at = (ms: number, slug: string) => new Intl.DateTimeFormat(locale.value, { timeZone: tzOf(slug) ?? undefined, dateStyle: "medium", timeStyle: "short" }).format(ms);
const points = formatPoints;
const hasReason = (p: PlacementView) => !!p.reviewReason && (p.reviewStatus === "needs_info" || p.reviewStatus === "rejected");

/** 伺服器說補件截止了的活動 */
const closed = ref<string[]>([]);
function isClosed(slug: string) {
  const deadline = campaigns.value[slug]?.submitDeadline ?? null;
  return closed.value.includes(slug) || (deadline !== null && now.value >= deadline);
}

// ---- 補充資料：一次只開一張 ---------------------------------------------------------
const editing = ref<{ placement: PlacementView; slug: string } | null>(null);
const form = reactive({ location: "", publishedAt: "", url: "", tier: "" as Tier | "", note: "" });
const newIds = ref<string[]>([]);
const uploading = ref(false);
const sending = ref(false);
const formError = ref("");
const pickerKey = ref(0);
const resent = ref("");

function open(p: PlacementView, slug: string) {
  editing.value = { placement: p, slug };
  const tz = tzOf(slug);
  Object.assign(form, { location: p.location, publishedAt: tz ? epochToZoned(p.publishedAt, tz) : "", url: p.url ?? "", tier: p.requestedTier, note: "" });
  newIds.value = [];
  formError.value = "";
  resent.value = "";
  pickerKey.value++;
}
function collapse() { editing.value = null; }

/** 還有位置在審：已核准欄才說「審核中」，全部未通過就是 —。 */
const reviewing = (c: ContentView) => c.placements.some((p) => p.reviewStatus === "submitted" || p.reviewStatus === "resubmitted" || p.reviewStatus === "needs_info");

/** 活動讀得到就只列有金額的檔位（目前申請的一定在）；讀不到就全列。 */
function tierOptions(slug: string, current: Tier) {
  const c = campaigns.value[slug];
  return c ? TIERS.filter((k) => k === current || typeof c.tiers[k] === "number") : [...TIERS];
}

/** 只帶改過的欄位；連結清空送 null；時區不明時發布時間不能改、也不送。驗不過回 null 並說哪裡不對。 */
function build(p: PlacementView, tz: string | null): Omit<ResubmitBody, "operationId"> | null {
  const need = (f: string) => t("campaign.error.share_invalidField", { field: fieldLabel(f, "share") });
  const location = form.location.trim(), url = form.url.trim(), note = form.note.trim();
  const publishedAt = tz ? zonedToEpoch(form.publishedAt, tz) : p.publishedAt;
  formError.value =
    !location ? need("location")
    : publishedAt === null ? need("publishedAt")
    : url && !isWebUrl(url) ? t("campaign.apply.badUrl")
    : !url && !p.evidence.length && !newIds.value.length ? t("campaign.apply.needProof")
    : "";
  if (formError.value) return null;
  const body: Omit<ResubmitBody, "operationId"> = {};
  if (location !== p.location) body.location = location;
  if (tz && form.publishedAt !== epochToZoned(p.publishedAt, tz)) body.publishedAt = publishedAt!;
  if (url !== (p.url ?? "")) body.url = url || null;
  if (form.tier && form.tier !== p.requestedTier) body.requestedTier = form.tier;
  if (note) body.note = note;
  if (newIds.value.length) body.evidenceIds = newIds.value;
  return body;
}

const ops = new Map<string, string>();
async function send() {
  const target = editing.value;
  if (!target || sending.value || uploading.value) return;
  const body = build(target.placement, tzOf(target.slug));
  if (!body) return;
  const key = target.placement.id + JSON.stringify(body);
  const operationId = ops.get(key) ?? crypto.randomUUID();
  ops.set(key, operationId);
  sending.value = true;
  try {
    await resubmitPlacement(await token(), target.placement.id, { ...body, operationId });
    ops.clear();
    editing.value = null;
    resent.value = target.placement.id;
    await load();
  } catch (e) {
    if (e instanceof CampaignError && e.code === "campaign_submit_closed") {
      closed.value = [...closed.value, target.slug];
      editing.value = null;
    } else formError.value = campaignErrorText(e);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="mine-share">
    <!-- 登入狀態還在確認時先不說「請登入」，免得已登入的人看到一閃 -->
    <div v-if="!session.me" class="mine-share__signin" data-signin-prompt>
      <template v-if="session.ready">
        <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.25" y="8.75" width="11.5" height="8" rx="2" /><path d="M7 8.75V6.5a3 3 0 0 1 6 0v2.25" /></svg>
        <span>{{ t("campaign.hub.signIn") }}</span>
        <RouterLink class="btn btn--primary" data-signin :to="lp(loginPath(route.fullPath))">{{ t("nav.login") }}</RouterLink>
      </template>
    </div>

    <p v-else-if="loadError" class="notice notice--error" role="alert">
      {{ loadError }}
      <button type="button" class="btn btn--sm" @click="load()">{{ t("campaign.page.retry") }}</button>
    </p>

    <div v-else-if="!contents" class="mine-share__skeleton" aria-hidden="true">
      <div v-for="i in 3" :key="i" class="ghost mine-share__skeleton-card" />
    </div>

    <section v-else-if="!contents.length" class="panel mine-share__empty">
      <p>{{ t("campaign.mine.empty") }}</p>
      <RouterLink v-if="openCampaign" class="btn btn--primary" data-join :to="lp(`/campaign/${openCampaign.slug}`)">
        {{ t("campaign.mine.join", { title: localized(openCampaign.title, locale) || openCampaign.slug }) }}
      </RouterLink>
    </section>

    <section v-for="g in groups" :key="g.slug" class="mine-share__group" :data-campaign-group="g.slug" :aria-labelledby="`mine-g-${g.slug}`">
      <header class="mine-share__group-head">
        <h2 :id="`mine-g-${g.slug}`" class="mine-share__h2">
          <RouterLink v-if="g.campaign" :to="lp(`/campaign/${g.slug}`)">{{ g.title }}</RouterLink>
          <template v-else>{{ g.slug }}</template>
        </h2>
        <dl v-if="g.campaign && g.campaign.submitDeadline !== null" class="mine-share__deadline">
          <dt>{{ t("campaign.field.submitDeadline") }}</dt><dd>{{ at(g.campaign.submitDeadline, g.slug) }}</dd>
        </dl>
      </header>

      <article v-for="c in g.items" :key="c.id" class="panel mine-share__content" :data-share-content="c.id">
        <CampaignShareLinks :items="[c]" />

        <div class="mine-share__cols">
          <div class="mine-share__col" data-col="approved">
            <span class="mine-share__label">{{ t("campaign.mine.approved") }}</span>
            <template v-if="c.approvedTier">
              <strong class="num">{{ points(c.approvedAmount) }}</strong>
              <span class="mine-share__sub">{{ t(`campaign.tier.${c.approvedTier}`) }}</span>
            </template>
            <strong v-else-if="reviewing(c)">{{ t("campaign.mine.pending") }}</strong>
            <strong v-else>{{ t("campaign.payout.none") }}</strong>
          </div>
          <div class="mine-share__col" data-col="paid">
            <span class="mine-share__label">{{ t("campaign.mine.paid") }}</span>
            <strong class="num">{{ points(c.paidTotal) }}</strong>
            <span class="mine-share__sub" data-payout>{{ t(`campaign.payout.${c.payoutState}`) }}</span>
          </div>
        </div>

        <ul class="mine-share__places">
          <li v-for="p in c.placements" :key="p.id" class="mine-share__place" :data-placement="p.id">
            <div class="mine-share__place-head">
              <span class="mine-share__where"><strong>{{ t(`campaign.platform.${p.platform}`) }}</strong><span>{{ p.location }}</span></span>
              <span class="mine-share__status" :class="`mine-share__status--${p.reviewStatus}`" data-status>{{ t(`campaign.review.${p.reviewStatus}`) }}</span>
            </div>
            <span class="subtle">{{ at(p.publishedAt, g.slug) }}</span>
            <p v-if="hasReason(p)" class="mine-share__reason" data-reason>
              <span class="mine-share__label">{{ t("campaign.share.field.reason") }}</span>
              <span>{{ p.reviewReason }}</span>
            </p>
            <p v-if="resent === p.id" class="notice" role="status">{{ t("campaign.mine.resent") }}</p>
            <EvidenceViewer v-if="p.evidence.length && editing?.placement.id !== p.id" :items="p.evidence" />

            <template v-if="p.reviewStatus === 'needs_info'">
              <p v-if="isClosed(g.slug)" class="mine-share__closed" data-closed>{{ t("campaign.mine.closed") }}</p>
              <button v-else-if="editing?.placement.id !== p.id" type="button" class="btn btn--sm mine-share__open" data-action="resubmit" @click="open(p, g.slug)">{{ t("campaign.mine.resubmit") }}</button>
              <form v-else class="mine-share__form" data-resubmit novalidate @submit.prevent="send">
                <div class="field" data-field="platform">
                  <span class="mine-share__label">{{ t("campaign.share.field.platform") }}</span>
                  <span>{{ t(`campaign.platform.${p.platform}`) }}</span>
                </div>
                <div class="field" data-field="location">
                  <label :for="`rs-loc-${p.id}`">{{ t("campaign.share.field.location") }}</label>
                  <input :id="`rs-loc-${p.id}`" v-model="form.location" class="input" maxlength="200" required />
                </div>
                <div class="field" data-field="publishedAt">
                  <label :for="`rs-time-${p.id}`">{{ t("campaign.share.field.publishedAt") }}</label>
                  <div class="mine-share__time">
                    <DateTimeField :id="`rs-time-${p.id}`" v-model="form.publishedAt" :disabled="!tzOf(g.slug)" :describedby="`rs-zone-${p.id}`" :date-label="t('campaign.apply.date')" :time-label="t('campaign.apply.time')" />
                    <span v-if="tzOf(g.slug)" :id="`rs-zone-${p.id}`" class="subtle">{{ zoneName(tzOf(g.slug)!, locale) }}</span>
                  </div>
                </div>
                <fieldset class="field mine-share__group-field" data-field="requestedTier">
                  <legend class="mine-share__label">{{ t("campaign.share.field.requestedTier") }}</legend>
                  <div class="mine-share__tiers">
                    <label v-for="k in tierOptions(g.slug, p.requestedTier)" :key="k" class="mine-share__tier">
                      <input v-model="form.tier" type="radio" :name="`rs-tier-${p.id}`" :value="k" />
                      <span>{{ t(`campaign.tier.${k}`) }}</span>
                    </label>
                  </div>
                </fieldset>
                <div class="field" data-field="url">
                  <label :for="`rs-url-${p.id}`">{{ t("campaign.share.field.url") }}</label>
                  <input :id="`rs-url-${p.id}`" v-model="form.url" class="input" type="url" inputmode="url" maxlength="2000" placeholder="https://" />
                </div>
                <fieldset class="field mine-share__group-field" data-field="evidence">
                  <legend class="mine-share__label">{{ t("campaign.apply.screenshots") }}</legend>
                  <EvidenceViewer v-if="p.evidence.length" :items="p.evidence" />
                  <EvidencePicker :key="pickerKey" v-model:ids="newIds" :existing="p.evidence" @update:busy="uploading = $event" />
                </fieldset>
                <div class="field" data-field="note">
                  <label :for="`rs-note-${p.id}`">{{ t("campaign.share.field.note") }} <span class="subtle">{{ t("campaign.apply.optional") }}</span></label>
                  <textarea :id="`rs-note-${p.id}`" v-model="form.note" class="input" rows="3" maxlength="1000" />
                </div>
                <p v-if="formError" class="notice notice--error" role="alert" data-form-error>{{ formError }}</p>
                <div class="mine-share__actions">
                  <button type="submit" class="btn btn--primary" :disabled="sending || uploading" :aria-busy="sending || undefined">{{ t("campaign.mine.send") }}</button>
                  <button type="button" class="btn" @click="collapse">{{ t("campaign.mine.collapse") }}</button>
                </div>
              </form>
            </template>
          </li>
        </ul>
      </article>
    </section>
  </div>
</template>

<style scoped>
.mine-share { display: grid; gap: var(--s-5); }
.mine-share__signin {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); padding: var(--s-4);
  border-radius: var(--r-lg); background: var(--surface-2); font-size: 14px; line-height: 1.6;
}
.mine-share__signin:empty { display: none; }
.mine-share__signin svg { flex: none; width: 20px; height: 20px; fill: none; stroke: var(--accent-text); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.mine-share__signin > span { flex: 1 1 200px; min-width: 0; font-weight: 500; }
.mine-share__skeleton { display: grid; gap: var(--s-4); }
.mine-share__skeleton-card { height: 160px; border-radius: var(--r-lg); }
.mine-share__empty { display: grid; gap: var(--s-3); justify-items: start; padding: var(--s-5); }
.mine-share__empty p { margin: 0; }

.mine-share__group { display: grid; gap: var(--s-3); }
.mine-share__group-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--s-1) var(--s-4); }
.mine-share__h2 { margin: 0; font-size: 18px; overflow-wrap: anywhere; }
.mine-share__h2 a { color: inherit; }
.mine-share__h2 a:hover { color: var(--accent-text); }
.mine-share__deadline { display: flex; gap: var(--s-2); margin: 0; font-size: 13px; }
.mine-share__deadline dt { color: var(--text-3); }
.mine-share__deadline dd { margin: 0; }

/* .panel 本身沒有內距：每張卡自己補，桌機 24、手機 16 */
.mine-share__content { display: grid; gap: var(--s-4); padding: var(--s-5); min-width: 0; }
.mine-share__cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-3); }
.mine-share__col { display: grid; gap: var(--s-1); align-content: start; padding: var(--s-3) var(--s-4); border-radius: var(--r-md); background: var(--surface-2); }
.mine-share__col strong { font-size: 18px; }
.mine-share__label { font-size: 13px; font-weight: 600; color: var(--text-2); padding: 0; }
.mine-share__sub { font-size: 13px; color: var(--text-2); }

.mine-share__places { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
.mine-share__place { display: grid; gap: var(--s-2); padding-top: var(--s-3); border-top: 1px solid var(--line); }
.mine-share__place-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); }
.mine-share__where { display: inline-flex; flex-wrap: wrap; gap: 0 var(--s-2); font-size: 14px; overflow-wrap: anywhere; min-width: 0; }
.mine-share__status { padding: 1px 8px; border-radius: var(--r-pill); font-size: 12px; font-weight: 600; background: var(--surface-2); color: var(--text-2); }
.mine-share__status--approved { background: var(--success-soft); color: var(--success); }
.mine-share__status--needs_info { background: var(--accent-tint); color: var(--accent-text); }
.mine-share__status--rejected { background: color-mix(in srgb, var(--danger) 10%, var(--surface)); color: var(--danger); }
.mine-share__reason { display: grid; gap: var(--s-1); margin: 0; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
.mine-share__closed { margin: 0; font-size: 14px; color: var(--text-2); }
.mine-share__open { justify-self: start; }

.mine-share__form { display: grid; padding: var(--s-4); border-radius: var(--r-md); background: var(--surface-2); }
.mine-share__group-field { border: 0; margin: 0 0 var(--s-5); padding: 0; min-width: 0; }
.mine-share__time { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); }
.mine-share__short { max-width: 280px; }
.mine-share__tiers { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.mine-share__tier {
  display: inline-flex; align-items: center; gap: var(--s-2); min-height: var(--h-md); padding: 0 var(--s-3);
  border-radius: var(--r-pill); background: var(--surface); font-size: 14px; cursor: pointer;
}
.mine-share__tier:has(input:checked) { background: var(--accent-tint); color: var(--accent-text); }
.mine-share__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }

@media (max-width: 760px) {
  .mine-share__cols { grid-template-columns: 1fr; }
  .mine-share__content, .mine-share__empty { padding: var(--s-4); }
  .mine-share__short { max-width: none; }
  .mine-share__tier, .mine-share__open, .mine-share__actions .btn, .mine-share__signin .btn { min-height: 44px; }
}
</style>
