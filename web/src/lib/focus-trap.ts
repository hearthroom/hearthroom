/**
 * 對話框裡的 Tab 只在框內繞：最後一個往下回到第一個，第一個往上回到最後一個。
 * 停用的控件跳過；一組單選鈕只算一站（選中的那顆，沒選就第一顆），跟瀏覽器自己的 Tab 順序一致。
 * 在 keydown 裡呼叫；不是 Tab 或框不在就什麼都不做。
 */
const FOCUSABLE = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex='0']";

export function wrapTab(e: KeyboardEvent, box: HTMLElement | null, selector = FOCUSABLE): void {
  if (e.key !== "Tab" || !box) return;
  const items = [...box.querySelectorAll<HTMLElement>(selector)].filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name) return true;
    const group = [...box.querySelectorAll<HTMLInputElement>("input[type=radio]")].filter((r) => r.name === el.name);
    return (group.find((r) => r.checked) ?? group[0]) === el;
  });
  if (!items.length) return;
  const first = items[0]!, last = items[items.length - 1]!;
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
