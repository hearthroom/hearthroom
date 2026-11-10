<script setup lang="ts">
/**
 * 作者 Discord 入口：放在「我的卡片」頁首與建卡頁頁首。
 *
 * 按鈕（.btn.btn--discord）加緊鄰的說明句（.join__hint）成一組（.join）。
 * 邀請連結優先取自 App.vue 提供的 siteLinksKey（同一次 /community/config 請求）；
 * 單獨掛載（如元件或頁面測試）時才自己讀一次 /community/config。
 * 沒有 invite 時整組不顯示，不留空位。
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

const hintId = computed(() => `author-discord-hint-${props.where}`);

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
  <div
    v-if="invite"
    class="join"
    :class="`join--${where}`"
    data-author-discord
    :data-where="where"
  >
    <a
      :href="invite"
      target="_blank"
      rel="noopener noreferrer"
      class="btn btn--discord join__btn"
      :aria-describedby="hintId"
      data-author-discord-btn
      @click="onClick"
    >
      <CommunityIcon name="discord" />
      <span>{{ $t("community.join") }}</span>
    </a>
    <p :id="hintId" class="join__hint">{{ $t("authorDiscord.hint") }}</p>
  </div>
</template>

<style scoped>
.join {
  min-width: 0;
}
.join--my-cards {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-1) var(--s-3);
}
.join--my-cards .join__btn {
  flex: none;
}
.join--my-cards .join__hint {
  flex: 1 1 220px;
  min-width: 0;
}
.join--editor {
  display: grid;
  justify-items: start;
  gap: var(--s-1);
}
.join__hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-2);
  overflow-wrap: anywhere;
}
:lang(ko) .join__hint {
  word-break: keep-all;
}
:lang(ja) .join__hint {
  word-break: auto-phrase;
}
@media (max-width: 599px) {
  .join--my-cards {
    display: grid;
    justify-items: stretch;
    gap: var(--s-1);
  }
  .join--my-cards .join__btn {
    width: 100%;
    height: var(--h-lg);
  }
}
</style>
