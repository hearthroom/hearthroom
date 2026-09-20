import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { fetchReviewMe } from "./api";
import { currentProvider } from "./provider";
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

  const pending = ref(0);
  const role = ref<"reviewer"|"manager"|"owner">("reviewer");
  let generation = 0;

  async function refresh(): Promise<boolean> {
    const requestGeneration = ++generation;
    const token = await session.accessToken();
    if (!token) {
      reviewer.value = false; pending.value = 0;
      return false;
    }
    try {
      const result = await fetchReviewMe(token);
      if (requestGeneration !== generation) return !!reviewer.value;
      reviewer.value = result.reviewer; pending.value = result.pending ?? 0; role.value = result.role ?? "reviewer";
    } catch {
      if (requestGeneration === generation) { reviewer.value = false; pending.value = 0; }
    }
    return !!reviewer.value;
  }

  watch(
    () => `${currentProvider()}:${session.me?.accountNumId ?? ""}`,
    (id) => {
      generation++; pending.value = 0; role.value = "reviewer";
      if (session.me) void refresh();
      else reviewer.value = null;
    },
    { immediate: true },
  );

  return { reviewer, pending, role, refresh };
});
