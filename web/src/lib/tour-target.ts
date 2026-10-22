/** Select a rendered tour target when a responsive page has multiple copies. */
export function findTourTarget(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (el.closest('[inert], [hidden], [aria-hidden="true"]')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    let shown = true;
    for (let node: HTMLElement | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") {
        shown = false;
        break;
      }
    }
    if (shown) return el;
  }
  return null;
}
