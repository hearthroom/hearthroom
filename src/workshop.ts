import { applyWorkshopPublication,applyWorkshopUnpublication,isBaseUnlisted } from "./workshop-publication";
import { readWorkshopPolicy, upsertWorkshopPolicyProjection } from "./workshop-policy";
import { applyWorkshopOwnerProjection } from './workshop-owner-projection';
import type { Context } from "hono";
import { isRating, type Rating } from "../shared/content-rating";
import { isAdult, getCard, type CardRow } from "./cards";
import { guestAdult, guestAllowsNsfw, siteSessionReader } from "./account-auth";
import { bearerOf } from "./community-admin";
import {
  memberNsfw,
  providerOf,
  requireMember,
  resolveMember,
  viewerCountryRegion,
  type Member,
} from "./members";
import { bumpOp } from "./ops-metrics";
import type { ProviderId } from "./providers";
import { HttpError, pickLocale, type Env, type Localized } from "./types";
import {
  toEpochMs,
  workshopUpstream,
  type PlayerDisplayProjection,
  type WorkshopKind,
  type WorkshopOutboxEvent,
} from "./workshop-gateway";

type Ctx = Pick<Context<{ Bindings: Env }>, "env" | "req" | "executionCtx">;

export interface WorkshopRow {
  id: string;
  card_id: number;
  provider: string;
  work_id: string;
  source_role_id: string;
  author_num_id: number;
  author_member_id: string | null;
  name: string;
  summary: string;
  readme: string;
  cover_url: string;
  kinds: string;
  rating: string | null;
  rating_descriptors: string;
  version_no: number;
  approved_release_id: string | null;
  content_hash: string;
  resident_chars: number;
  lore_count: number;
  rule_count: number;
  opening_count: number;
  install_count: number;
  moderation_state: "draft" | "pending" | "approved" | "rejected" | "revoked" | "deleted";
  owner_state: "visible" | "returned" | "hidden_by_owner";
  owner_reason: string | null;
  owner_acted_at: number | null;
  owner_action_generation: number;
  protected_join_cutoff_seq: number;
  appeal_state: "pending" | "upheld" | "restored" | "revoked" | null;
  first_published_at: number | null;
  published_at: number | null;
  created_at: number;
  updated_at: number;
  comment_revision: string;
}

const WORKSHOP_PAGE_SIZE = 20;

export function normalizeWireOwnerState(state: string | null | undefined): "visible" | "returned" | "hidden" {
  if (state === "returned") return "returned";
  if (state === "hidden" || state === "hidden_by_owner") return "hidden";
  return "visible";
}

export function normalizeDbOwnerState(state: string | null | undefined): "visible" | "returned" | "hidden_by_owner" {
  if (state === "returned") return "returned";
  if (state === "hidden" || state === "hidden_by_owner") return "hidden_by_owner";
  return "visible";
}





export async function optionalViewer(c: Ctx): Promise<Member | null> {
  if (bearerOf(c)) {
    try {
      return await requireMember(c);
    } catch {
      return null;
    }
  }
  try {
    if (!c.req.url || !c.req.method) return null;
    const provider = providerOf(c);
    const reader = await siteSessionReader(c, provider);
    if (!reader) return null;
    return {
      id: reader.memberId,
      provider,
      externalId: reader.accountNumId,
      accountClass: reader.accountClass ?? "normal",
      testGeneration: reader.testGeneration,
    };
  } catch {
    return null;
  }
}

export async function viewerContentGate(
  c: Ctx,
  member: Member | null,
): Promise<{ allowAdult: boolean; countryRegion: string | null }> {
  if (member) {
    const nsfw = await memberNsfw(c.env.DB, member.id);
    return { allowAdult: nsfw.showNsfw, countryRegion: nsfw.countryRegion };
  }
  const persistedRegion = await viewerCountryRegion(c).catch(() => null);
  const cfCountry = (c.req.raw as Request & { cf?: { country?: string } })?.cf?.country ?? null;
  const countryRegion = persistedRegion ?? cfCountry;
  if (countryRegion === "CN") return { allowAdult: false, countryRegion: "CN" };
  return { allowAdult: guestAllowsNsfw(await guestAdult(c)), countryRegion };
}

export async function resolveWorkIdForCard(db: D1Database, card: CardRow): Promise<string> {
  const byPolicy = await db
    .prepare("SELECT work_id FROM workshop_policies WHERE card_id = ? ORDER BY updated_at DESC LIMIT 1")
    .bind(Number(card.id))
    .first<{ work_id: string }>();
  if (byPolicy?.work_id) return byPolicy.work_id;
  const byWork = await db
    .prepare("SELECT id FROM works WHERE source_provider = ? AND source_role_id = ?")
    .bind(card.provider, card.source_role_id)
    .first<{ id: string }>();
  return byWork?.id ?? `work:${card.id}`;
}

/**
 * The community card a Provider workshop event or receipt belongs to. Provider's workId is
 * a stable workshop group id and need not equal any community works.id, so the card is
 * resolved by its source role. Only events without a source role (older payloads) fall
 * back to the work id: first this projection's own policy rows, then works.id.
 */
