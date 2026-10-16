<script setup lang="ts">
/**
 * 我的專屬連結：活動頁網址＋自己的推薦碼（?ref=）。登入就給，不必先提交分享（owner 2026-10-16：
 * 之前要交過一次才拿得到連結，等於沒有東西可以分享）。推薦碼讀不到（舊登入沒授權推薦、服務暫時不通）
 * 就給不帶碼的網址，分享照樣能用，只是推薦獎勵算不到。複製記 campaign_share，subject 是活動 slug。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSession } from "@/lib/session";
import { currentReferralCode, withShareRef } from "@/lib/share-ref";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";

const props = defineProps<{ slug: string }>();
const { t } = useI18n();
const { lp } = useLocalePath();
const session = useSession();

const refCode = ref<string | null>(null);
const ready = ref(false);
watch(() => session.me?.accountNumId ?? null, async (id) => {
  refCode.value = null;
  ready.value = false;
  if (!id) return;
  const code = await currentReferralCode(id);
  if ((session.me?.accountNumId ?? null) !== id) return;
  refCode.value = code;
  ready.value = true;
}, { immediate: true });

const link = computed(() => withShareRef(new URL(lp(`/campaign/${props.slug}`), location.origin).href, refCode.value));

const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
async function copy() {
  try {
    await navigator.clipboard.writeText(link.value);
    copied.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => { copied.value = false; }, 1800);
    track("campaign_share", { subject: props.slug });
  } catch { /* 拿不到剪貼簿：連結就在畫面上 */ }
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="invite" data-invite-link :aria-busy="!ready">
    <label class="invite__label" for="invite-link">{{ t("campaign.share.mine") }}</label>
    <div class="invite__row">
      <input id="invite-link" class="input invite__url" readonly :value="link" @focus="($event.target as HTMLInputElement).select()" />
      <button type="button" class="btn btn--primary invite__copy" data-action="copy-invite" :disabled="!ready" @click="copy">
        {{ copied ? t("campaign.share.copied") : t("campaign.share.copy") }}
      </button>
    </div>
    <p class="invite__hint">{{ t("campaign.share.mineHint") }}</p>
  </div>
</template>

<style scoped>
.invite { display: grid; gap: var(--s-2); padding: var(--s-4); border-radius: var(--r-sm); background: var(--accent-tint); }
.invite__label { font-size: 14px; font-weight: 600; }
.invite__row { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.invite__url { flex: 1 1 240px; min-width: 0; font-size: 13.5px; }
.invite__copy { flex: none; }
.invite__hint { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text-2); }
@media (max-width: 480px) { .invite__copy { width: 100%; min-height: 44px; } }
</style>
