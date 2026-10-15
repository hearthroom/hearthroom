<script setup lang="ts">
/**
 * 活動頁的分享申請表：新的分享（標題、選填的卡片）或替自己既有的內容再加一個位置。
 * 發布時間以活動的時區解讀（zonedToEpoch）；連結與截圖至少一個。伺服器回 share_invalid 帶 field 時標在那一格，
 * 其他錯誤放在表單底下。同樣的內容失敗後重按沿用同一個 operationId。
 * 成功時 emit done，由父層用 :key 換掉整張表（截圖選擇器一起重置）。
 */
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import EvidencePicker from "@/components/EvidencePicker.vue";
import {
  CampaignError, DEFAULT_TIMEZONE, PLATFORMS, TIERS, campaignErrorText, epochToZoned, fieldLabel, formatPoints, isWebUrl, submitPlacement, zonedToEpoch, zoneName,
  type ApplyResult, type ContentView, type Platform, type PublicCampaign, type SubmitBody, type Tier,
} from "@/lib/campaign";
import { useSession } from "@/lib/session";

const props = defineProps<{ campaign: PublicCampaign; contents: ContentView[] }>();
const emit = defineEmits<{ done: [result: ApplyResult] }>();
const { t, locale } = useI18n();
const session = useSession();

const tz = computed(() => props.campaign.timezone || DEFAULT_TIMEZONE);
const tiers = computed(() => TIERS.filter((k) => typeof props.campaign.tiers[k] === "number"));

const kind = ref<"new" | "existing">("new");
const form = reactive({
  title: "", cardId: "", contentId: "", tier: "" as Tier | "", platform: "" as Platform | "", location: "",
  publishedAt: epochToZoned(Date.now(), tz.value), url: "", note: "",
});
const evidenceIds = ref<string[]>([]);
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
  if (url && !isWebUrl(url)) errors.url = t("campaign.apply.badUrl");
  if (!url && !evidenceIds.value.length) errors.evidence = t("campaign.apply.needProof");
  if (Object.keys(errors).length) return null;
  const base = {
    platform: form.platform as Platform, location, publishedAt: publishedAt!, requestedTier: form.tier as Tier,
    ...(url ? { url } : {}), ...(note ? { note } : {}), ...(evidenceIds.value.length ? { evidenceIds: evidenceIds.value } : {}),
  };
  return existing ? { ...base, contentId: form.contentId } : { ...base, content: { title, ...(cardId ? { cardId: Number(cardId) } : {}) } };
}

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
        <input id="apply-title" v-model="form.title" class="input" maxlength="120" required :aria-invalid="bad('title')" aria-describedby="apply-title-err" />
        <p v-if="errors.title" id="apply-title-err" class="apply__error" role="alert">{{ errors.title }}</p>
      </div>
      <div class="field" data-field="cardId">
        <label for="apply-card">{{ t("campaign.share.field.cardId") }} <span class="subtle">{{ t("campaign.apply.optional") }}</span></label>
        <input id="apply-card" v-model="form.cardId" class="input apply__short" inputmode="numeric" :aria-invalid="bad('cardId')" aria-describedby="apply-card-hint apply-card-err" />
        <p id="apply-card-hint" class="apply__hint">{{ t("campaign.apply.cardIdHint") }}</p>
        <p v-if="errors.cardId" id="apply-card-err" class="apply__error" role="alert">{{ errors.cardId }}</p>
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
      <label for="apply-platform">{{ t("campaign.share.field.platform") }}</label>
      <select id="apply-platform" v-model="form.platform" class="input apply__short" required :aria-invalid="bad('platform')" aria-describedby="apply-platform-err">
        <option value="" disabled>{{ t("campaign.apply.choosePlatform") }}</option>
        <option v-for="p in PLATFORMS" :key="p" :value="p">{{ t(`campaign.platform.${p}`) }}</option>
      </select>
      <p v-if="errors.platform" id="apply-platform-err" class="apply__error" role="alert">{{ errors.platform }}</p>
    </div>

    <div class="field" data-field="location">
      <label for="apply-location">{{ t("campaign.share.field.location") }}</label>
      <input id="apply-location" v-model="form.location" class="input" maxlength="200" required :aria-invalid="bad('location')" aria-describedby="apply-location-hint apply-location-err" />
      <p id="apply-location-hint" class="apply__hint">{{ t("campaign.apply.locationHint") }}</p>
      <p v-if="errors.location" id="apply-location-err" class="apply__error" role="alert">{{ errors.location }}</p>
    </div>

    <div class="field" data-field="publishedAt">
      <label for="apply-time">{{ t("campaign.share.field.publishedAt") }}</label>
      <div class="apply__time">
        <input id="apply-time" v-model="form.publishedAt" class="input apply__short" type="datetime-local" required :aria-invalid="bad('publishedAt')" aria-describedby="apply-time-zone apply-time-err" />
        <span id="apply-time-zone" class="subtle">{{ zoneName(tz, locale) }}</span>
      </div>
      <p v-if="errors.publishedAt" id="apply-time-err" class="apply__error" role="alert">{{ errors.publishedAt }}</p>
    </div>

    <fieldset class="apply__group field" data-field="evidence">
      <legend class="apply__label">{{ t("campaign.share.field.evidence") }}</legend>
      <p class="apply__hint">{{ t("campaign.apply.proofHint") }}</p>
      <div class="field apply__inner" data-field="url">
        <label for="apply-url">{{ t("campaign.share.field.url") }}</label>
        <input id="apply-url" v-model="form.url" class="input" type="url" inputmode="url" maxlength="2000" placeholder="https://" :aria-invalid="bad('url')" aria-describedby="apply-url-err" />
        <p v-if="errors.url" id="apply-url-err" class="apply__error" role="alert">{{ errors.url }}</p>
      </div>
      <span class="apply__label">{{ t("campaign.apply.screenshots") }}</span>
      <EvidencePicker v-model:ids="evidenceIds" @update:busy="uploading = $event" />
      <p v-if="errors.evidence" class="apply__error" role="alert">{{ errors.evidence }}</p>
    </fieldset>

    <div class="field" data-field="note">
      <label for="apply-note">{{ t("campaign.share.field.note") }} <span class="subtle">{{ t("campaign.apply.optional") }}</span></label>
      <textarea id="apply-note" v-model="form.note" class="input" rows="3" maxlength="1000" :aria-invalid="bad('note')" aria-describedby="apply-note-err" />
      <p v-if="errors.note" id="apply-note-err" class="apply__error" role="alert">{{ errors.note }}</p>
    </div>

    <p v-if="formError" class="notice notice--error" role="alert" data-form-error>{{ formError }}</p>
    <button type="submit" class="btn btn--primary apply__submit" :disabled="busy || uploading" :aria-busy="busy || undefined">{{ t("campaign.apply.submit") }}</button>
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
.apply__choice:has(input:checked), .apply__tier:has(input:checked) { background: var(--accent-tint); color: var(--accent-text); }
.apply__amount { color: var(--text-2); font-size: 13px; }
.apply__tier:has(input:checked) .apply__amount { color: inherit; }
.apply__short { max-width: 280px; }
.apply__time { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); }
.apply__inner { margin-bottom: var(--s-2); }
.apply__hint { margin: 0; font-size: 13px; color: var(--text-3); }
.apply__error { margin: 0; font-size: 13px; color: var(--danger); }
.apply [aria-invalid="true"] { border-color: var(--danger); }
.apply__submit { justify-self: start; }
@media (max-width: 760px) {
  .apply__choice, .apply__tier, .apply__submit { min-height: 44px; }
  .apply__short { max-width: none; }
}
</style>