export async function resolveCardForWork(
  db: D1Database,
  provider: ProviderId,
  workId?: string,
  sourceRoleId?: string,
): Promise<{ card: CardRow; workId: string } | null> {
  if (sourceRoleId) {
    const byRole = await db
      .prepare("SELECT id FROM cards WHERE provider = ? AND (source_role_id = ? OR approved_hosted_role_id = ?)")
      .bind(provider, sourceRoleId, sourceRoleId)
      .first<{ id: number }>();
    if (!byRole) return null;
    const card = await getCard(db, String(byRole.id));
    if (!card) return null;
    return { card, workId: workId || (await resolveWorkIdForCard(db, card)) };
  }
  if (!workId) return null;
  const byPolicy = await db
    .prepare("SELECT card_id FROM workshop_policies WHERE provider = ? AND work_id = ? LIMIT 1")
    .bind(provider, workId)
    .first<{ card_id: number }>();
  if (byPolicy) {
    const card = await getCard(db, String(byPolicy.card_id));
    if (card) return { card, workId };
  }
  const byWork = await db
    .prepare("SELECT id, source_provider, source_role_id FROM works WHERE id = ?")
    .bind(workId)
    .first<{ id: string; source_provider: string; source_role_id: string }>();
  if (byWork) {
    const byRole = await db
      .prepare("SELECT id FROM cards WHERE provider = ? AND source_role_id = ?")
      .bind(byWork.source_provider, byWork.source_role_id)
      .first<{ id: number }>();
    if (byRole) {
      const card = await getCard(db, String(byRole.id));
      if (card) return { card, workId: byWork.id };
    }
  }
  return null;
}

export async function findMemberIdByExternal(
  db: D1Database,
  provider: string,
  externalId: number,
): Promise<string | null> {
  if (!Number.isSafeInteger(externalId) || externalId <= 0) return null;
  const ext = String(externalId);
  const row = await db
    .prepare(
      `SELECT COALESCE(
        (SELECT owner_member_id FROM member_connections WHERE provider = ? AND external_id = ?),
        (SELECT member_id FROM member_identities WHERE provider = ? AND external_id = ?)
      ) AS member_id`,
    )
    .bind(provider, ext, provider, ext)
    .first<{ member_id: string | null }>();
  return row?.member_id ?? null;
}

export async function memberOwnsExternal(
  db: D1Database,
  member: Member | null,
  provider: string,
  externalId: number,
): Promise<boolean> {
  if (!member || !Number.isSafeInteger(externalId) || externalId <= 0) return false;
  const ownerId = await findMemberIdByExternal(db, provider, externalId);
  if (ownerId) return ownerId === member.id;
  return member.provider === provider && member.externalId === externalId;
}



function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function cardAvatarOf(card: CardRow): string {
  return card.background_url || card.landscape_url || card.share_image_url || "";
}

export function cardPlayRoleId(card: CardRow): string {
  return card.approved_hosted_role_id || card.source_role_id;
}

