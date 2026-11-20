import { computed, shallowRef } from "vue";
import { useSession } from "./session";
import { fetchNewPlayerShareCount } from "./workshop";

const pending = shallowRef<{ account: number; count: number } | null>(null);
let loading: { account: number; task: Promise<void> } | null = null;

export function useWorkshopSharePending() {
  const session = useSession();
  const pendingCount = computed(() => pending.value?.account === session.me?.accountNumId ? pending.value?.count ?? 0 : 0);

  async function refreshPending() {
    const account = session.me?.accountNumId;
    if (!account) return;
    if (loading?.account === account) return loading.task;
    const task = (async () => {
      try {
        const token = await session.accessToken();
        if (!token || session.me?.accountNumId !== account) return;
        const { count } = await fetchNewPlayerShareCount(token);
        if (session.me?.accountNumId === account) pending.value = { account, count };
      } catch {
        // The menu remains available if the unreviewed-item count is unavailable.
      }
    })();
    loading = { account, task };
    await task;
    if (loading?.task === task) loading = null;
  }

  return { pendingCount, refreshPending };
}
