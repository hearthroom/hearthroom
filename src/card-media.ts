import { apiBaseOf, type ProviderId } from "./providers";
import { IMAGE_HOSTS } from "./shortcut";
import { HttpError, type Env } from "./types";

// Community sync keeps SaaS asset references without fetching the image bytes.
const REFERENCE_HOSTS = new Set([...IMAGE_HOSTS, "assets.lunatalk.ai", "assets.harperharbor.com"]);

export const MEDIA_FIELDS = [
  "avatar",
  "background",
  "backgroundLandscape",
] as const;
export type CardMedia = Partial<Record<(typeof MEDIA_FIELDS)[number], string>>;

/** Keep the original SaaS URL. Community sync never reads or writes image bytes. */
export function imageReference(
  env: Env,
  provider: ProviderId,
  raw: string
): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(409, "sync_image_reference_unavailable");
  }
  const base = new URL(apiBaseOf(env, provider));
  if (
    raw.length > 2048 ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443") ||
    (!REFERENCE_HOSTS.has(url.hostname) && url.origin !== base.origin)
  )
    throw new HttpError(409, "sync_image_reference_unavailable");
  return raw;
}