interface AuthorInfo {
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

type WorkshopListingRow = Pick<WorkshopRow,
  "id" | "card_id" | "provider" | "author_num_id" | "name" | "summary" | "readme" | "cover_url" |
  "kinds" | "rating" | "version_no" | "resident_chars" | "lore_count" | "rule_count" | "opening_count" |
  "install_count" | "moderation_state" | "owner_state" | "first_published_at" | "published_at" | "created_at" | "updated_at"
> & AuthorInfo;

function formatExtensionSummary(
  row: WorkshopListingRow,
  card: CardRow,
  opts: { includeOwnerState?: boolean; joined?: boolean } = {},
) {
  const cardAdult = isAdult(card);
  const wsAdult = row.rating === "R";
  const handle = row.handle ?? null;
  const authorName = row.display_name || handle || `#${row.author_num_id}`;
  return {
    id: row.id,
 kind:row.provider===card.provider&&row.author_num_id===card.author_num_id?"dlc":"lorebook",
 loreCount:row.lore_count,
    cardId: String(row.card_id),
    name: row.name,
    summary: row.summary,
    coverUrl: row.cover_url,
    author: {
      handle,
      name: authorName,
      ...(row.avatar_url ? { avatar: row.avatar_url } : {}),
    },
    joinCount: row.install_count,
    // 擴充作者就是原卡作者：第三方擴充的介面與開場暫停時，原卡作者自己的照常，畫面靠它決定要不要說明
    byCardAuthor: row.provider === card.provider && Number(row.author_num_id) === Number(card.author_num_id),
    version: row.version_no,
    updatedAt: row.published_at ?? row.updated_at,
    kinds: parseJsonArray<WorkshopKind>(row.kinds),
    rating: (isRating(row.rating) ? row.rating : null) as Rating | null,
    adult: wsAdult && !cardAdult,
    ...(opts.joined !== undefined ? { joined: opts.joined } : {}),
    ...(opts.includeOwnerState ? { ownerState: normalizeWireOwnerState(row.owner_state) } : {}),
  };
}

async function checkProviderViewerAccess(
  env: Env,
  provider: ProviderId,
  workshopIds: string[],
  token: string | null,
): Promise<Map<string, { joined: boolean; accessible: boolean }>> {
  const map = new Map<string, { joined: boolean; accessible: boolean }>();
  if (!token || workshopIds.length === 0) return map;
  try {
    const res = await workshopUpstream.state(env, { workshopIds }, token, provider);
    for (const item of res.items ?? []) {
      map.set(item.workshopId, {
        joined: Boolean(item.viewerJoined),
        accessible: Boolean(item.viewerAccessible),
      });
    }
  } catch {
    // Fail closed when upstream state cannot be read: hidden/returned extensions stay hidden.
  }
  return map;
}

function isPlayerWorkshop(row: Pick<WorkshopRow, "provider" | "author_num_id">, card: Pick<CardRow, "provider" | "author_num_id">): boolean {
  return row.provider !== card.provider || row.author_num_id !== card.author_num_id;
}

async function displayedPlayerWorkshops(env: Env, provider: ProviderId, ids: string[], workId?: string) {
  const displayed = new Map<string, PlayerDisplayProjection | null>();
  const requests = workId ? [ids] : Array.from({ length: Math.ceil(ids.length / 50) }, (_, index) => ids.slice(index * 50, index * 50 + 50));
  for (const batch of requests) {
    try {
      const result = await workshopUpstream.playerDisplay(env, provider, batch, workId);
      for (const id of result.displayedIds) displayed.set(id, null);
      for (const item of result.items ?? []) displayed.set(item.id, item);
    } catch {
      // The cached projection alone cannot authorize a public read.
      continue;
    }
  }
  return displayed;
}

function refreshPlayerRow<T extends WorkshopListingRow>(row: T, current: PlayerDisplayProjection | null | undefined): T {
  if (!current) return row;
  return {
    ...row, name: current.name, summary: current.summary, readme: current.readme, cover_url: current.coverUrl,
    rating: current.rating, version_no: current.version, owner_state: "visible",
    kinds: JSON.stringify(current.loreCount ? ["lore"] : []), lore_count: current.loreCount,
    resident_chars: current.residentChars, install_count: current.joinCount,
    published_at: current.publishedAt, updated_at: current.publishedAt,
  };
}

function newPlayerRow(card: CardRow, current: PlayerDisplayProjection): WorkshopListingRow {
  return refreshPlayerRow({
    id: current.id, card_id: Number(card.id), provider: card.provider, author_num_id: current.authorNumber,
    name: "", summary: "", readme: "", cover_url: "", kinds: "[]", rating: null,
    version_no: 0, resident_chars: 0, lore_count: 0, rule_count: 0, opening_count: 0, install_count: 0,
    moderation_state: "approved", owner_state: "visible", first_published_at: current.publishedAt,
    published_at: null, created_at: current.publishedAt, updated_at: current.publishedAt,
    handle: null, display_name: null, avatar_url: null,
  }, current);
}

export async function listCardWorkshops(
  c: Ctx,
  cardIdParam: string,
  query: { sort?: string; page?: number; lang?: string },
) {
  const card = await getCard(c.env.DB, cardIdParam);
  if (!card || card.status !== "approved" || card.public_blocked) {
    throw new HttpError(404, "not_found");
  }
  const member = await optionalViewer(c);
  const gate = await viewerContentGate(c, member);
  if (isAdult(card) && (gate.countryRegion === "CN" || !gate.allowAdult)) {
    throw new HttpError(gate.countryRegion === "CN" ? 404 : 403, gate.countryRegion === "CN" ? "not_found" : "adult_content");
  }

  const {enabled:allowNew}=await readWorkshopPolicy(c.env.DB,Number(card.id));
  const viewerIsOwner=await memberOwnsExternal(c.env.DB,member,card.provider,card.author_num_id);
  if(!allowNew) return {tabVisible:false,allowNew:false,viewerIsOwner,total:0,page:1,hasMore:false,items:[]};

  const rows = (
    await c.env.DB.prepare(
      `SELECT w.*, m.handle, m.display_name, m.avatar_url
       FROM workshops w
       LEFT JOIN members m ON m.id = COALESCE(
         w.author_member_id,
         (SELECT owner_member_id FROM member_connections mc WHERE mc.provider = w.provider AND mc.external_id = CAST(w.author_num_id AS TEXT)),
         (SELECT member_id FROM member_identities mi WHERE mi.provider = w.provider AND mi.external_id = CAST(w.author_num_id AS TEXT))
       )
       WHERE w.card_id = ? AND w.moderation_state = 'approved'`,
    )
      .bind(Number(card.id))
      .all<WorkshopRow & AuthorInfo>()
  ).results;

  const playerIds = rows.filter((r) => isPlayerWorkshop(r, card)).map((r) => r.id);
  const workId = await resolveWorkIdForCard(c.env.DB, card);
  const displayed = await displayedPlayerWorkshops(c.env, card.provider as ProviderId, playerIds, workId);
  const cachedIDs = new Set(rows.map((row) => row.id));
  const currentRows: WorkshopListingRow[] = rows.map((row) => refreshPlayerRow(row, displayed.get(row.id)));
  for (const [id, item] of displayed) {
    if (item && item.workId === workId && !cachedIDs.has(id)) currentRows.push(newPlayerRow(card, item));
  }
  // Gate on the current rating, including a rating changed after the cached publication.
  const ratingFiltered = currentRows.filter((r) => !(r.rating === "R" && (gate.countryRegion === "CN" || !gate.allowAdult)));
  const nonVisibleIds = ratingFiltered.filter((r) => !isPlayerWorkshop(r, card) && r.owner_state !== "visible").map((r) => r.id);
  const token = bearerOf(c);
  const accessMap = await checkProviderViewerAccess(c.env, card.provider as ProviderId, nonVisibleIds, token);

  const visibleToViewer = ratingFiltered.filter((r) => {
    if (isPlayerWorkshop(r, card)) return displayed.has(r.id);
    if (r.owner_state === "visible") return true;
    if (viewerIsOwner) return true;
    return accessMap.get(r.id)?.accessible === true;
  });
  const firstPublished = (row: WorkshopListingRow) => row.first_published_at ?? row.published_at ?? row.created_at;
  visibleToViewer.sort((a, b) => Number(isPlayerWorkshop(a, card)) - Number(isPlayerWorkshop(b, card)) ||
    (query.sort === "new" ? 0 : b.install_count - a.install_count) || firstPublished(b) - firstPublished(a) || a.id.localeCompare(b.id));

  const total = visibleToViewer.length;
  const tabVisible = allowNew;
  const page = Math.max(1, Math.trunc(query.page || 1));
  const start = (page - 1) * WORKSHOP_PAGE_SIZE;
  const slice = visibleToViewer.slice(start, start + WORKSHOP_PAGE_SIZE);

  return {
    tabVisible,
    allowNew,
    viewerIsOwner,
    total,
    page,
    hasMore: start + WORKSHOP_PAGE_SIZE < total,
    items: slice.map((r) =>
      formatExtensionSummary(r, card, {
        includeOwnerState: viewerIsOwner,
        joined: accessMap.has(r.id) ? accessMap.get(r.id)!.joined : undefined,
      }),
    ),
  };
}

export async function batchGetWorkshops(c: Ctx, ids: string[]) {
  const cleanIds = [...new Set(ids.map((s) => s.trim()).filter(Boolean))].slice(0, 50);
  if (cleanIds.length === 0) return { items: [] };
  const member = await optionalViewer(c);
  const gate = await viewerContentGate(c, member);
  const token = bearerOf(c);

  const placeholders = cleanIds.map(() => "?").join(",");
  const rows = (
    await c.env.DB.prepare(
      `SELECT w.*, m.handle, m.display_name, m.avatar_url, c.author_num_id AS card_author_num_id, c.provider AS card_provider
       FROM workshops w
       JOIN cards c ON c.id = w.card_id
       LEFT JOIN members m ON m.id = COALESCE(
         w.author_member_id,
         (SELECT owner_member_id FROM member_connections mc WHERE mc.provider = w.provider AND mc.external_id = CAST(w.author_num_id AS TEXT)),
         (SELECT member_id FROM member_identities mi WHERE mi.provider = w.provider AND mi.external_id = CAST(w.author_num_id AS TEXT))
       )
       WHERE w.id IN (${placeholders}) AND w.moderation_state = 'approved'`,
    )
      .bind(...cleanIds)
      .all<WorkshopRow & AuthorInfo & { card_author_num_id: number; card_provider: string }>()
  ).results;

  const playerRows = rows.filter((r) => isPlayerWorkshop(r, { author_num_id: r.card_author_num_id, provider: r.card_provider }));
  const playerIds = new Set(playerRows.map((r) => r.id));
  const nonVisibleIds = rows.filter((r) => !playerIds.has(r.id) && r.owner_state !== "visible").map((r) => r.id);
  const accessMap = await checkProviderViewerAccess(c.env, "harbor", nonVisibleIds, token);
  const displayedByProvider = await Promise.all(
    [...new Set(playerRows.map((r) => r.provider))].map((provider) =>
      displayedPlayerWorkshops(c.env, provider as ProviderId, playerRows.filter((r) => r.provider === provider).map((r) => r.id)),
    ),
  );
  const displayed = new Map(displayedByProvider.flatMap((items) => [...items]));

  const out = [];
  for (const id of cleanIds) {
    const cached = rows.find((x) => x.id === id);
    if (!cached) continue;
    const r = refreshPlayerRow(cached, displayed.get(id));
    if (r.rating === "R" && (gate.countryRegion === "CN" || !gate.allowAdult)) continue;
    const card = await getCard(c.env.DB, String(r.card_id));
    if (!card || card.status !== "approved" || card.public_blocked) continue;
    if(!(await readWorkshopPolicy(c.env.DB,Number(card.id))).enabled)continue;
    if (isAdult(card) && (gate.countryRegion === "CN" || !gate.allowAdult)) continue;
    const viewerIsOwner = await memberOwnsExternal(c.env.DB, member, card.provider, card.author_num_id);
    if (isPlayerWorkshop(r, card)) {
      if (!displayed.has(r.id)) continue;
    } else if (r.owner_state !== "visible" && !viewerIsOwner && !accessMap.get(r.id)?.accessible) continue;
    out.push(
      formatExtensionSummary(r, card, {
        includeOwnerState: viewerIsOwner,
        joined: accessMap.has(r.id) ? accessMap.get(r.id)!.joined : undefined,
      }),
    );
  }
  return { items: out };
}

export async function getWorkshopDetail(c: Ctx, workshopId: string, lang: string) {
  const cached = await c.env.DB.prepare(
    `SELECT w.*, m.handle, m.display_name, m.avatar_url
     FROM workshops w
     LEFT JOIN members m ON m.id = COALESCE(
       w.author_member_id,
       (SELECT owner_member_id FROM member_connections mc WHERE mc.provider = w.provider AND mc.external_id = CAST(w.author_num_id AS TEXT)),
       (SELECT member_id FROM member_identities mi WHERE mi.provider = w.provider AND mi.external_id = CAST(w.author_num_id AS TEXT))
     )
     WHERE w.id = ?`,
  )
    .bind(workshopId)
    .first<WorkshopRow & AuthorInfo>();
  const inferred = cached ? undefined : (await displayedPlayerWorkshops(c.env, "harbor", [workshopId])).get(workshopId);
  const card = cached ? await getCard(c.env.DB, String(cached.card_id)) :
    inferred ? (await resolveCardForWork(c.env.DB, "harbor", inferred.workId, inferred.sourceRoleId))?.card : null;
  if (!card || card.status !== "approved" || card.public_blocked) {
    throw new HttpError(404, "not_found");
  }

  if(!(await readWorkshopPolicy(c.env.DB,Number(card.id))).enabled)throw new HttpError(404,"not_found");
  const playerWorkshop = !cached || isPlayerWorkshop(cached, card);
  const projected = !cached ? inferred : playerWorkshop
    ? (await displayedPlayerWorkshops(c.env, card.provider as ProviderId, [cached.id])).get(cached.id) : undefined;
  if (playerWorkshop && projected === undefined) {
    throw new HttpError(404, "not_found");
  }
  const row = cached ? refreshPlayerRow(cached, projected) : newPlayerRow(card, inferred!);
  const member = await optionalViewer(c);
  const gate = await viewerContentGate(c, member);
  if ((isAdult(card) || row.rating === "R") && gate.countryRegion === "CN") {
    throw new HttpError(404, "not_found");
  }
  if ((isAdult(card) || row.rating === "R") && !gate.allowAdult) {
    throw new HttpError(403, "adult_content");
  }
  const viewerIsOwner = await memberOwnsExternal(c.env.DB, member, card.provider, card.author_num_id);

  if (row.moderation_state === "revoked" || row.moderation_state === "deleted") {
    if (row.version_no <= 0) throw new HttpError(404, "not_found");
    return {
      ...formatExtensionSummary(row, card, { includeOwnerState: viewerIsOwner }),
      readme: "",
      commentCount: 0,
      card: {
        id: String(card.id),
        num: Number(card.id),
        name: pickLocale(JSON.parse(card.names || "{}") as Localized, lang),
        avatarUrl: cardAvatarOf(card),
        roleId: cardPlayRoleId(card),
        provider: card.provider,
      },
      contents: { loreCount: row.lore_count, ruleCount: row.rule_count, openingCount: row.opening_count },
      residentChars: row.resident_chars,
      availability: "removed" as const,
    };
  }

  if (row.moderation_state !== "approved" || row.version_no <= 0) {
    throw new HttpError(404, "not_found");
  }

  let availability: "open" | "hidden" = "open";
  let joined: boolean | undefined;
  if (!playerWorkshop && row.owner_state !== "visible") {
    const access = await checkProviderViewerAccess(c.env, card.provider as ProviderId, [row.id], bearerOf(c));
    const viewerAccess = access.get(row.id);
    availability = viewerAccess?.accessible ? "open" : "hidden";
    if (viewerAccess) joined = viewerAccess.joined;
  }

  const commentRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM comments WHERE workshop_id = ? AND root_id IS NULL AND status = 'visible' AND deleted_at IS NULL",
  )
    .bind(row.id)
    .first<{ n: number }>();

