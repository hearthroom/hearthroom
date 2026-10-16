<script setup lang="ts">
/**
 * 每份分享內容的專屬連結：活動頁網址＋推薦碼（?ref=，讀不到就不帶）＋分享短碼（?s=），可複製。
 * 連結指向那份內容所屬的活動頁，所以跨活動的清單也能用。複製記 campaign_share，subject 是活動 slug。
 */
import { onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ContentView } from "@/lib/campaign";
import { useSession } from "@/lib/session";
import { currentReferralCode, withCampaignShare } from "@/lib/share-ref";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";

defineProps<{ items: ContentView[] }>();
const { t } = useI18n();
const { lp } = useLocalePath();
const session = useSession();

const refCode = ref<string | null>(null);
watch(() => session.me?.accountNumId ?? null, async (id) => {
  refCode.value = null;
  if (!id) return;
  const code = await currentReferralCode(id);
  if ((session.me?.accountNumId ?? null) === id) refCode.value = code;
}, { immediate: true });

const linkOf = (c: ContentView) => withCampaignShare(new URL(lp(`/campaign/${c.campaignSlug}`), location.origin).href, refCode.value, c.shareCode);

const copied = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;
async function copy(c: ContentView) {
  try {
    await navigator.clipboard.writeText(linkOf(c));
    copied.value = c.id;
    clearTimeout(timer);
    timer = setTimeout(() => { copied.value = ""; }, 1800);
    track("campaign_share", { subject: c.campaignSlug });
  } catch { /* 拿不到剪貼簿：連結就在畫面上 */ }
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <ul class="share-links">
    <li v-for="c in items" :key="c.id" class="share-links__item" :data-share-link="c.id">
      <strong class="share-links__title">{{ c.title }}</strong>
      <span class="share-links__url" data-url>{{ linkOf(c) }}</span>
      <button type="button" class="btn btn--sm share-links__copy" data-action="copy" @click="copy(c)">
        {{ copied === c.id ? t("campaign.share.copied") : t("campaign.share.copy") }}
      </button>
    </li>
  </ul>
</template>

<style scoped>
.share-links { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.share-links__item {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--s-1) var(--s-4); align-items: center;
  padding: var(--s-3) var(--s-4); border-radius: var(--r-sm); background: var(--surface-2);
}
.share-links__title { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
/* 不用全站的 .mono：那是單字頭像的圓底，不是等寬字 */
.share-links__url {
  grid-column: 1; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5;
  color: var(--text-2); word-break: break-all;
}
.share-links__copy { grid-column: 2; grid-row: 1 / span 2; }
@media (max-width: 480px) {
  .share-links__item { grid-template-columns: minmax(0, 1fr); }
  .share-links__copy { grid-column: 1; grid-row: auto; justify-self: start; margin-top: var(--s-1); }
}
@media (max-width: 760px) { .share-links__copy { min-height: 44px; } }
</style>
