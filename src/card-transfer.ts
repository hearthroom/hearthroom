import {
  imageReference,
  registerImageReference,
  MEDIA_FIELDS,
  type CardMedia,
} from "./card-media";
import { apiBaseOf, type ProviderId } from "./providers";
import { HttpError, type Env } from "./types";
export interface TransferCard {
  name: string;
  summary: string;
  description: string;
  greeting: string;
  language: string;
  media?: CardMedia;
  fields?: Record<string, unknown>;
}
export interface TransferRead {
  card: TransferCard;
  public: boolean;
  pending?: boolean;
}
async function call(
  env: Env,
  p: ProviderId,
  token: string,
  path: string,
  body?: unknown
) {
  const r = await fetch(`${apiBaseOf(env, p)}/open/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "HearthRoom/1.0",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok)
    throw new HttpError(
      r.status === 401 || r.status === 403 ? 401 : 502,
      "sync_upstream_failed"
    );
  if (r.status === 204 || r.status === 202) return {};
  return (await r.json()) as Record<string, any>;
}
const text = (v: unknown) => (typeof v === "string" ? v : "");
async function read(
  env: Env,
  p: ProviderId,
  token: string,
  id: string,
  owner: number
): Promise<TransferRead> {
  const r = await call(
    env,
    p,
    token,
    `/role/detail?roleId=${encodeURIComponent(id)}`
  );
  if (Number(r.accountNumId) !== owner)
    throw new HttpError(403, "sync_not_owner");
  if (!("roleDetailDesc" in r))
    throw new HttpError(409, "sync_private_content_unavailable");
  if (p === "lunatalk" || p === "harbor") {
    const books = await call(
      env,
      p,
      token,
      `/worldbook/bindings?roleId=${encodeURIComponent(id)}`
    );
    const asset = await call(
      env,
      p,
      token,
      `/role/author-asset?roleId=${encodeURIComponent(id)}`
    );
    if (
      books.bindings?.length ||
      asset.rules?.length ||
      asset.mountTrigger ||
      asset.pageMode === "sandbox"
    )
      throw new HttpError(409, "sync_unsupported_content");
  }
  // Transfer the common text and image contract. Reject richer fields that cannot be preserved.
  for (const key of [
    "roleNameEn",
    "roleNameJa",
    "roleNameKo",
    "roleDescEn",
    "roleDescJa",
    "roleDescKo",
    "roleWelcomeAlternates",
    "rolePrologue",
    "roleSpeech",
    "cardMeta",
  ]) {
    const v = r[key];
    if (
      (typeof v === "string" && v.trim() && v !== "[]" && v !== "{}") ||
      (Array.isArray(v) && v.length) || (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length)
    )
      throw new HttpError(409, "sync_unsupported_content");
  }
  if (
    (Array.isArray(r.alternates) && r.alternates.length) ||
    (Array.isArray(r.prologue) && r.prologue.length)
  )
    throw new HttpError(409, "sync_unsupported_content");
  const fields: Record<string, unknown> = {};
  for (const key of ["customInstructions", "roleOutputContract", "userName", "nickname", "roleSex", "roleType"]) fields[key] = text(r[key]);
  const list = (v: unknown): unknown[] => {
    if (v == null || v === '') return [];
    try { const parsed = typeof v === 'string' ? JSON.parse(v) : v; if (Array.isArray(parsed)) return parsed; } catch {}
    throw new HttpError(409,'sync_unsupported_content');
  };
  fields.roleTag = list(r.roleTag).map(String);
  fields.talkExample = list(r.talkExample).map((v:any) => {
    if (!v || typeof v.roleType !== 'string' || typeof v.content !== 'string') throw new HttpError(409,'sync_unsupported_content');
    return {roleType:v.roleType,content:v.content};
  });
  const media: CardMedia = {};
  for (const field of MEDIA_FIELDS) {
    const key = `role${field[0].toUpperCase()}${field.slice(1)}`;
    if (text(r[key])) media[field] = imageReference(env, p, text(r[key]));
  }
  return {
    card: {
      fields,
      ...(Object.keys(media).length ? { media } : {}),
      name: text(r.roleName),
      summary: text(r.roleDesc),
      description: text(r.roleDetailDesc),
      greeting: text(r.roleWelcome),
      language: text(r.language) || "zh",
    },
    public: r.roleVisibility === "public",
    pending: r.reviewStatus === "pending",
  };
}
async function create(
  env: Env,
  p: ProviderId,
  token: string,
  c: TransferCard,
  key: string
): Promise<string> {
  const r = await call(
    env,
    p,
    token,
    p === "harbor" ? "/roles" : "/role",
    p === "harbor"
      ? {
          origin_locale: c.language,
          name: c.name,
          summary: c.summary,
          description: c.description,
          greeting: c.greeting,
          origin: "hearthroom",
        }
      : {
          roleName: c.name,
          language: c.language,
          origin: "hearthroom",
          idempotencyKey: key,
        }
  );
  const id = p === "harbor" ? r.id : r.roleId;
  if (typeof id !== "string" || !id)
    throw new HttpError(502, "sync_create_unconfirmed");
  return id;
}
async function update(
  env: Env,
  p: ProviderId,
  token: string,
  id: string,
  c: TransferCard,
  checkpoint?: () => Promise<void>
) {
  const images: Record<string, string> = {};
  for (const field of MEDIA_FIELDS)
    images[field] = c.media?.[field]
      ? await registerImageReference(env, p, token, c.media[field]!)
      : "";
  if (p === "harbor") {
    await call(
      env,
      p,
      token,
      `/roles/${encodeURIComponent(id)}/assets`,
      images
    );
    await checkpoint?.();
    await call(env, p, token, `/roles/${encodeURIComponent(id)}/locales`, {
      locale: c.language,
      name: c.name,
      summary: c.summary,
      description: c.description,
      greeting: c.greeting,
      source: "original",
    });
  } else {
    await call(env, p, token, `/role/${encodeURIComponent(id)}/document`, {
      fields: {
        roleName: c.name,
        roleDesc: c.summary,
        roleDetailDesc: c.description,
        roleWelcome: c.greeting,
        roleAvatar: images.avatar,
        roleBackground: images.background,
        roleBackgroundLandscape: images.backgroundLandscape,
      },
    });
  }
  if (c.fields) {
    await call(env, p, token, `/role/${encodeURIComponent(id)}/document`, {fields:c.fields});
  }
  await checkpoint?.();
}
async function publish(
  env: Env,
  p: ProviderId,
  token: string,
  id: string
) {
  await call(
    env,
    p,
    token,
    p === "harbor"
      ? `/roles/${encodeURIComponent(id)}/submit`
      : `/role/${encodeURIComponent(id)}/publish`,
    p === "harbor"
      ? {}
      : {
          userConfirmed: true,
          confirmationSummary:
            "Publish my synchronized HearthRoom character card.",
        }
  );
}
export const transfers = { read, create, update, publish };
