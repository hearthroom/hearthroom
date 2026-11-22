<script setup lang="ts">
/**
 * 同裝置額度受阻時的求助連結：整句連到 Discord 申請獨立額度。
 * 邀請連結優先取自 App.vue 提供的 siteLinksKey；單獨掛載時讀一次 /community/config。
 * 沒有邀請連結時整個元件不渲染，不留空位。
 */
import { computed, inject, onMounted, ref } from "vue";
import { communityRequest } from "@/lib/community";
import { siteLinksKey } from "@/lib/site-links";
import { track } from "@/lib/track";

withDefaults(defineProps<{ align?: "start" | "center" }>(), { align: "start" });

const siteLinks = inject(siteLinksKey, null);
const fallbackInvite = ref<string | null>(null);

const invite = computed(() => {
  const raw = siteLinks ? siteLinks.value.discordInvite : fallbackInvite.value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
});

onMounted(() => {
  if (siteLinks) return;
  communityRequest<{ invite?: string | null }>("/community/config")
    .then((r) => {
      fallbackInvite.value = typeof r?.invite === "string" && r.invite.trim() ? r.invite.trim() : null;
    })
    .catch(() => {});
});

function onClick() {
  track("cta", { detail: "discord", subject: "quota-device" });
}
</script>

<template>
  <a
    v-if="invite"
    :href="invite"
    target="_blank"
    rel="noopener noreferrer"
    class="quota-device-help"
    :class="{ 'quota-device-help--center': align === 'center' }"
    data-quota-device-help
    @click="onClick"
  >{{ $t("mine.quota.deviceHelp") }}</a>
</template>

<style scoped>
.quota-device-help {
  display: inline-flex;
  align-items: center;
  min-height: var(--h-sm);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--accent-text);
  text-decoration: underline;
  text-underline-offset: 3px;
  overflow-wrap: anywhere;
  text-wrap: balance;
}
.quota-device-help--center {
  justify-content: center;
  justify-self: center;
  text-align: center;
}
.quota-device-help:lang(ko) {
  word-break: keep-all;
}
.quota-device-help:lang(ja) {
  word-break: auto-phrase;
}
</style>
