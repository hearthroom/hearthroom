const INTERVAL_MS = 60_000;
const JITTER_MS = 4_000;

/** One deadline for timer, focus and visibility changes. A hidden tab schedules no work. */
export function startHeaderPolling(refresh: () => Promise<void>, interval = INTERVAL_MS + Math.floor(Math.random() * JITTER_MS)): () => void {
  let active = true;
  let running = false;
  let due = Date.now() + interval;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    clearTimeout(timer);
    if (!active || running || document.visibilityState === "hidden") return;
    timer = setTimeout(tick, Math.max(0, due - Date.now()));
  }

  async function tick() {
    if (!active || running || document.visibilityState === "hidden") return;
    due = Date.now() + interval;
    running = true;
    try {
      await refresh();
    } finally {
      running = false;
      schedule();
    }
  }

  window.addEventListener("focus", schedule);
  document.addEventListener("visibilitychange", schedule);
  schedule();
  return () => {
    active = false;
    clearTimeout(timer);
    window.removeEventListener("focus", schedule);
    document.removeEventListener("visibilitychange", schedule);
  };
}
