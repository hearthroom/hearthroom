import { IMAGE_KEY, imageUrl, LOCALES } from "./blog";
import { HttpError } from "./types";

export type Posters = Partial<Record<(typeof LOCALES)[number], { key: string; alt: string }>>;

/** A poster includes all visible words, so accessible copy must travel with the same image. */
export function cleanPosters(value: unknown): Posters {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "campaign_invalid", undefined, { field: "posters" });
  const out: Posters = {};
  for (const [locale, raw] of Object.entries(value)) {
    const p = raw as { key?: unknown; alt?: unknown } | null;
    if (!(LOCALES as readonly string[]).includes(locale) || !p || typeof p !== "object" || Array.isArray(p)
      || typeof p.key !== "string" || !IMAGE_KEY.test(p.key) || typeof p.alt !== "string" || !p.alt.trim() || p.alt.length > 1000) {
      throw new HttpError(400, "campaign_invalid", undefined, { field: "posters" });
    }
    out[locale as keyof Posters] = { key: p.key, alt: p.alt.trim() };
  }
  return out;
}

export const posterUrls = (posters: Posters) => Object.fromEntries(
  Object.entries(posters).map(([locale, p]) => [locale, { url: imageUrl(p.key)!, alt: p.alt }]),
);
