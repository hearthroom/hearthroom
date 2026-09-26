<script setup lang="ts">
/**
 * 主頁上的評論摘要：最前面幾則，加上「看全部」。
 *
 * 評論是玩家決定要不要玩之前最想看的東西之一，原本藏在另一個分頁、要點過去才載。
 * 這裡只讀第一頁、只畫前三則（伺服器已經把置頂排在前面），完整的讀寫仍在評論分頁。
 * 讀不到就整塊不畫：少一塊摘要不該讓主頁看起來壞掉。
 */
import { onMounted, ref } from "vue";
import CommunityAvatar from "@/components/CommunityAvatar.vue";
import CommunityName from "@/components/CommunityName.vue";
import { fetchComments, type Comment } from "@/lib/api";
import { relativeTime } from "@/lib/format";

const props = defineProps<{ cardId: string }>();
const emit = defineEmits<{ open: []; count: [n: number] }>();

const SHOWN = 3;
const comments = ref<Comment[]>([]);
const total = ref(0);
const state = ref<"loading" | "ready" | "failed">("loading");

onMounted(async () => {
  try {
    const res = await fetchComments(props.cardId, 1);
    comments.value = res.comments.slice(0, SHOWN);
    total.value = res.total;
    state.value = "ready";
    emit("count", res.total);
  } catch {
    state.value = "failed";
  }
});
</script>

<template>
  <section v-if="state !== 'failed'" class="cprev">
    <h2 class="eyebrow">{{ $t("card.tab.comments") }}<span v-if="total" class="cprev__n">{{ total }}</span></h2>

    <div v-if="state === 'loading'" class="cprev__ghosts" aria-hidden="true">
      <div v-for="i in 2" :key="i" class="ghost" />
    </div>

    <template v-else-if="comments.length">
      <ul class="cprev__list">
        <li v-for="c in comments" :key="c.commentId" class="cprev__item">
          <CommunityAvatar :handle="c.handle" :src="c.accountAvatar" :name="c.accountNickName" class="cprev__face" />
          <div class="cprev__body">
            <div class="cprev__head">
              <CommunityName :handle="c.handle" :name="c.accountNickName" class="cprev__name" />
              <span v-if="c.isCreator" class="cprev__badge">{{ $t("comment.creator") }}</span>
              <span v-if="c.isPinned" class="cprev__badge cprev__badge--pin">{{ $t("comment.pinned") }}</span>
              <span class="subtle">{{ relativeTime(Date.parse(c.createTime)) }}</span>
            </div>
            <p class="cprev__text">{{ c.content }}</p>
          </div>
        </li>
      </ul>
      <button type="button" class="btn btn--sm" @click="emit('open')">{{ $t("card.commentsAll", { n: total }) }}</button>
    </template>

    <div v-else class="cprev__empty">
      <p class="muted">{{ $t("comment.empty") }}</p>
      <button type="button" class="btn btn--sm" @click="emit('open')">{{ $t("card.commentsWrite") }}</button>
    </div>
  </section>
</template>

<style scoped>
.cprev { display: grid; gap: var(--s-3); justify-items: start; }
.cprev__n { margin-left: 6px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.cprev__ghosts { display: grid; gap: var(--s-3); width: 100%; }
.cprev__ghosts .ghost { height: 52px; border-radius: var(--r-md); }
.cprev__list { display: grid; gap: var(--s-4); width: 100%; margin: 0; padding: 0; list-style: none; }
.cprev__item { display: flex; gap: 10px; align-items: flex-start; }
.cprev__face { width: 32px; height: 32px; border-radius: 999px; object-fit: cover; flex: none; }
.cprev__face.mono { font-size: 13px; }
.cprev__body { display: grid; gap: 2px; min-width: 0; }
.cprev__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; }
.cprev__name { font-weight: 600; }
/* 徽章跟評論分頁同一套 */
.cprev__badge { padding: 1px 6px; border-radius: 5px; font-size: 11px; font-weight: 600; background: var(--accent-tint); color: var(--accent-text); }
.cprev__badge--pin { background: var(--surface-2); color: var(--text-2); }
.cprev__text {
  margin: 0; font-size: 14px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden;
}
.cprev__empty { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); }
.cprev__empty p { margin: 0; }
</style>
