import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { fetchReviewMe } from "./api";
import { useSession } from "./session";

/**
 * 「我是不是審核人」。
 *
 * 頁首要決定要不要畫「審核」那顆入口，而這件事只有本站知道（主站沒有審核人的概念）。
 * 登入後問一次就好；答案存著，登出就清掉。答錯的代價很低——入口畫了但佇列回 403，
 * 頁面會說「你不是審核人」。
 */
export const useReviewer = defineStore("reviewer", () => {
  const session = useSession();
  const reviewer = ref<boolean | null>(null);

  async function refresh(): Promise<boolean> {
    const token = await session.accessToken();
    if (!token) {
      reviewer.value = false;
      return false;
    }
    try {
      reviewer.value = (await fetchReviewMe(token)).reviewer;
    } catch {
      reviewer.value = false;
    }
    return reviewer.value;
  }

  watch(
    () => session.me?.accountNumId,
    (id) => {
      if (id) void refresh();
      else reviewer.value = null;
    },
    { immediate: true },
  );

  return { reviewer, refresh };
});
