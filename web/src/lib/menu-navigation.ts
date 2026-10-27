/** Move through the currently visible rows, including an expandable summary. */
export function navigateMenu(event: KeyboardEvent, panel: HTMLElement): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const rows = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary')].filter(el => {
    if (el.closest('details:not([open])') && el.tagName !== "SUMMARY") return false;
    return !el.closest('[hidden]');
  });
  if (!rows.length) return;
  const current = rows.indexOf(document.activeElement as HTMLElement);
  const index = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : event.key === "ArrowDown" ? (current + 1) % rows.length : (current - 1 + rows.length) % rows.length;
  event.preventDefault(); rows[index]?.focus();
}
