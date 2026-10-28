/** Position within the normal-flow rail host; no nested scrollport or direction jump. */
export interface SidebarPosition { top: number; height: number; scrollY: number; offset: number }
interface Geometry { scrollY: number; naturalTop: number; height: number; parentHeight: number; top: number; bottom: number }
export function sidebarPosition(g: Geometry, previous?: SidebarPosition): SidebarPosition {
  const following = previous ? previous.top - (g.scrollY - previous.scrollY) : g.naturalTop;
  const desired = g.height <= g.bottom - g.top
    ? Math.max(g.naturalTop, g.top)
    : Math.min(Math.max(following, g.bottom - g.height), Math.max(g.top, g.naturalTop));
  const offset = Math.min(Math.max(0, desired - g.naturalTop), Math.max(0, g.parentHeight - g.height));
  return { top: g.naturalTop + offset, height: g.height, scrollY: g.scrollY, offset };
}
