<script setup lang="ts">
/**
 * 審核頁的「作者」：這張卡的原作者（Harbor 帳號名稱、數字帳號 ID、本站代號），
 * 以及一鍵展開同一位作者的所有卡與各自的審核狀態（owner 2026-11-08：盜卡抓到一張要能一串查出）。
 *
 * 清單第一次展開才讀；連結開新分頁，審核員手上這張單不會被換掉。
 * 待審的卡連到它的審核單，已發布的連到作品管理（帶卡號，可以在那裡暫停公開或發起重新審核）。
 */
import { ref } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import { fetchReviewAuthorCards, type ReviewAuthor, type ReviewAuthorCard } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";

const props = defineProps<{ submissionId: string; author: ReviewAuthor }>();
const { t, locale } = useI18n();
const { lp } = useLocalePath();
const session = useSession();

const open = ref(false);
const loading = ref(false);
const error = ref("");
const cards = ref<ReviewAuthorCard[] | null>(null);
const total = ref(0);

const STATUSES = new Set(["pending", "approved", "rejected", "needs_review", "unshared"]);
const statusLabel = (s: string) => (s === "unshared" ? t("mine.badge.unshared") : t(`review.author.status.${STATUSES.has(s) ? s : "pending"}`));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const result = await fetchReviewAuthorCards(props.submissionId, token, String(locale.value));
    cards.value = result.items;
    total.value = result.total;
  } catch (err) {
    error.value = err instanceof Error && err.message === t("auth.expired") ? err.message : t("review.author.loadFailed");
  } finally {
    loading.value = false;
  }
}

function toggle() {
  open.value = !open.value;
  if (open.value && !cards.value && !loading.value) void load();
}
</script>

<template>
  <section class="author" data-review-author>
    <div class="author__who">
      <img v-if="author.avatar" class="author__avatar" :src="author.avatar" alt="" loading="lazy" />
      <span v-else class="author__avatar author__avatar--void" aria-hidden="true">{{ author.name.slice(0, 1) }}</span>
      <div class="author__text">
        <p class="author__label">{{ $t("card.author") }}</p>
        <p class="author__name">
          <span data-author-name>{{ author.name }}</span>
          <span v-if="author.handle" class="author__handle" data-author-handle>@{{ author.handle }}</span>
        </p>
        <p class="author__meta">
          <span data-author-account>{{ $t("review.author.accountId", { id: author.accountNumId }) }}</span>
          <span v-if="author.communityName" data-author-nickname>{{ $t("review.author.nickname", { name: author.communityName }) }}</span>
        </p>
      </div>
    </div>
    <button v-if="author.cardCount > 1" type="button" class="btn btn--sm author__toggle" :aria-expanded="open" aria-controls="author-cards" data-author-cards-toggle @click="toggle">
      {{ open ? $t("review.author.hideCards") : $t("review.author.showCards", { n: author.cardCount }) }}
    </button>
    <p v-else class="author__only" data-author-only>{{ $t("review.author.onlyThis") }}</p>

    <div v-if="open" id="author-cards" class="author__cards">
      <div v-if="loading" class="author__list" aria-hidden="true"><div v-for="i in Math.min(author.cardCount, 3)" :key="i" class="ghost author__ghost" /></div>
      <div v-else-if="error" class="notice notice--error author__error" role="alert">
        <p>{{ error }}</p>
        <button type="button" class="btn btn--sm" data-author-cards-retry @click="load">{{ $t("review.correction.reload") }}</button>
      </div>
      <template v-else-if="cards">
        <ul class="author__list" data-author-cards>
          <li v-for="c in cards" :key="c.id" class="item" :class="{ 'item--current': c.current }" :data-author-card="c.id">
            <div class="item__art">
              <img v-if="c.coverUrl" :src="c.coverUrl" alt="" loading="lazy" />
            </div>
            <div class="item__body">
              <p class="item__name">
                <span v-if="c.name">{{ c.name }}</span>
                <span v-else class="item__hidden" data-adult-hidden>{{ $t("review.author.adultHidden") }}</span>
              </p>
              <p class="item__chips">
                <span v-if="c.current" class="chip chip--current">{{ $t("review.author.current") }}</span>
                <span class="chip" :class="`chip--${c.status}`" data-author-card-status>{{ statusLabel(c.status) }}</span>
                <span v-if="c.reReview" class="chip chip--warn">{{ $t("mine.badge.reReview") }}</span>
                <span v-if="c.held" class="chip chip--warn">{{ $t("review.hold.chip") }}</span>
                <span v-if="c.publicBlocked" class="chip chip--rejected">{{ $t("moderation.blocked") }}</span>
                <span v-if="c.boardHidden" class="chip">{{ $t("review.author.unlisted") }}</span>
              </p>
              <p class="item__meta">
                #{{ c.id }} · {{ $t("review.author.counts", { decided: c.decided, rejected: c.rejected }) }}
                · {{ c.latest ? $t("review.author.latest", { time: dateTime(c.latest.submittedAt) }) : $t("review.author.never") }}
              </p>
            </div>
            <div v-if="!c.current" class="item__acts">
              <RouterLink v-if="c.latest?.status === 'pending'" class="btn btn--sm" :to="lp(`/review/${c.latest.id}`)" target="_blank" data-author-card-review>{{ $t("review.author.openReview") }}</RouterLink>
              <RouterLink v-else-if="c.status === 'approved'" class="btn btn--sm" :to="lp(`/review/cards?q=${encodeURIComponent(c.id)}`)" target="_blank" data-author-card-manage>{{ $t("moderation.tab.cards") }}</RouterLink>
            </div>
          </li>
        </ul>
        <p v-if="total > cards.length" class="author__only">{{ $t("review.author.truncated", { n: cards.length }) }}</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.author { display: grid; gap: var(--s-2); margin-top: var(--s-3); padding: var(--s-3); border-radius: var(--r-md); background: var(--surface-2); min-width: 0; }