  return {
    ...formatExtensionSummary(row, card, { includeOwnerState: viewerIsOwner, joined }),
    readme: row.readme,
    commentCount: commentRow?.n ?? 0,
    card: {
      id: String(card.id),
      num: Number(card.id),
      name: pickLocale(JSON.parse(card.names || "{}") as Localized, lang),
      avatarUrl: cardAvatarOf(card),
      roleId: cardPlayRoleId(card),
      provider: card.provider,
    },
    contents: { loreCount: row.lore_count, ruleCount: row.rule_count, openingCount: row.opening_count },
    residentChars: row.resident_chars,
    availability,
  };
}

export async function listWorkshopVersions(c: Ctx, workshopId: string, pageParam = 1) {
  // Reuse detail reachability & adult gate so hidden/revoked/adult rules match detail 1:1.
  const detail = await getWorkshopDetail(c, workshopId, "zh-Hant");
  if (detail.availability === "removed") throw new HttpError(404, "not_found");
  const page = Math.max(1, Math.trunc(pageParam));
  const limit = 20;
  const offset = (page - 1) * limit;
  const rows = (
    await c.env.DB.prepare(
      `SELECT version_no, published_at, update_note
       FROM workshop_versions
       WHERE workshop_id = ?
       ORDER BY version_no DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(workshopId, limit + 1, offset)
      .all<{ version_no: number; published_at: number; update_note: string }>()
  ).results;
  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit).map((r) => ({
      version: r.version_no,
      publishedAt: r.published_at,
      note: r.update_note,
    })),
    hasMore,
  };
}

/**
 * 留言目標驗證：核准上架、基底卡公開可達、過成人與地區門；
 * 原作者 hidden/returned 時僅放行舊加入玩家、擴充製作者本人與原卡作者。
 */
export async function commentWorkshopAt(
  c: Ctx,
  workshopId: string,
): Promise<{
  workshop: WorkshopRow;
  card: CardRow;
  creatorMemberId: string | null;
}> {
  const row = await c.env.DB.prepare("SELECT * FROM workshops WHERE id = ?")
    .bind(workshopId)
    .first<WorkshopRow>();
  if (!row || row.moderation_state !== "approved" || row.version_no <= 0) {
    throw new HttpError(404, "not_found");
  }
  const card = await getCard(c.env.DB, String(row.card_id));
  if (!card || card.status !== "approved" || card.public_blocked) {
    throw new HttpError(404, "not_found");
  }
  if(!(await readWorkshopPolicy(c.env.DB,Number(card.id))).enabled)throw new HttpError(404,"not_found");
  const playerWorkshop = isPlayerWorkshop(row, card);
  const current = playerWorkshop ? (await displayedPlayerWorkshops(c.env, card.provider as ProviderId, [row.id])).get(row.id) : undefined;
  if (playerWorkshop && current === undefined) {
    throw new HttpError(404, "not_found");
  }
  const member = await optionalViewer(c);
  const gate = await viewerContentGate(c, member);
  const adult = isAdult(card) || (current?.rating ?? row.rating) === "R";
  if (adult && gate.countryRegion === "CN") {
    throw new HttpError(404, "not_found");
  }
  if (adult && !gate.allowAdult) {
    throw new HttpError(403, "adult_content");
  }
  const creatorMemberId =
    row.author_member_id ?? (await findMemberIdByExternal(c.env.DB, row.provider, row.author_num_id));

  if (!playerWorkshop && row.owner_state !== "visible") {
    const isCardOwner = await memberOwnsExternal(c.env.DB, member, card.provider, card.author_num_id);
    const isCreator =
      Boolean(member && creatorMemberId && member.id === creatorMemberId) ||
      (await memberOwnsExternal(c.env.DB, member, row.provider, row.author_num_id));
    if (!isCardOwner && !isCreator) {
      const access = await checkProviderViewerAccess(c.env, card.provider as ProviderId, [row.id], bearerOf(c));
      if (!access.get(row.id)?.accessible) {
        throw new HttpError(404, "not_found");
      }
    }
  }
  return { workshop: row, card, creatorMemberId };
}

export async function listMyWorkshops(c: Ctx, lang: string) {
  const member = await requireMember(c);
  const token = bearerOf(c);
  if (!token) throw new HttpError(401, "missing bearer token");
  const upstreamMine = await workshopUpstream.mine(c.env, token, member.provider);
  const handleRow = await c.env.DB.prepare("SELECT handle, display_name, avatar_url FROM members WHERE id = ?")
    .bind(member.id)
    .first<AuthorInfo>();

  const items = [];
  for (const item of upstreamMine.items ?? []) {
    const resolved = await resolveCardForWork(c.env.DB, member.provider, item.workId, item.sourceRoleId);
    const card = resolved?.card;
    const pubVer=Number(item.publishedVersion??0);
    const status=item.status??(pubVer>0?(item.changedSincePublish?'live_changed':'live'):'draft');
    const cardNum = card ? Number(card.id) : 0;
    const cardName = card ? pickLocale(JSON.parse(card.names || "{}") as Localized, lang) : item.cardName || "";
    const updatedAt = toEpochMs(item.publishedAt) ?? toEpochMs(item.updatedAt, Date.now())!;
    items.push({
      id: item.workshopId,
      kind:item.kind,
      loreCount:item.loreCount??0,
      workshopClosed:item.workshopClosed===true,
      playerShareState:item.playerShareState,
      cardId: card ? String(card.id) : "",
      name: item.name,
      summary: item.summary,
      coverUrl: item.coverUrl,
      author: {
        handle: handleRow?.handle ?? null,
        name: handleRow?.display_name || handleRow?.handle || `#${member.externalId}`,
        ...(handleRow?.avatar_url ? { avatar: handleRow.avatar_url } : {}),
      },
      joinCount: item.joinCount ?? 0,
      version: pubVer,
      updatedAt,
      kinds: item.kinds ?? [],
      rating: (isRating(item.rating) ? item.rating : null) as Rating | null,
      adult: item.rating === "R" && !(card && isAdult(card)),
      card: {
        id: card ? String(card.id) : "",
        num: cardNum,
        name: cardName,
        roleId: card ? cardPlayRoleId(card) : item.sourceRoleId,
      },
      status,
      ownerState: normalizeWireOwnerState(item.ownerState),
      ownerReason: item.ownerReason ?? null,
    });
  }
  return { items };
}

