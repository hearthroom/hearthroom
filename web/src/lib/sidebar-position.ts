/**
 * CSS sticky offsets for the home rail. The browser scrolls on the compositor before scroll
 * events reach script, so a rail moved from the event trails the page by a frame and shakes.
 * Recompute only when the direction reverses or the geometry changes; pinning and following
 * then happen natively. `shift` is a spacer above the rail inside its host, which keeps a
 * long rail where it was when the direction flips.
 */
export type Direction = "down" | "up";
export interface StickyRail { shift: number; top: string; bottom: string }
interface Geometry { railTop: number; hostTop: number; height: number; parentHeight: number; top: number; bottom: number; viewport: number }
export function stickyRail(g: Geometry, direction: Direction): StickyRail {
  if (g.height <= g.bottom - g.top) return { shift: 0, top: `${g.top}px`, bottom: "auto" };
  const shift = Math.min(Math.max(0, g.railTop - g.hostTop), Math.max(0, g.parentHeight - g.height));
  // Down: follow the page until the rail's end reaches the bottom limit. Up: until its start reaches the top.
  return direction === "down"
    ? { shift, top: `${g.bottom - g.height}px`, bottom: "auto" }
    : { shift, top: "auto", bottom: `${g.viewport - g.top - g.height}px` };
}
