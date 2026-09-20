import { apiBaseOf, type ProviderId } from "./providers";
import { IMAGE_HOSTS } from "./shortcut";
import { HttpError, type Env } from "./types";

// Current SaaS asset domains are references only, not additions to the image proxy allowlist.
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

/**
 * 讓目標站認得這個網址，回傳要寫進 document 的值——永遠是原網址。
 * LunaTalk 的 document 直接收外站網址；Harbor 要先登記成「引用資產」（只存網址、進圖片審核，
 * 不下載位元組），登記完 document 再送同一個網址就能反查成本人的資產。
 */
export async function registerImageReference(
  env: Env,
  provider: ProviderId,
  token: string,
  url: string,
  roleId?: string
): Promise<string> {
  if (provider === "lunatalk") return url;
  const r = await fetch(
    `${apiBaseOf(env, provider)}/open/v1/media/references`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, ...(roleId?{roleId}:{}) }),
      // Workers supports manual/follow only. Non-2xx is rejected below; never forward tokens to redirects.
    redirect: "manual",
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!r.ok) throw new HttpError(409, "sync_image_reference_unavailable");
  const body = (await r.json()) as { assetId?: string; url?: string };
  if (!body.assetId || body.url !== url)
    throw new HttpError(502, "sync_image_reference_unavailable");
  return url;
}