export async function listMyWorkshopCards(c: Ctx, q: string, lang: string) {
  const member = await requireMember(c);
  const gate = await viewerContentGate(c, member);
  const trimmed = q.trim();
  const like = trimmed ? `%${trimmed}%` : null;
  const rows = (
    await c.env.DB.prepare(
      `SELECT c.*,
              COALESCE(
                (SELECT IIF(p.consent_version=2,p.allow_new,0) FROM workshop_policies p WHERE p.card_id = c.id ORDER BY p.updated_at DESC LIMIT 1),
                0
              ) AS allow_new,
              COALESCE(
                (SELECT mc.owner_member_id FROM member_connections mc WHERE mc.provider = c.provider AND mc.external_id = CAST(c.author_num_id AS TEXT)),
                (SELECT mi.member_id FROM member_identities mi WHERE mi.provider = c.provider AND mi.external_id = CAST(c.author_num_id AS TEXT))
              ) AS owner_member_id
       FROM cards c
       WHERE c.status = 'approved' AND c.public_blocked = 0
         AND (?1 IS NULL OR c.names LIKE ?1 OR CAST(c.id AS TEXT) = ?2)
       ORDER BY c.heat DESC, c.hot_score DESC
       LIMIT 30`,
    )
      .bind(like, trimmed)
      .all<CardRow & { allow_new: number; owner_member_id: string | null }>()
  ).results;

  const filtered = rows.filter((r) => !(isAdult(r) && (gate.countryRegion === "CN" || !gate.allowAdult)));
  return {
    items: filtered.map((r) => ({
      cardId: String(r.id),
      num: Number(r.id),
      name: pickLocale(JSON.parse(r.names || "{}") as Localized, lang),
      avatarUrl: cardAvatarOf(r),
      author: { name: r.community_name || r.author_name },
      roleId: cardPlayRoleId(r),
      allowNew: r.allow_new === 1,
      viewerIsOwner: r.owner_member_id
        ? r.owner_member_id === member.id
        : member.provider === r.provider && member.externalId === r.author_num_id,
    })),
  };
}





