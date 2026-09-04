<script setup lang="ts">
import { RouterLink } from "vue-router";
import { compact, hueFrom } from "@/lib/format";
import { useLocalePath } from "@/lib/use-locale";
import type { Author } from "@/lib/types";

defineProps<{ authors: Author[]; ranked?: boolean; rankOffset?: number; showTrending?: boolean }>();
const { lp } = useLocalePath();
</script>

<template>
  <ol class="al">
    <li v-for="(a, i) in authors" :key="a.accountNumId">
      <RouterLink :to="lp(`/authors/${a.accountNumId}`)" class="al__row">
        <!-- 前三名用跟卡片牆同一款徽章；其餘只是個數字，不必每一列都戴勳章 -->
        <span v-if="ranked" class="al__rank" role="img" :aria-label="$t('board.rank', { n: (rankOffset ?? 0) + i + 1 })">
          <span v-if="(rankOffset ?? 0) + i < 3" class="medal" :class="`medal--${(rankOffset ?? 0) + i + 1}`">{{ (rankOffset ?? 0) + i + 1 }}</span>
          <template v-else>{{ (rankOffset ?? 0) + i + 1 }}</template>
        </span>
        <img v-if="a.avatar" :src="a.avatar" alt="" class="al__face" />
        <span v-else class="al__face mono" :style="{ '--h': hueFrom(a.name) }">{{ [...a.name][0] }}</span>
        <span class="al__who">
          <strong class="al__name">{{ a.name }}</strong>
          <span class="subtle">{{ $t("author.cards", { n: a.cardCount }) }}</span>
        </span>
        <span class="al__num">
          <strong>{{ compact(a.talkTotal) }}</strong>
          <span class="subtle">{{ $t("author.stat.talk") }}</span>
        </span>
        <span v-if="showTrending" class="al__num al__num--up">
          <strong>{{ a.trending ? `+${compact(a.trending)}` : "—" }}</strong>
          <span class="subtle">{{ $t("author.sort.hot") }}</span>
        </span>
        <svg class="al__arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </RouterLink>
    </li>
  </ol>
</template>

<style scoped>
.al { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.al__row {
  display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto auto auto; align-items: center; gap: var(--s-4);
  padding: 10px 14px;
  background: var(--surface); border-radius: var(--r-md);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-sm);
  transition: box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.al__row:hover { box-shadow: 0 0 0 1px var(--line-strong), var(--shadow-md); transform: translateY(-1px); }
.al__rank { display: inline-flex; justify-content: center; width: 28px; font-size: 14px; font-weight: 600; color: var(--text-3); font-variant-numeric: tabular-nums; }
.al__face { width: 40px; height: 40px; border-radius: var(--r-pill); object-fit: cover; font-size: 16px; }
.al__who { display: grid; min-width: 0; line-height: 1.35; }
.al__name { font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al__num { display: grid; text-align: right; line-height: 1.3; min-width: 4.5em; }
.al__num strong { font-size: 15px; font-variant-numeric: tabular-nums; }
.al__num--up strong { color: var(--accent-text); }
.al__arrow { width: 16px; height: 16px; color: var(--text-3); transition: transform var(--dur) var(--ease), color var(--dur) var(--ease); }
.al__row:hover .al__arrow { transform: translateX(3px); color: var(--accent-text); }
@media (max-width: 640px) {
  .al__row { grid-template-columns: auto auto minmax(0, 1fr) auto; gap: var(--s-3); }
  .al__num--up, .al__arrow { display: none; }
}
</style>
