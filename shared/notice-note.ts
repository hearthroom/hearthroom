/**
 * A reviewer's note squeezed onto one line for a notification. The bell, browser push and the
 * Discord DM all show it this way; the full note stays on My cards.
 */
export function noticeNote(value: unknown, max = 120): string {
  if (typeof value !== "string") return "";
  const chars = Array.from(value.replace(/\s+/g, " ").trim());
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}
