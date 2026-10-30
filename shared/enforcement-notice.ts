/**
 * Platform account notices from HarperHarbor (account action and appeal result). The notice only
 * points at the appeal page on the HarperHarbor console; the bell, browser push and Discord DM
 * show a title and one line, never the details.
 *
 * The deadline reads exactly like the email Harbor sends (server/provider enforcement render.go):
 * "2026-11-29 23:59" in UTC+8, cut to the minute, plus a zone label in the reader's language.
 */
export const ENFORCEMENT_KINDS = ["enforcement_notice", "enforcement_result"] as const;
export type EnforcementKind = (typeof ENFORCEMENT_KINDS)[number];
export const isEnforcementKind = (kind: unknown): kind is EnforcementKind => ENFORCEMENT_KINDS.includes(kind as EnforcementKind);

/** "YYYY-MM-DD HH:mm" in UTC+8 without the zone label; empty when the value is not a date. */
export function enforcementDeadline(value: unknown): string {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}