export async function applyWorkshopEvents(env: Env, events: WorkshopOutboxEvent[]): Promise<{ applied: number; rejected:number }> {
  let applied = 0,rejected=0;
  const now = Date.now();
  for (const ev of events) {
    const provider: ProviderId = ev.provider ?? "harbor";
    const p = (ev.payload && typeof ev.payload === "object" ? ev.payload : {}) as Record<string, unknown>;
    const workId =
      (typeof ev.workId === "string" && ev.workId) || (typeof p.workId === "string" ? p.workId : undefined);
    const sourceRoleId =
      (typeof ev.sourceRoleId === "string" && ev.sourceRoleId) ||
      (typeof p.sourceRoleId === "string" ? p.sourceRoleId : undefined);
    const workshopId =
      (typeof ev.workshopId === "string" && ev.workshopId) ||
      (typeof p.workshopId === "string" ? p.workshopId : undefined);
    const allowNewRaw = ev.allowNew !== undefined ? ev.allowNew : p.allowNew;
    const revisionRaw =
      ev.revision ??
      (typeof p.revision === "number"
        ? p.revision
        : typeof p.policyRevision === "number"
          ? p.policyRevision
          : undefined);
    const interestedNosRaw = Array.isArray(ev.interestedPublicNos)
      ? ev.interestedPublicNos
      : Array.isArray(p.interestedPublicNos)
        ? (p.interestedPublicNos as number[])
        : [];
    const actionRaw = (ev.action ?? (typeof p.action === "string" ? p.action : undefined)) as
      | "return"
      | "hide"
      | "restore"
      | "revoke"
      | undefined;
    const ownerStateRaw = ev.ownerState ?? (typeof p.ownerState === "string" ? p.ownerState : undefined);
    const modStateRaw = ev.moderationState ?? (typeof p.moderationState === "string" ? p.moderationState : undefined);
    const reasonRaw =
      ev.reason !== undefined
        ? ev.reason
        : typeof p.reason === "string" || p.reason === null
          ? (p.reason as string | null)
          : typeof p.appealReason === "string"
            ? p.appealReason
            : undefined;
    const ownerGenRaw =
      ev.ownerGeneration ??
      ev.generation ??
      (typeof p.ownerGeneration === "number"
        ? p.ownerGeneration
        : typeof p.generation === "number"
          ? p.generation
          : undefined);
    const cutoffSeqRaw =
      ev.protectedJoinCutoffSeq ??
      (typeof p.protectedJoinCutoffSeq === "number" ? p.protectedJoinCutoffSeq : undefined);
    const authorPubNoRaw =
      ev.authorPublicNo ??
      ev.creatorNumId ??
      (typeof p.authorPublicNo === "number"
        ? p.authorPublicNo
        : typeof p.creatorNumId === "number"
          ? p.creatorNumId
          : undefined);
    const appealIdRaw = ev.appealId ?? (typeof p.appealId === "string" ? p.appealId : undefined);
    const ownerStateSnapRaw =
      ev.ownerStateSnapshot ?? (typeof p.ownerStateSnapshot === "string" ? p.ownerStateSnapshot : undefined);
    const ownerReasonSnapRaw =
      ev.ownerReasonSnapshot !== undefined
        ? ev.ownerReasonSnapshot
        : typeof p.ownerReasonSnapshot === "string" || p.ownerReasonSnapshot === null
          ? (p.ownerReasonSnapshot as string | null)
          : undefined;
    const joinCountRaw =
      typeof ev.joinCount === "number"
        ? ev.joinCount
        : typeof p.joinCount === "number"
          ? p.joinCount
          : typeof p.installCount === "number"
            ? p.installCount
            : undefined;
    const decisionRaw = ev.decision ?? (typeof p.decision === "string" ? p.decision : undefined);
    const versionRaw = ev.version ?? (typeof p.version === "number" ? p.version : undefined);
    const createdAtMs = toEpochMs(ev.createdAt ?? p.createdAt, now) ?? now;

    const eventKey =
      ev.eventKey ??
      (typeof ev.seq === "number"
        ? `${provider}:seq:${ev.seq}`
        : `${provider}:${ev.kind}:${workshopId ?? workId ?? ""}:${revisionRaw ?? ownerGenRaw ?? now}`);

    const seen = await env.DB.prepare("SELECT 1 FROM workshop_sync_events WHERE event_key = ?")
      .bind(eventKey)
      .first();
    if (seen) continue;

    if(ev.kind==='release_published'||ev.kind==='release_unpublished') {
     try {
      if(ev.kind==="release_published") {
      if(p.policyVersion!==2||!p.publication||typeof p.publication!=="object") throw new HttpError(502,"invalid_publication");
      const publication=p.publication as import("./workshop-gateway").WorkshopPublicationReceipt;
      if(publication.workshopId!==workshopId||publication.workId!==workId)throw new HttpError(502,"invalid_publication");
      await applyWorkshopPublication(env,provider,publication);
    } else if(ev.kind==='release_unpublished') {
     const publication=p.publication as import('./workshop-publication').WorkshopUnpublishReceipt;
     if(p.policyVersion!==2||!publication||publication.workshopId!==workshopId||publication.workId!==workId)throw new HttpError(502,'invalid_publication');
     await applyWorkshopUnpublication(env,provider,publication);

      }
     } catch(error) {
      // The base card is not listed here yet: nothing to project, nothing wrong with the
      // receipt. Acknowledge it as deferred, separate from quarantined receipts.
      if(isBaseUnlisted(error)){
       await env.DB.prepare('INSERT OR IGNORE INTO workshop_sync_events(event_key,kind,created_at) VALUES(?,?,?)').bind(eventKey,'deferred',now).run();
       await bumpOp(env.DB,'workshop','sync','deferred');
       continue;
      }
      // Only deterministic receipt validation is quarantined. Storage failures
      // still stop/ retry the batch, since a durable decision is not yet saved.
      if(!(error instanceof HttpError&&error.status===502&&error.message==='invalid_publication'))throw error;
      await env.DB.batch([
       env.DB.prepare('INSERT OR IGNORE INTO workshop_sync_rejections(event_key,provider,event_kind,reason,event_payload,created_at) VALUES(?,?,?,?,?,?)').bind(eventKey,provider,ev.kind,'invalid_publication',JSON.stringify(ev),now),
       env.DB.prepare('INSERT OR IGNORE INTO workshop_sync_events(event_key,kind,created_at) VALUES(?,?,?)').bind(eventKey,'rejected',now),
      ]);
      await bumpOp(env.DB,'workshop','sync','rejected');
      rejected++;continue;
     }
    } else if (ev.kind === "policy_changed" || ev.kind === "policy_saved") {
      // Unknown/legacy events cannot grant v2 consent or advance its revision.
      const revision=Number(revisionRaw);
      if(p.policyVersion===2&&Number.isSafeInteger(revision)&&revision>0&&allowNewRaw!==undefined) {
        // A card without a community row has nothing to project onto; the event is
        // still acknowledged (one outbox cursor), and each hosting submission re-reads
        // Provider's current state instead (projectCurrentWorkshopState).
        const resolved=await resolveCardForWork(env.DB,provider,workId,sourceRoleId);
        if(resolved) {
          await upsertWorkshopPolicyProjection(env.DB,provider,workId||resolved.workId,Number(resolved.card.id),allowNewRaw===true||allowNewRaw===1,revision,now);
        }
      }
    } else if (ev.kind === "owner_action" && workshopId && (actionRaw === "hide" || actionRaw === "restore")) {
      const gen=Number(ownerGenRaw);
      if(Number.isSafeInteger(gen)&&gen>0)await applyWorkshopOwnerProjection(env.DB,provider,workshopId,actionRaw,gen,cutoffSeqRaw);
    } else if ((ev.kind === "install_count_changed" || ev.kind === "install_count") && workshopId && typeof joinCountRaw === "number") {
      await env.DB.prepare("UPDATE workshops SET install_count = ?, updated_at = ? WHERE id = ?")
        .bind(Math.max(0, Math.trunc(joinCountRaw)), now, workshopId)
        .run();
    } else if ((ev.kind === "workshop_deleted" || ev.kind === "moderated") && workshopId) {
      if (ev.kind === "workshop_deleted") {
        await env.DB.prepare("UPDATE workshops SET moderation_state = 'deleted', updated_at = ? WHERE id = ?")
          .bind(now, workshopId)
          .run();
      } else if (actionRaw === "revoke" || modStateRaw === "revoked") {
        await env.DB.prepare("UPDATE workshops SET moderation_state='revoked',updated_at=? WHERE id=?").bind(now,workshopId).run();
      } else if (actionRaw === "restore" || modStateRaw === "approved") {
        await env.DB.prepare(
          `UPDATE workshops
           SET moderation_state = IIF(approved_release_id IS NOT NULL, 'approved', 'draft'), updated_at = ?
           WHERE id = ? AND moderation_state = 'revoked'`,
        )
          .bind(now, workshopId)
          .run();
      }
    }

    await env.DB.prepare("INSERT OR IGNORE INTO workshop_sync_events(event_key, kind, created_at) VALUES (?, ?, ?)")
      .bind(eventKey, ev.kind, now)
      .run();
    applied++;
  }
  await bumpOp(env.DB, "workshop", "sync", "success");
  return { applied,rejected };
}

