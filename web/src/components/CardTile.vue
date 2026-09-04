<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { compact, hueFrom } from "@/lib/format";
import { zoneLabel } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import type { CommunityCard } from "@/lib/types";

const props = defineProps<{
  card: CommunityCard;
  rank?: number;
  showTrending?: boolean;
  showZone?: boolean;
  /** 首屏那幾張不要懶載入：它們就是最大內容繪製 */
  eager?: boolean;
}>();

// 沒封面的卡用角色名決定色相：同一張卡永遠同一個顏色，一排佔位卡也彼此可辨。
const { lp } = useLocalePath();
const hue = computed(() => hueFrom(props.card.name));
const initial = computed(() => [...props.card.name][0] ?? "?");
const href = computed(() => lp(`/cards/${props.card.roleId}`));
/* 圖掛了（上游換圖、刪圖）就當沒圖：退回單字佔位，不留一個破圖 */
const broken = ref(false);
watch(() => props.card.avatarUrl, () => { broken.value = false; });
const hasArt = computed(() => !!props.card.avatarUrl && !broken.value);

/** 卡片上只放兩個標籤，多的用 +N 帶過——標籤是給人掃的，不是給人讀的。 */
const TAGS_SHOWN = 2;
const tags = computed(() => props.card.tags.slice(0, TAGS_SHOWN));
const moreTags = computed(() => Math.max(0, props.card.tags.length - TAGS_SHOWN));
</script>

<template>
  <!--
    整張卡都可以點，但標籤與作者各自是連結——所以外層不是 <a>（連結不能套連結）。
    名字的連結用 ::after 撐滿整張卡，標籤與作者疊在它上面。
  -->
  <article class="card rise">
    <div class="card__art">
      <img
        v-if="hasArt"
        :src="card.avatarUrl!"
        alt=""
        :loading="eager ? 'eager' : 'lazy'"
        :fetchpriority="eager ? 'high' : undefined"
        @error="broken = true"
      />
      <div
        v-else
        class="card__void"
        :style="{ background: `linear-gradient(160deg, hsl(${hue} 45% 78%), hsl(${(hue + 40) % 360} 40% 62%))` }"
      >
        <span>{{ initial }}</span>
      </div>
      <!-- 名次是個小徽章，前三名用慣例的金銀銅；不搶立繪的戲 -->
      <span v-if="rank" class="medal card__rank" :class="rank <= 3 && `medal--${rank}`" role="img" :aria-label="$t('board.rank', { n: rank })">{{ rank }}</span>
    </div>

    <div class="card__body">
      <h2 class="card__name"><RouterLink :to="href" class="card__link">{{ card.name }}</RouterLink></h2>
      <p class="card__hook">{{ card.summary || $t("card.noSummary") }}</p>

      <ul v-if="tags.length" class="card__tags">
        <li v-for="tag in tags" :key="tag">
          <RouterLink :to="{ path: lp('/'), query: { tag } }" class="tag">{{ tag }}</RouterLink>
        </li>
        <li v-if="moreTags" class="tag tag--more">+{{ moreTags }}</li>
      </ul>

      <div class="card__meta">
        <span v-if="showZone" class="card__by">{{ zoneLabel(card.zone) }}</span>
        <RouterLink v-else :to="lp(`/authors/${card.author.accountNumId}`)" class="card__by card__by--link">
          <img v-if="card.author.avatar" :src="card.author.avatar" alt="" class="card__face" />
          <span class="card__author">{{ card.author.name }}</span>
        </RouterLink>
        <span class="card__num" :class="{ 'card__num--up': showTrending && card.trending > 0 }" :title="$t('card.talkCount', { n: compact(card.talkNum) })">
          <span class="sr-only">{{ $t("card.talkCount", { n: compact(card.talkNum) }) }}</span>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 3.5h10a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7.5L4.5 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V5A1.5 1.5 0 0 1 3 3.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
          </svg>
          <span aria-hidden="true">{{ showTrending && card.trending > 0 ? `+${compact(card.trending)}` : compact(card.talkNum) }}</span>
        </span>
      </div>
    </div>
  </article>
</template>

<style scoped>
/* min-width: 0 不能省：grid item 預設 min-width: auto，名字一長就把整欄撐開 */
.card {
  position: relative;
  display: flex; flex-direction: column; min-width: 0;
  background: var(--surface);
  border-radius: var(--r-md);
  /* 髮絲線用 box-shadow 而不是 border：不佔版面、圓角處也不會出現 1px 的斷差 */
  box-shadow: 0 0 0 1px var(--line), var(--shadow-sm);
  overflow: hidden;
  transition: box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.card:hover { box-shadow: 0 0 0 1px var(--line-strong), var(--shadow-md); transform: translateY(-3px); }

.card__art { position: relative; aspect-ratio: 3 / 4; background: var(--surface-2); overflow: hidden; }
.card__art img { width: 100%; height: 100%; object-fit: cover; transition: transform var(--dur-slow) var(--ease); }
.card:hover .card__art img { transform: scale(1.04); }
/* 圖片內緣一道極淡的線：淺色立繪的邊緣才不會跟白卡糊在一起 */
.card__art::after { content: ""; position: absolute; inset: 0; box-shadow: inset 0 0 0 1px rgba(16, 16, 24, 0.05); pointer-events: none; }
.card__void { display: grid; place-items: center; width: 100%; height: 100%; }
.card__void span { font-size: 40px; font-weight: 600; color: rgba(255, 255, 255, 0.9); }

.card__rank { position: absolute; top: 8px; left: 8px; z-index: 1; }

.card__body { display: grid; gap: 5px; padding: 10px 12px 11px; }
.card__name { font-size: 15px; font-weight: 600; line-height: 1.35; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 名字的連結撐滿整張卡；沒有 z-index 的東西都在它底下，標籤與作者有 z-index 所以在它上面 */
.card__link::after { content: ""; position: absolute; inset: 0; }
.card__link:hover { color: var(--accent-text); }
.card__hook {
  font-size: 12.5px; line-height: 1.5; color: var(--text-2);
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  /* 固定兩行高：一張沒簡介的卡不該讓整排的底線參差 */
  min-height: calc(12.5px * 1.5 * 2);
}

.card__tags { display: flex; gap: 4px; margin: 1px 0 0; padding: 0; list-style: none; overflow: hidden; }
.tag {
  position: relative; z-index: 1;
  display: inline-flex; align-items: center; height: 20px; padding: 0 7px;
  border-radius: 6px;
  font-size: 11px; font-weight: 500; color: var(--text-2);
  background: var(--surface-2);
  max-width: 9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
a.tag:hover { background: var(--accent-soft); color: var(--accent-text); }
.tag--more { color: var(--text-3); padding: 0 5px; }

.card__meta {
  display: flex; align-items: center; justify-content: space-between; gap: var(--s-2);
  margin-top: 3px; padding-top: 8px;
  box-shadow: 0 -1px 0 var(--line);
  font-size: 12px; color: var(--text-3);
}
.card__by { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.card__by--link { position: relative; z-index: 1; transition: color var(--dur) var(--ease); }
.card__by--link:hover { color: var(--accent-text); }
.card__face { width: 16px; height: 16px; border-radius: var(--r-pill); object-fit: cover; flex: none; }
.card__author { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__num { display: inline-flex; align-items: center; gap: 3px; flex: none; font-variant-numeric: tabular-nums; }
.card__num svg { width: 13px; height: 13px; }
.card__num--up { color: var(--accent-text); font-weight: 600; }
</style>
