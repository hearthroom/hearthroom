import { computed } from "vue";
import { useRoute } from "vue-router";
import { localeOf, withLocale } from "../router";

/**
 * 站內連結的語言前綴。
 *
 * 每個 RouterLink 都要用 lp()——漏掉一個，使用者點下去就掉回預設語言，
 * 而且不會報錯，只會默默換語言。
 */
export function useLocalePath() {
  const route = useRoute();
  const locale = computed(() => localeOf(route));
  return {
    locale,
    lp: (path: string) => withLocale(path, locale.value),
  };
}
