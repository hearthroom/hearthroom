<script setup lang="ts">
/**
 * 作者 Discord 入口：放在「我的卡片」頁首與建卡頁頁首。
 *
 * 邀請連結優先取自 App.vue 提供的 siteLinksKey（同一次 /community/config 請求）；
 * 單獨掛載（如元件或頁面測試）時才自己讀一次 /community/config。
 * 沒有 invite 時不顯示，不露出壞連結。
 */
import { computed, inject, onMounted, ref } from "vue";
import CommunityIcon from "@/components/CommunityIcon.vue";
import { communityRequest } from "@/lib/community";
import { siteLinksKey } from "@/lib/site-links";
import { track } from "@/lib/track";

const props = defineProps<{ where: "my-cards" | "editor" }>();

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
  track("cta", { detail: "discord", subject: props.where });
}
</script>

<template>
  <a
    v-if="invite"
    :href="invite"
    target="_blank"
    rel="noopener noreferrer"
    class="author-discord"
    data-author-discord
    :data-where="where"
    @click="onClick"
  >
    <span class="author-discord__icon" aria-hidden="true">
      <CommunityIcon name="discord" />
    </span>
    <span class="author-discord__copy">
      <span class="author-discord__label">{{ $t("authorDiscord.label") }}</span>
      <span class="author-discord__hint">{{ $t("authorDiscord.hint") }}</span>
    </span>
    <span class="author-discord__arrow" aria-hidden="true">→</span>
  </a>
</template>

<style scoped>
.author-discord {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  min-height: var(--h-md);
  padding: var(--s-2) var(--s-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
  transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.author-discord:hover {
  background: var(--surface-2);
  border-color: var(--border-strong);
}
.author-discord:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.author-discord__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  color: var(--text);
}
.author-discord__copy {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 2px;
  text-align: left;
  overflow-wrap: anywhere;
}
.author-discord__label {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text);
}
.author-discord__hint {
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
  color: var(--text-2);
}
.author-discord__arrow {
  flex: none;
  font-size: 13px;
  line-height: 1;
  color: var(--text-3);
  transition: transform var(--dur) var(--ease), color var(--dur) var(--ease);
}
.author-discord:hover .author-discord__arrow {
  color: var(--text);
  transform: translateX(2px);
}
:lang(ko) .author-discord__copy {
  word-break: keep-all;
}
:lang(ja) .author-discord__copy {
  word-break: auto-phrase;
}
@media (pointer: coarse) {
  .author-discord {
    min-height: var(--h-lg);
  }
}
</style>
