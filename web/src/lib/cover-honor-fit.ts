/** Two cover rows, preserving period order. The final visible label can ellipsize to leave room for +N. */
export function fitCoverHonors(widths: readonly number[], available: number, gap: number, prefix: number, plus: number) {
  const room = Math.max(0, available);
  let row = 1, used = prefix;
  for (const width of widths) {
    const w = Math.min(width, room);
    const next = used ? used + gap + w : w;
    if (next > room) { row++; used = w; } else used = next;
  }
  if (row <= 2) return { shown: widths.length, firstWidth: room, lastWidth: room };
  // Keep the prefix and first honor together; reserve the overflow count on row two.
  return { shown: Math.min(2, widths.length), firstWidth: Math.max(0, room - (prefix ? prefix + gap : 0)), lastWidth: Math.max(0, room - (widths.length > 2 ? gap + plus : 0)) };
}
