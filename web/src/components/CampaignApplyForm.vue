<script setup lang="ts">
/**
 * 活動頁的分享申請表：新的分享（標題、選填的卡片）或替自己既有的內容再加一個位置。
 * 發布時間以活動的時區解讀（zonedToEpoch）；證明是「貼連結」或「傳截圖」二選一，只送選中的那一種。
 * 平台是單選膠囊：依介面語言先列這一區常用的，加「其他」，其餘收在「更多平台…」裡（選「其他」時發布位置要寫平台名）。伺服器回 share_invalid 帶 field 時標在那一格，
 * 其他錯誤放在表單底下。同樣的內容失敗後重按沿用同一個 operationId。
 * 成功時 emit done，由父層用 :key 換掉整張表（截圖選擇器一起重置）。
 */
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import DateTimeField from "@/components/DateTimeField.vue";
import EvidencePicker from "@/components/EvidencePicker.vue";
import {
  CampaignError, DEFAULT_TIMEZONE, EVIDENCE_MAX, TIERS, campaignErrorText, epochToZoned, fieldLabel, formatPoints, isWebUrl, platformsFor, submitPlacement, zonedToEpoch, zoneName,
  type ApplyResult, type ContentView, type Platform, type PublicCampaign, type SubmitBody, type Tier,
} from "@/lib/campaign";
import { useSession } from "@/lib/session";

const props = defineProps<{ campaign: PublicCampaign; contents: ContentView[] }>();
const emit = defineEmits<{ done: [result: ApplyResult] }>();
const { t, locale } = useI18n();
/** 依介面語言先列這一區常用的平台，其他平台收在群組裡 */
const platforms = computed(() => platformsFor(locale.value));
const session = useSession();

const tz = computed(() => props.campaign.timezone || DEFAULT_TIMEZONE);
const tiers = computed(() => TIERS.filter((k) => typeof props.campaign.tiers[k] === "number"));

const kind = ref<"new" | "existing">("new");
const form = reactive({
  title: "", cardId: "", contentId: "", tier: "" as Tier | "", platform: "" as Platform | "", location: "",
  publishedAt: epochToZoned(Date.now(), tz.value), url: "", note: "",
});
const evidenceIds = ref<string[]>([]);
/** 證明方式：私密群組拿不到連結，就傳截圖 */
const proof = ref<"link" | "shot">("link");
/** 「更多平台…」展開了沒；選中的平台在裡面時一定展開 */
const showMore = ref(false);
const visiblePlatforms = computed<Platform[]>(() => [...platforms.value.primary, ...(showMore.value || platforms.value.more.includes(form.platform as Platform) ? platforms.value.more : ["other" as Platform])]);
const optionalOpen = ref(false);
const uploading = ref(false);
const busy = ref(false);
watch(() => props.contents, (list) => {
  if (!list.some((c) => c.id === form.contentId)) form.contentId = list[0]?.id ?? "";
  if (!list.length) kind.value = "new";
}, { immediate: true });

const errors = reactive<Record<string, string>>({});
const formError = ref("");
const root = ref<HTMLFormElement | null>(null);
const bad = (f: string) => (errors[f] ? true : undefined);
const need = (f: string) => t("campaign.error.share_invalidField", { field: fieldLabel(f, "share") });

/** 伺服器的欄位對到畫面上的格子；content 在新內容時是標題，在既有內容時是那個選單。 */
function slotOf(field: string): string {
  if (field === "content") return kind.value === "existing" ? "content" : "title";
  if (field === "evidenceIds") return "evidence";
  return ["title", "cardId", "platform", "location", "publishedAt", "url", "note", "requestedTier", "evidence"].includes(field) ? field : "";
}

function build(): Omit<SubmitBody, "operationId"> | null {
  for (const k of Object.keys(errors)) delete errors[k];
  formError.value = "";
  const existing = kind.value === "existing";
  const title = form.title.trim(), cardId = form.cardId.trim(), location = form.location.trim(), url = form.url.trim(), note = form.note.trim();
  if (existing && !form.contentId) errors.content = need("content");
  if (!existing && !title) errors.title = need("title");
  if (!existing && cardId && !/^\d+$/.test(cardId)) errors.cardId = need("cardId");
  if (!form.tier) errors.requestedTier = need("requestedTier");
  if (!form.platform) errors.platform = need("platform");
  if (!location) errors.location = need("location");
  const publishedAt = zonedToEpoch(form.publishedAt, tz.value);
  if (publishedAt === null) errors.publishedAt = need("publishedAt");
  if (proof.value === "link" && !url) errors.url = t("campaign.apply.needProof");
  else if (proof.value === "link" && !isWebUrl(url)) errors.url = t("campaign.apply.badUrl");
  if (proof.value === "shot" && !evidenceIds.value.length) errors.evidence = t("campaign.apply.needProof");
  if (errors.cardId || errors.note) optionalOpen.value = true;
  if (Object.keys(errors).length) return null;
  const base = {
    platform: form.platform as Platform, location, publishedAt: publishedAt!, requestedTier: form.tier as Tier,
    ...(proof.value === "link" ? { url } : { evidenceIds: evidenceIds.value }), ...(note ? { note } : {}),
  };
  return existing ? { ...base, contentId: form.contentId } : { ...base, content: { title, ...(cardId ? { cardId: Number(cardId) } : {}) } };
}

