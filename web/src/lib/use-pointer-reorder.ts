/**
 * 清單拖曳排序（預設編輯器的條目，owner 2026-10-30）。不靠套件：只用 pointer events。
 *
 * 版面約定：每一區是一個 `[data-drop-side]` 元素，裡面每一列是 `[data-drag-id]`。拖曳中
 * 依指標的 y 算落點——落在哪一區，就找那一區第一個中線在指標下面的列，放在它前面；都沒有就放到那一區最後面。
 *
 * 桌機（滑鼠）按住把手直接拖；手機與觸控筆要長按把手，長按前手指先移動就當作捲動、不開始拖。
 * 拖到捲動容器上下緣會自動捲。按 Esc 取消。鍵盤與輔助科技用選單裡的「上移／下移」，把手本身不進 Tab 順序。
 */
import { onBeforeUnmount, ref, type Ref } from "vue";
import type { DropTarget } from "@/lib/st-preset";

const LONG_PRESS_MS = 300;
const SLOP_PX = 8;
const EDGE_PX = 56;
const MAX_SPEED = 18;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let e = el?.parentElement ?? null; e; e = e.parentElement) {
    const oy = getComputedStyle(e).overflowY;
    if ((oy === "auto" || oy === "scroll") && e.scrollHeight > e.clientHeight) return e;
  }
  return null;
}

export function usePointerReorder(opts: { list: Ref<HTMLElement | null>; enabled: () => boolean; onDrop: (id: string, target: DropTarget) => void }) {
  const dragging = ref("");
  const target = ref<DropTarget | null>(null);
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let lastY = 0;
  let startX = 0;
  let startY = 0;
  let pending = "";
  let scroller: HTMLElement | null = null;

  function compute(y: number) {
    const groups = [...(opts.list.value?.querySelectorAll<HTMLElement>("[data-drop-side]") ?? [])];
    for (const [i, g] of groups.entries()) {
      if (y >= g.getBoundingClientRect().bottom && i < groups.length - 1) continue;
      const side = g.dataset.dropSide as "before" | "after";
      const rows = [...g.querySelectorAll<HTMLElement>("[data-drag-id]")].filter((r) => r.dataset.dragId !== dragging.value);
      const next = rows.find((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 > y; });
      target.value = next ? { beforeId: next.dataset.dragId! } : { side };
      return;
    }
    target.value = null;
  }

  function autoscroll() {
    frame = 0;
    if (!dragging.value) return;
    const top = scroller ? scroller.getBoundingClientRect().top : 0;
    const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
    const dy = lastY < top + EDGE_PX ? -Math.ceil(((top + EDGE_PX - lastY) / EDGE_PX) * MAX_SPEED)
      : lastY > bottom - EDGE_PX ? Math.ceil(((lastY - (bottom - EDGE_PX)) / EDGE_PX) * MAX_SPEED) : 0;
    if (dy) {
      if (scroller) scroller.scrollTop += dy; else window.scrollBy(0, dy);
      compute(lastY);
      frame = requestAnimationFrame(autoscroll);
    }
  }

  function onMove(e: PointerEvent) {
    if (!dragging.value) {
      // 還在等長按：手指先動了就是要捲動
      if (pending && Math.hypot(e.clientX - startX, e.clientY - startY) > SLOP_PX) cancelPress();
      return;
    }
    e.preventDefault();
    lastY = e.clientY;
    compute(lastY);
    if (!frame) frame = requestAnimationFrame(autoscroll);
  }

  function onUp() {
    const id = dragging.value, t = target.value;
    stop();
    if (id && t) opts.onDrop(id, t);
  }

  function onKey(e: KeyboardEvent) { if (e.key === "Escape" && dragging.value) { e.preventDefault(); stop(); } }

  function begin(id: string, y: number, touch: boolean) {
    pending = "";
    dragging.value = id;
    lastY = y;
    scroller = scrollParent(opts.list.value);
    if (touch) navigator.vibrate?.(10);
    compute(y);
  }

  function cancelPress() { clearTimeout(pressTimer); pending = ""; detach(); }

  function attach() {
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("keydown", onKey);
  }
  function detach() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", stop);
    window.removeEventListener("keydown", onKey);
  }

  function stop() {
    clearTimeout(pressTimer);
    cancelAnimationFrame(frame);
    frame = 0;
    pending = "";
    dragging.value = "";
    target.value = null;
    detach();
  }

  function start(e: PointerEvent, id: string) {
    if (!opts.enabled() || dragging.value || pending) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX = e.clientX; startY = e.clientY;
    attach();
    if (e.pointerType === "mouse") { e.preventDefault(); begin(id, e.clientY, false); return; }
    pending = id;
    pressTimer = setTimeout(() => { if (pending === id) begin(id, startY, true); }, LONG_PRESS_MS);
  }

  onBeforeUnmount(stop);
  return { dragging, target, start };
}
