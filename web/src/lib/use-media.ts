import { onScopeDispose, ref, type Ref } from "vue";

/**
 * 一條 media query 現在成不成立，會跟著視窗變。
 * 版面在窄螢幕才有的機關（類型列收合）需要在程式裡知道「現在窄不窄」，不能只靠 CSS：
 * 收合鈕的文字與 aria-expanded 是 DOM 狀態，純 CSS 藏不掉它們。沒有 matchMedia 的環境一律當不成立。
 */
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false);
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return matches;
  const list = window.matchMedia(query);
  matches.value = list.matches;
  const update = (e: MediaQueryListEvent) => { matches.value = e.matches; };
  list.addEventListener("change", update);
  onScopeDispose(() => list.removeEventListener("change", update));
  return matches;
}
