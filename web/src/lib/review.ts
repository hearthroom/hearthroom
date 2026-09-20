import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { fetchReviewMe } from "./api";
import { currentProvider } from "./provider";
import { useSession } from "./session";

/** 社群管理資格與待辦摘要；首頁、帳號選單和工作台共用。 */
export const useReviewer = defineStore("reviewer", () => {
  const session = useSession();
  const reviewer = ref<boolean | null>(null);

  const pending = ref(0);
  const pendingReviews = ref(0);
  const pendingCases = ref(0);
  const role = ref<"reviewer"|"manager"|"owner">("reviewer");
  let generation = 0;

  function resetCounts() { pending.value = 0; pendingReviews.value = 0; pendingCases.value = 0; role.value = "reviewer"; }

  async function refresh(): Promise<boolean> {
    const requestGeneration = ++generation;
    const token = await session.accessToken();
    if (requestGeneration !== generation) return !!reviewer.value;
    if (!token) {
      reviewer.value = false; resetCounts();
      return false;
    }
    try {
      const result = await fetchReviewMe(token);
      if (requestGeneration !== generation) return !!reviewer.value;
      reviewer.value = result.reviewer;
      if (result.reviewer) {
        pending.value = result.pending ?? 0;
        pendingReviews.value = result.reviews ?? 0;
        pendingCases.value = result.cases ?? 0;
        role.value = result.role ?? "reviewer";
      } else resetCounts();
    } catch {
      if (requestGeneration === generation) { reviewer.value = false; resetCounts(); }
    }
    return !!reviewer.value;
  }

  watch(
    () => `${currentProvider()}:${session.me?.accountNumId ?? ""}`,
    () => {
      generation++; resetCounts();
      if (session.me) void refresh();
      else reviewer.value = null;
    },
    { immediate: true },
  );

  return { reviewer, pending, pendingReviews, pendingCases, role, refresh };
});