/**
 * Events pulled per minute-cron run. Each event costs a handful of D1 queries (dedupe,
 * card lookups, projection write). Measured in test/workshop-outbox-cron.test.ts: a full
 * batch of unresolvable policy events is about 250 queries, and a whole minute run (rank
 * phase + badge backfill + a full batch of listed publications) is about 520, inside the
 * Workers Paid limit of 1000 D1 queries per invocation. A backlog of a few hundred events
 * clears in under ten minutes.
 */
export const WORKSHOP_OUTBOX_MINUTE_BATCH = 50;

export async function drainProviderWorkshopOutbox(
  env: Env,
  provider: ProviderId = "harbor",
  limit = 100,
): Promise<{ drained: number; applied: number }> {
  const cursor = await env.DB.prepare("SELECT last_seq FROM workshop_outbox_cursor WHERE provider = ?")
    .bind(provider)
    .first<{ last_seq: number }>();
  const afterSeq = cursor?.last_seq ?? 0;
  const batch = await workshopUpstream.pullOutbox(env, afterSeq, limit, provider);
  const events = batch.events ?? [];
  if (events.length === 0) return { drained: 0, applied: 0 };
  const res = await applyWorkshopEvents(env, events);
  const maxSeq = events.reduce((m, e) => (typeof e.seq === "number" && e.seq > m ? e.seq : m), afterSeq);
  if (maxSeq > afterSeq) {
    // Overlapping drains (minute cron and the internal sync route) apply idempotently by
    // event key; the cursor only moves forward, and only the run that moved it acknowledges.
    const moved = await env.DB.prepare(
      `INSERT INTO workshop_outbox_cursor(provider, last_seq, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET last_seq = excluded.last_seq, updated_at = excluded.updated_at
       WHERE excluded.last_seq > workshop_outbox_cursor.last_seq`,
    )
      .bind(provider, maxSeq, Date.now())
      .run();
    if (moved.meta.changes > 0) await workshopUpstream.ackOutbox(env, maxSeq, provider).catch(() => {});
  }
  return { drained: events.length, applied: res.applied };
}
