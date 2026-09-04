<script setup lang="ts">
import { RouterLink } from "vue-router";
import { compact } from "@/lib/format";
import { useLocalePath } from "@/lib/use-locale";
import type { Author } from "@/lib/types";

defineProps<{ authors: Author[]; ranked?: boolean; rankOffset?: number; showTrending?: boolean }>();
const { lp } = useLocalePath();
</script>

<template>
  <ol class="al">
    <li v-for="(a, i) in authors" :key="a.accountNumId">
      <RouterLink :to="lp(`/authors/${a.accountNumId}`)" class="al__row">
        <span v-if="ranked" class="al__rank" :class="(rankOffset ?? 0) + i < 3 && `al__rank--${(rankOffset ?? 0) + i + 1}`">{{ (rankOffset ?? 0) + i + 1 }}</span>
        <img v-if="a.avatar" :src="a.avatar" alt="" class="al__face" />
        <span v-else class="al__face al__face--void">{{ [...a.name][0] }}</span>
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
        <span class="al__arrow" aria-hidden="true">→</span>
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
.al__rank { width: 28px; text-align: center; font-size: 15px; font-weight: 700; color: var(--text-3); font-variant-numeric: tabular-nums; }
.al__rank--1 { color: var(--gold); } .al__rank--2 { color: var(--silver); } .al__rank--3 { color: var(--bronze); }
.al__face { width: 40px; height: 40px; border-radius: 999px; object-fit: cover; }
.al__face--void { display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.al__who { display: grid; min-width: 0; line-height: 1.35; }
.al__name { font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al__num { display: grid; text-align: right; line-height: 1.3; min-width: 4.5em; }
.al__num strong { font-size: 15px; font-variant-numeric: tabular-nums; }
.al__num--up strong { color: var(--accent); }
.al__arrow { color: var(--text-3); transition: transform var(--dur) var(--ease), color var(--dur) var(--ease); }
.al__row:hover .al__arrow { transform: translateX(3px); color: var(--accent); }
@media (max-width: 640px) {
  .al__row { grid-template-columns: auto auto minmax(0, 1fr) auto; gap: var(--s-3); }
  .al__num--up, .al__arrow { display: none; }
}
</style>
