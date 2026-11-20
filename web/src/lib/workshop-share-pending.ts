import { computed, shallowRef } from "vue";
import { useSession } from "./session";
import { fetchNewPlayerShareCount } from "./workshop";
import { fetchMyCards } from "./api";

const pending = shallowRef<{ account: number; count: number; hasCards: boolean } | null>(null);
let loading: { account: number; task: Promise<void> } | null = null;

export function useWorkshopSharePending() {
  const session = useSession();
  const pendingCount = computed(() => pending.value?.account === session.me?.accountNumId ? pending.value?.count ?? 0 : 0);
  const hasWorkshopCards = computed(() => pending.value?.account === session.me?.accountNumId && pending.value?.hasCards === true);

  async function refreshPending() {
    const account = session.me?.accountNumId;
    if (!account) return;
    if (loading?.account === account) return loading.task;
    const task = (async () => {
      try {
        const token = await session.accessToken();
        if (!token || session.me?.accountNumId !== account) return;
        const previous = pending.value?.account === account ? pending.value : null;
        const [shares, cards] = await Promise.allSettled([
          fetchNewPlayerShareCount(token),
          previous?.hasCards ? Promise.resolve(true) : fetchMyCards(token, { provider: "harbor", pageSize: 1 }).then((page) => page.items.length > 0),
        ]);
        const count = shares.status === "fulfilled" ? shares.value.count : previous?.count ?? 0;
        const hasCards = cards.status === "fulfilled" ? cards.value : previous?.hasCards ?? false;
        if (session.me?.accountNumId === account) pending.value = { account, count, hasCards: hasCards || count > 0 };
      } catch {
        // The menu remains available if the unreviewed-item count is unavailable.
      }
    })();
    loading = { account, task };
    await task;
    if (loading?.task === task) loading = null;
  }

  return { pendingCount, hasWorkshopCards, refreshPending };
}
