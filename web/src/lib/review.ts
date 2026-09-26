import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { fetchReviewMe, type FeaturedStatus } from "./api";
import { currentProvider, type ProviderId } from "./provider";
import { useSession } from "./session";

const LAYOUT_KEY = "hearthroom.header.review";
/** 上次開頁時頁首有沒有社群管理入口。只影響第一眼的排版，權限永遠以伺服器為準。 */
function rememberedLayout(): boolean {
  try { return localStorage.getItem(LAYOUT_KEY) === "1"; } catch { return false; }
}
function rememberLayout(on: boolean) {
  try { if (on) localStorage.setItem(LAYOUT_KEY, "1"); else localStorage.removeItem(LAYOUT_KEY); } catch { /* 存不了就每次等身分 */ }
}

/** 社群管理資格與待辦摘要；首頁、帳號選單和工作台共用。 */
export const useReviewer = defineStore("reviewer", () => {
  const session = useSession();
  const reviewer = ref<boolean | null>(null);

  const featured = ref<FeaturedStatus | null>(null);
  const featuredProvider = ref<ProviderId | null>(null);
  const pending = ref(0);
  const pendingReviews = ref(0);
  const pendingCases = ref(0);
  const role = ref<"reviewer"|"manager"|"owner">("reviewer");
  let generation = 0;

  function resetCounts() { featured.value = null; featuredProvider.value = null; pending.value = 0; pendingReviews.value = 0; pendingCases.value = 0; role.value = "reviewer"; }

  async function refresh(): Promise<boolean> {
    const requestGeneration = ++generation;
    const provider = currentProvider();
    try {
      const token = await session.accessToken();
      if (requestGeneration !== generation) return !!reviewer.value;
      if (provider !== currentProvider()) { reviewer.value = null; resetCounts(); return false; }
      if (!token) {
        reviewer.value = false; resetCounts();
        return false;
      }
      const result = await fetchReviewMe(token, provider);
      if (requestGeneration !== generation) return !!reviewer.value;
      if (provider !== currentProvider()) { reviewer.value = null; resetCounts(); return false; }
      reviewer.value = result.reviewer;
      if (result.reviewer) {
        featured.value = result.featured?.admin ? result.featured : null;
        featuredProvider.value = featured.value ? provider : null;
        pending.value = result.pending ?? 0;
        pendingReviews.value = result.reviews ?? 0;
        pendingCases.value = result.cases ?? 0;
        role.value = result.role ?? "reviewer";
      } else resetCounts();
    } catch {
      if (requestGeneration === generation && provider === currentProvider()) { reviewer.value = false; resetCounts(); }
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

  /**
   * 畫面上要不要留社群管理的入口。上面的查詢要等 token，比登入狀態晚到將近一秒；
   * 登入狀態本身就帶了同一個旗標，先照它排版，查詢回來再以它為準。
   * 不然管理員每次開頁，頁首都會在畫面出來之後才折成兩行，把整頁往下推。
   */
  const likely = computed(() => {
    if (reviewer.value !== null) return reviewer.value;
    if (session.me) return session.profile?.reviewer === true;
    // 登入狀態也還沒到（要將近一秒）：先照這個瀏覽器上次的樣子排版，到了再改
    return !session.ready && rememberedLayout();
  });
  // 記下這次的結果給下次開頁用；確定沒登入就清掉
  watch(() => [likely.value, session.ready, session.me] as const, ([value, ready, me]) => {
    if (reviewer.value !== null || me) rememberLayout(value);
    else if (ready) rememberLayout(false);
  }, { immediate: true });

  return { reviewer, likely, featured, featuredProvider, pending, pendingReviews, pendingCases, role, refresh };
});