/** 平台膠囊是一組單選：方向鍵移到前一個／下一個並選中（WAI-ARIA radio group） */
const platformEls = ref<HTMLElement[]>([]);
function pickPlatform(p: Platform) { form.platform = p; }
function onPlatformKey(e: KeyboardEvent, i: number) {
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const list = visiblePlatforms.value;
  const next = (i + step + list.length) % list.length;
  form.platform = list[next]!;
  void nextTick(() => platformEls.value[next]?.focus());
}
/** 沒選的時候第一顆可以 Tab 進來，選了之後是選中的那顆 */
const tabStop = (p: Platform, i: number) => (form.platform ? (form.platform === p ? 0 : -1) : i === 0 ? 0 : -1);

/** 同樣的內容重按沿用同一個 operationId，內容改了就是新的動作。 */
const ops = new Map<string, string>();
async function submit() {
  if (busy.value || uploading.value) return;
  const body = build();
  if (!body) {
    await nextTick();
    root.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    return;
  }
  const key = JSON.stringify(body);
  const operationId = ops.get(key) ?? crypto.randomUUID();
  ops.set(key, operationId);
  busy.value = true;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const result = await submitPlacement(token, props.campaign.slug, { ...body, operationId } as SubmitBody);
    ops.clear();
    emit("done", result);
  } catch (e) {
    const slot = e instanceof CampaignError && e.code === "share_invalid" ? slotOf(e.field) : "";
    if (slot) errors[slot] = campaignErrorText(e);
    else formError.value = campaignErrorText(e);
    if (slot === "cardId" || slot === "note") optionalOpen.value = true;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form ref="root" class="apply" data-apply novalidate @submit.prevent="submit">
    <fieldset v-if="contents.length" class="apply__group">
      <legend class="apply__label">{{ t("campaign.apply.kind") }}</legend>
      <div class="apply__choices">
        <label class="apply__choice"><input v-model="kind" type="radio" name="kind" value="new" />{{ t("campaign.apply.newContent") }}</label>
        <label class="apply__choice"><input v-model="kind" type="radio" name="kind" value="existing" />{{ t("campaign.apply.existing") }}</label>
      </div>
    </fieldset>

    <template v-if="kind === 'new'">
      <div class="field" data-field="title">
        <label for="apply-title">{{ t("campaign.share.field.title") }}</label>
        <input id="apply-title" v-model="form.title" class="input" maxlength="120" required :placeholder="t('campaign.apply.titlePlaceholder')" :aria-invalid="bad('title')" aria-describedby="apply-title-err" />
        <p v-if="errors.title" id="apply-title-err" class="apply__error" role="alert">{{ errors.title }}</p>
      </div>
    </template>
    <div v-else class="field" data-field="content">
      <label for="apply-content">{{ t("campaign.share.field.content") }}</label>
      <select id="apply-content" v-model="form.contentId" class="input" :aria-invalid="bad('content')" aria-describedby="apply-content-err">
        <option v-for="c in contents" :key="c.id" :value="c.id">{{ c.title }}</option>
      </select>
      <p v-if="errors.content" id="apply-content-err" class="apply__error" role="alert">{{ errors.content }}</p>
    </div>

    <fieldset class="apply__group field" data-field="requestedTier">
      <legend class="apply__label">{{ t("campaign.share.field.requestedTier") }}</legend>
      <div class="apply__tiers">
        <label v-for="k in tiers" :key="k" class="apply__tier">
          <input v-model="form.tier" type="radio" name="tier" :value="k" required :aria-invalid="bad('requestedTier')" />
          <span>{{ t(`campaign.tier.${k}`) }}</span>
          <span class="apply__amount num">{{ formatPoints(campaign.tiers[k]!) }}</span>
        </label>
      </div>
      <p v-if="errors.requestedTier" class="apply__error" role="alert">{{ errors.requestedTier }}</p>
    </fieldset>

    <div class="field" data-field="platform">
      <span id="apply-platform-label" class="apply__label">{{ t("campaign.share.field.platform") }}</span>
      <div class="apply__platforms" role="radiogroup" aria-labelledby="apply-platform-label" :aria-invalid="bad('platform')" aria-describedby="apply-platform-err">
        <button
          v-for="(p, i) in visiblePlatforms" :key="p" ref="platformEls" type="button" role="radio" class="apply__platform"
          :aria-checked="form.platform === p" :tabindex="tabStop(p, i)" :data-platform="p"
          @click="pickPlatform(p)" @keydown="onPlatformKey($event, i)"
        >{{ t(`campaign.platform.${p}`) }}</button>
        <button v-if="visiblePlatforms.length < platforms.primary.length + platforms.more.length" type="button" class="apply__platform apply__platform--more" data-action="more-platforms" @click="showMore = true">{{ t("campaign.apply.morePlatforms") }}</button>
      </div>
      <p v-if="errors.platform" id="apply-platform-err" class="apply__error" role="alert">{{ errors.platform }}</p>
    </div>

    <div class="field" data-field="location">
      <label for="apply-location">{{ form.platform === "other" ? t("campaign.apply.otherPlatform") : t("campaign.share.field.location") }}</label>
      <input id="apply-location" v-model="form.location" class="input" maxlength="200" required :aria-invalid="bad('location')" aria-describedby="apply-location-hint apply-location-err" />
      <p id="apply-location-hint" class="apply__hint">{{ form.platform === "other" ? t("campaign.apply.otherPlatformHint") : t("campaign.apply.locationHint") }}</p>
      <p v-if="errors.location" id="apply-location-err" class="apply__error" role="alert">{{ errors.location }}</p>
    </div>

    <div class="field" data-field="publishedAt">
      <label for="apply-time">{{ t("campaign.share.field.publishedAt") }}</label>
      <div class="apply__time">
        <DateTimeField id="apply-time" v-model="form.publishedAt" :invalid="!!bad('publishedAt')" describedby="apply-time-zone apply-time-err" :date-label="t('campaign.apply.date')" :time-label="t('campaign.apply.time')" />
        <span id="apply-time-zone" class="subtle">{{ zoneName(tz, locale) }}</span>
      </div>
      <p v-if="errors.publishedAt" id="apply-time-err" class="apply__error" role="alert">{{ errors.publishedAt }}</p>
    </div>

    <fieldset class="apply__group field" data-field="evidence">
      <legend class="apply__label">{{ t("campaign.apply.proof") }}</legend>
      <div class="apply__seg" role="radiogroup" :aria-label="t('campaign.apply.proof')">
        <label class="apply__seg-option"><input v-model="proof" type="radio" name="proof" value="link" />{{ t("campaign.apply.proofLink") }}</label>
        <label class="apply__seg-option"><input v-model="proof" type="radio" name="proof" value="shot" />{{ t("campaign.apply.proofShot") }}</label>
      </div>
      <div v-show="proof === 'link'" class="field apply__inner" data-field="url">
        <input id="apply-url" v-model="form.url" class="input" type="url" inputmode="url" maxlength="2000" placeholder="https://" :aria-label="t('campaign.share.field.url')" :aria-invalid="bad('url')" aria-describedby="apply-url-err" />
        <p v-if="errors.url" id="apply-url-err" class="apply__error" role="alert">{{ errors.url }}</p>
      </div>
      <!-- 切換時不清掉另一邊：截圖已經傳上去了，切回來還在；送出只帶選中的那一種 -->
      <div v-show="proof === 'shot'" class="apply__shots">
        <p class="apply__hint">{{ t("campaign.apply.shotHint", { n: EVIDENCE_MAX }) }}</p>
        <EvidencePicker v-model:ids="evidenceIds" @update:busy="uploading = $event" />
        <p v-if="errors.evidence" class="apply__error" role="alert">{{ errors.evidence }}</p>
      </div>
    </fieldset>

    <details class="apply__optional" :open="optionalOpen" @toggle="optionalOpen = ($event.target as HTMLDetailsElement).open">
      <summary>{{ t("campaign.apply.optionalGroup") }}</summary>
      <div class="apply__optional-body">
        <div class="field" data-field="note">
          <label for="apply-note">{{ t("campaign.share.field.note") }} <span class="subtle">{{ t("campaign.apply.optional") }}</span></label>
          <textarea autocomplete="off" id="apply-note" v-model="form.note" class="input" rows="3" maxlength="1000" :aria-invalid="bad('note')" aria-describedby="apply-note-err" />
          <p v-if="errors.note" id="apply-note-err" class="apply__error" role="alert">{{ errors.note }}</p>
        </div>
        <template v-if="kind === 'new'">
          <div class="field" data-field="cardId">
            <label for="apply-card">{{ t("campaign.share.field.cardId") }} <span class="subtle">{{ t("campaign.apply.optional") }}</span></label>
            <input id="apply-card" v-model="form.cardId" class="input apply__short" inputmode="numeric" :aria-invalid="bad('cardId')" aria-describedby="apply-card-hint apply-card-err" />
            <p id="apply-card-hint" class="apply__hint">{{ t("campaign.apply.cardIdHint") }}</p>
            <p v-if="errors.cardId" id="apply-card-err" class="apply__error" role="alert">{{ errors.cardId }}</p>
          </div>
        </template>
      </div>
    </details>

    <p v-if="formError" class="notice notice--error" role="alert" data-form-error>{{ formError }}</p>
    <button type="submit" class="btn btn--primary btn--lg apply__submit" :disabled="busy || uploading" :aria-busy="busy || undefined">{{ t("campaign.apply.submit") }}</button>
  </form>
</template>

<style scoped>
.apply { display: grid; gap: 0; }
.apply__group { border: 0; margin: 0 0 var(--s-5); padding: 0; min-width: 0; display: grid; gap: var(--s-2); }
.apply__label { padding: 0; font-size: 13px; font-weight: 600; }
.apply__choices, .apply__tiers { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.apply__choice, .apply__tier {
  display: inline-flex; align-items: center; gap: var(--s-2); min-height: var(--h-md); padding: 0 var(--s-3);
  border-radius: var(--r-pill); background: var(--surface-2); font-size: 14px; cursor: pointer;
}
.apply__choice input, .apply__tier input { margin: 0; accent-color: var(--accent); }
.apply__choice:has(input:checked), .apply__tier:has(input:checked) { background: var(--accent-soft); color: var(--accent-text); box-shadow: inset 0 0 0 1px var(--accent); }
.apply__amount { color: var(--text-2); font-size: 13px; }
.apply__tier:has(input:checked) .apply__amount { color: inherit; }
.apply__short { max-width: 280px; }
/* 平台：單選膠囊，選中的描邊加淡底；「更多平台…」是虛線，看得出它是展開不是選項 */
.apply__platforms { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.apply__platform {
  display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px; border-radius: var(--r-pill);
  border: 1px solid var(--line-strong); background: var(--surface); color: var(--text); font: inherit; font-size: 14px; cursor: pointer;
}
.apply__platform[aria-checked="true"] { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); color: var(--accent-text); font-weight: 600; }
.apply__platform--more { border-style: dashed; color: var(--text-2); }
.apply__platforms[aria-invalid="true"] .apply__platform { border-color: var(--danger); }
/* 證明方式：分段控制，每段 44 高 */
.apply__seg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 4px; border-radius: var(--r-pill); background: var(--surface-2); max-width: 360px; }
.apply__seg-option { position: relative; display: grid; place-items: center; min-height: 44px; border-radius: var(--r-pill); font-size: 14px; font-weight: 600; color: var(--text-2); cursor: pointer; }
.apply__seg-option input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
.apply__seg-option:has(input:checked) { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(16, 16, 24, 0.08); }
.apply__seg-option:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.apply__shots { display: grid; gap: var(--s-2); }
/* 選填的補充說明與關聯卡片收在一起 */
.apply__optional { margin: 0 0 var(--s-5); }
.apply__optional summary { min-height: 44px; display: flex; align-items: center; font-size: 14px; font-weight: 600; cursor: pointer; }
.apply__optional-body { display: grid; padding-top: var(--s-2); }
.apply__time { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); }
.apply__inner { margin-bottom: var(--s-2); }
.apply__hint { margin: 0; font-size: 13px; color: var(--text-3); }
.apply__error { margin: 0; font-size: 13px; color: var(--danger); }
.apply [aria-invalid="true"] { border-color: var(--danger); }
.apply__submit { justify-self: start; min-width: 160px; }
@media (max-width: 760px) {
  .apply__choice, .apply__tier, .apply__submit { min-height: 44px; }
  .apply__short { max-width: none; }
  .apply__submit { justify-self: stretch; }
  /* 手機上檔位排成一欄，金額靠右：四個膠囊換行會參差不齊 */
  .apply__tiers { display: grid; }
  .apply__amount { margin-left: auto; }
}
</style>
