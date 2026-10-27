export interface SidebarRect { left: number; right: number; top: number; bottom: number }
export interface SidebarRange { top: number; bottom: number; blocked?: true }

/** Keep the normal top edge where possible; use the lower clear area only for an extreme high drag. */
export function sidebarClearance(bounds: SidebarRect, obstacles: SidebarRect[], gap = 12, minimum = 60): SidebarRange {
  const hits = obstacles.filter(r => r.left < bounds.right && r.right > bounds.left && r.top < bounds.bottom && r.bottom > bounds.top);
  if (!hits.length) return { top: bounds.top, bottom: bounds.bottom };
  const upper = Math.min(...hits.map(r => r.top)) - gap;
  if (upper - bounds.top >= minimum) return { top: bounds.top, bottom: upper };
  const lower = Math.max(...hits.map(r => r.bottom)) + gap;
  if (bounds.bottom - lower >= minimum) return { top: lower, bottom: bounds.bottom };
  // There is no complete operation row on either side. Preserve the user's
  // draggable pet and the original region rather than invent a negative height.
  return { top: bounds.top, bottom: bounds.bottom, blocked: true };
}
