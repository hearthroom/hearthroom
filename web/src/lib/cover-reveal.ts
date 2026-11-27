import { computed, ref } from "vue";

// Other surfaces can render the same card at the same time. Reuse the
// tab's reveal state, and require a new reveal if the art changes.
const epoch = ref(0);
const sessionRevealed = new Map<string, string>();

export function useCoverReveal(cardId: () => string, art: () => string, sensitive: () => boolean) {
  const concealed = computed(() => {
    if (!sensitive() || !art()) return false;
    const key = "hearthroom:cover-revealed:" + cardId();
    void epoch.value;
    try {
      return sessionStorage.getItem(key) !== art();
    } catch {
      return sessionRevealed.get(key) !== art();
    }
  });
  function reveal() {
    const key = "hearthroom:cover-revealed:" + cardId();
    try {
      sessionStorage.setItem(key, art());
    } catch {
      sessionRevealed.set(key, art());
    }
    epoch.value++;
  }
  return { concealed, reveal };
}