.author__who { display: flex; gap: var(--s-3); align-items: center; min-width: 0; }
.author__avatar { flex: none; width: 40px; height: 40px; border-radius: var(--r-pill); object-fit: cover; background: var(--surface); }
.author__avatar--void { display: grid; place-items: center; font-weight: 600; color: var(--text-2); }
.author__text { display: grid; gap: 2px; min-width: 0; }
.author__label { font-size: 12px; color: var(--text-3); }
.author__name { display: flex; flex-wrap: wrap; gap: 0 var(--s-2); align-items: baseline; font-weight: 600; font-size: 15px; overflow-wrap: anywhere; }
.author__handle { font-weight: 400; font-size: 13px; color: var(--text-2); }
.author__meta { display: flex; flex-wrap: wrap; gap: 0 var(--s-3); font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.author__toggle { justify-self: start; min-height: var(--h-md); }
.author__only { font-size: 13px; color: var(--text-3); }
.author__cards { min-width: 0; }
.author__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.author__ghost { height: 64px; border-radius: var(--r-sm); }
.author__error { display: grid; gap: var(--s-2); justify-items: start; margin: 0; }
.item { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: var(--s-3); align-items: center; padding: var(--s-2); border-radius: var(--r-md); background: var(--surface); }
.item--current { box-shadow: 0 0 0 1px var(--accent); }
.item__art { width: 36px; aspect-ratio: 3 / 4; border-radius: var(--r-sm); overflow: hidden; background: var(--surface-2); }
.item__art img { width: 100%; height: 100%; object-fit: cover; }
.item__body { display: grid; gap: 4px; min-width: 0; }
.item__name { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
.item__hidden { font-weight: 400; color: var(--text-2); }
.item__chips { display: flex; flex-wrap: wrap; gap: var(--s-1); }
.item__meta { font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.item__acts .btn { white-space: nowrap; }
.chip--current { background: var(--accent-tint); color: var(--accent-text); }
.chip--rejected { color: var(--danger); }
.chip--warn { color: var(--warning-text); }
@media (max-width: 600px) {
  .item { grid-template-columns: 36px minmax(0, 1fr); }
  .item__acts { grid-column: 2; }
  .item__acts .btn, .author__toggle { min-height: var(--h-lg); }
}
</style>
