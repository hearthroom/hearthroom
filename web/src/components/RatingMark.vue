<script setup lang="ts">
/**
 * 分級標示。
 *
 * mark：官方分級標識圖。遊戲軟體分級管理辦法第 11 條：沒有包裝的，標識放在說明或起始頁旁、
 * 限制級不小於 50×50 像素、其他不小於 45×45，所以這裡是 56 與 48。旁邊列第 12 條的情節名稱。
 * chip：小地方放不下圖時用文字標級別（同一條的但書），顏色取標識的底色。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Rating, Topic } from "../../../shared/content-rating";
import { descriptorList, markSrc, ratingName } from "@/lib/rating";

const props = withDefaults(defineProps<{ rating: Rating; descriptors?: Topic[]; variant?: "mark" | "chip" }>(), { descriptors: () => [], variant: "mark" });
const { locale, t } = useI18n();
const name = computed(() => ratingName(props.rating, String(locale.value)));
const contents = computed(() => descriptorList(props.descriptors, String(locale.value)));
</script>

<template>
  <span v-if="variant === 'chip'" class="rating-chip" :class="`rating-chip--${rating}`">{{ name }}</span>
  <span v-else class="rating-mark" data-rating-mark>
    <img :src="markSrc(rating)" :width="rating === 'R' ? 56 : 48" :height="rating === 'R' ? 56 : 48" :alt="name" class="rating-mark__img" />
    <span class="rating-mark__text">
      <strong>{{ name }}</strong>
      <span v-if="contents" class="subtle">{{ t("rating.contains", { list: contents }) }}</span>
    </span>
  </span>
</template>

<style scoped>
.rating-mark { display: inline-flex; align-items: center; gap: var(--s-3); }
.rating-mark__img { flex: none; display: block; border-radius: 2px; }
.rating-mark__text { display: grid; gap: 2px; font-size: 13px; line-height: 1.4; }
/* 標識底色（官方 CMYK 值換算）；文字一律白，黃底那一級用深字才讀得清楚 */
.rating-chip {
  display: inline-flex; align-items: center; height: 20px; padding: 0 8px;
  border-radius: 999px; font-size: 12px; font-weight: 600; line-height: 1; color: #fff; white-space: nowrap;
}
.rating-chip--G { background: #59b031; }
.rating-chip--P { background: #009fe3; }
.rating-chip--PG12 { background: #f7c600; color: #3a2e00; }
.rating-chip--PG15 { background: #ec7a08; }
.rating-chip--R { background: #e5141e; }
</style>
