import type { Context } from "hono";
import { normalizeUpdateNote } from "../shared/card-update";
import { evaluateRating, isRating, type Rating } from "../shared/content-rating";
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
  type SealedWorkshopRelease,
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

export const MAX_WORKSHOP_CONSTANT_CHARS = 1500;
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

export function countWorkshopConstantChars(
  worldbook?: Array<{ content?: string; constant?: boolean; isConstant?: boolean; enabled?: boolean; isEnabled?: boolean }>,
  fallback = 0,
): number {
  if (!Array.isArray(worldbook)) return Math.max(0, Math.trunc(fallback));
  let total = 0;
  for (const entry of worldbook) {
    const enabled = (entry.enabled ?? entry.isEnabled ?? true) !== false;
    const constant = entry.constant === true || entry.isConstant === true;
    if (enabled && constant && typeof entry.content === "string") {
      total += [...entry.content].length;
    }
  }
  return total;
}

export function validateSealedWorkshop(
  sealed: SealedWorkshopRelease,
  isReSubmission: boolean,
): { residentChars: number; updateNote: string; rating: Rating; descriptors: string[]; kinds: WorkshopKind[] } {
  const actual = countWorkshopConstantChars(sealed.worldbook, sealed.residentChars ?? sealed.constantChars ?? 0);
  if (actual > MAX_WORKSHOP_CONSTANT_CHARS) {
    throw new HttpError(422, "constant_char_limit", {
      actual,
      max: MAX_WORKSHOP_CONSTANT_CHARS,
      unit: "unicode_code_points",
    });
  }
  const cover = (sealed.coverUrl ?? "").trim();
  if (!/^https:\/\/[^\s]{4,1000}$/.test(cover)) {
    throw new HttpError(422, "cover_required");
  }
  const ratingRaw = (sealed.rating ?? "").trim().toUpperCase();
  if (!isRating(ratingRaw)) {
    throw new HttpError(422, "rating_required");
  }
  let descriptors: string[] = [];
  if (sealed.ratingAnswers) {
    try {
      descriptors = evaluateRating(sealed.ratingAnswers).descriptors;
    } catch {
      descriptors = [];
    }
  }
  const loreCount = Number(sealed.contents?.loreCount ?? 0);
  const ruleCount = Number(sealed.contents?.ruleCount ?? 0);
  const openingCount = Number(sealed.contents?.openingCount ?? 0);
  const kinds = (Array.isArray(sealed.kinds) ? sealed.kinds : []).filter(
    (k): k is WorkshopKind => k === "lore" || k === "display" || k === "opening",
  );
  if (loreCount + ruleCount + openingCount <= 0 && kinds.length === 0) {
    throw new HttpError(422, "content_required");
  }
  const updateNote = normalizeUpdateNote(sealed.updateNote ?? "");
  if ([...updateNote].length > 200) {
    throw new HttpError(422, "update_note_required");
  }
  if (isReSubmission) {
    const nonWs = [...updateNote.replace(/\s+/gu, "")].length;
    if (nonWs < 10) {
      throw new HttpError(422, "update_note_required");
    }
  }
  return { residentChars: actual, updateNote, rating: ratingRaw, descriptors, kinds };
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

export async function resolveCardForWork(
  db: D1Database,
  provider: ProviderId,
  workId?: string,
  sourceRoleId?: string,
): Promise<{ card: CardRow; workId: string } | null> {
  if (workId) {
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
  }
  if (sourceRoleId) {
    const byRole = await db
      .prepare("SELECT id FROM cards WHERE provider = ? AND (source_role_id = ? OR approved_hosted_role_id = ?)")
      .bind(provider, sourceRoleId, sourceRoleId)
      .first<{ id: number }>();
    if (byRole) {
      const card = await getCard(db, String(byRole.id));
      if (card) {
        const resolvedWorkId = workId || (await resolveWorkIdForCard(db, card));
        return { card, workId: resolvedWorkId };
      }
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

export async function insertWorkshopNotice(
  db: D1Database,
  input: {
    eventKey: string;
    recipientMemberId: string;
    kind:
      | "workshop_published"
      | "workshop_reopened"
      | "workshop_review_result"
      | "workshop_returned"
      | "workshop_hidden"
      | "workshop_appeal_result";
    path: string;
    actorMemberId?: string | null;
    cardId?: number | null;
    workshopId?: string | null;
    extra: Record<string, unknown>;
    now?: number;
  },
): Promise<void> {
  const now = input.now ?? Date.now();
  await db
    .prepare(
      `INSERT OR IGNORE INTO community_notifications(
        event_key, member_id, kind, path, created_at, actor_id, card_id, workshop_id, extra
      )
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
      WHERE NOT EXISTS (
        SELECT 1 FROM community_preferences p WHERE p.member_id = ?2 AND p.notifications = 0
      )`,
    )
    .bind(
      input.eventKey,
      input.recipientMemberId,
      input.kind,
      input.path,
      now,
      input.actorMemberId ?? null,
      input.cardId ?? null,
      input.workshopId ?? null,
      JSON.stringify(input.extra),
    )
    .run();
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

function cardPlayRoleId(card: CardRow): string {
  return card.approved_hosted_role_id || card.source_role_id;
}

interface AuthorInfo {
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

function formatExtensionSummary(
  row: WorkshopRow & AuthorInfo,
  card: CardRow,
  opts: { includeOwnerState?: boolean; joined?: boolean } = {},
) {
  const cardAdult = isAdult(card);
  const wsAdult = row.rating === "R";
  const handle = row.handle ?? null;
  const authorName = row.display_name || handle || `#${row.author_num_id}`;
  return {
    id: row.id,
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

  const policy = await c.env.DB.prepare(
    "SELECT allow_new FROM workshop_policies WHERE card_id = ? ORDER BY updated_at DESC LIMIT 1",
  )
    .bind(Number(card.id))
    .first<{ allow_new: number }>();

  const allowNew = policy ? policy.allow_new === 1 : true;
  const viewerIsOwner = await memberOwnsExternal(c.env.DB, member, card.provider, card.author_num_id);

  const sortSql =
    query.sort === "new"
      ? "COALESCE(w.first_published_at, w.published_at, w.created_at) DESC, w.id ASC"
      : "w.install_count DESC, COALESCE(w.first_published_at, w.published_at, w.created_at) DESC, w.id ASC";

  const rows = (
    await c.env.DB.prepare(
      `SELECT w.*, m.handle, m.display_name, m.avatar_url
       FROM workshops w
       LEFT JOIN members m ON m.id = COALESCE(
         w.author_member_id,
         (SELECT owner_member_id FROM member_connections mc WHERE mc.provider = w.provider AND mc.external_id = CAST(w.author_num_id AS TEXT)),
         (SELECT member_id FROM member_identities mi WHERE mi.provider = w.provider AND mi.external_id = CAST(w.author_num_id AS TEXT))
       )
       WHERE w.card_id = ? AND w.moderation_state = 'approved'
       ORDER BY ${sortSql}`,
    )
      .bind(Number(card.id))
      .all<WorkshopRow & AuthorInfo>()
  ).results;

  // Strictest adult & region filter: never expose R-rated workshops or counts to CN or non-NSFW viewers.
  const ratingFiltered = rows.filter((r) => !(r.rating === "R" && (gate.countryRegion === "CN" || !gate.allowAdult)));

  const nonVisibleIds = ratingFiltered.filter((r) => r.owner_state !== "visible").map((r) => r.id);
  const token = bearerOf(c);
  const accessMap = await checkProviderViewerAccess(c.env, card.provider as ProviderId, nonVisibleIds, token);

  const visibleToViewer = ratingFiltered.filter((r) => {
    if (r.owner_state === "visible") return true;
    if (viewerIsOwner) return true;
    return accessMap.get(r.id)?.accessible === true;
  });

  const total = visibleToViewer.length;
  const tabVisible = allowNew || total > 0;
  const page = Math.max(1, Math.trunc(query.page || 1));
  const start = (page - 1) * WORKSHOP_PAGE_SIZE;
  const slice = visibleToViewer.slice(start, start + WORKSHOP_PAGE_SIZE);

  let viewerInterested: boolean | undefined;
  if (member && !allowNew && !viewerIsOwner) {
    const interested = await c.env.DB.prepare(
      "SELECT 1 FROM card_workshop_interest WHERE card_id = ? AND member_id = ?",
    )
      .bind(Number(card.id), member.id)
      .first();
    viewerInterested = Boolean(interested);
  }

  return {
    tabVisible,
    allowNew,
    viewerIsOwner,
    ...(viewerInterested !== undefined ? { viewerInterested } : {}),
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
      `SELECT w.*, m.handle, m.display_name, m.avatar_url
       FROM workshops w
       LEFT JOIN members m ON m.id = COALESCE(
         w.author_member_id,
         (SELECT owner_member_id FROM member_connections mc WHERE mc.provider = w.provider AND mc.external_id = CAST(w.author_num_id AS TEXT)),
         (SELECT member_id FROM member_identities mi WHERE mi.provider = w.provider AND mi.external_id = CAST(w.author_num_id AS TEXT))
       )
       WHERE w.id IN (${placeholders}) AND w.moderation_state = 'approved'`,
    )
      .bind(...cleanIds)
      .all<WorkshopRow & AuthorInfo>()
  ).results;

  const nonVisibleIds = rows.filter((r) => r.owner_state !== "visible").map((r) => r.id);
  const accessMap = await checkProviderViewerAccess(c.env, "harbor", nonVisibleIds, token);

  const out = [];
  for (const id of cleanIds) {
    const r = rows.find((x) => x.id === id);
    if (!r) continue;
    if (r.rating === "R" && (gate.countryRegion === "CN" || !gate.allowAdult)) continue;
    const card = await getCard(c.env.DB, String(r.card_id));
    if (!card || card.status !== "approved" || card.public_blocked) continue;
    if (isAdult(card) && (gate.countryRegion === "CN" || !gate.allowAdult)) continue;
    const viewerIsOwner = await memberOwnsExternal(c.env.DB, member, card.provider, card.author_num_id);
    if (r.owner_state !== "visible" && !viewerIsOwner && !accessMap.get(r.id)?.accessible) continue;
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
  const row = await c.env.DB.prepare(
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
  if (!row) throw new HttpError(404, "not_found");

  const card = await getCard(c.env.DB, String(row.card_id));
  if (!card || card.status !== "approved" || card.public_blocked) {
    throw new HttpError(404, "not_found");
  }

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
  if (row.owner_state !== "visible") {
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
  const member = await optionalViewer(c);
  const gate = await viewerContentGate(c, member);
  if ((isAdult(card) || row.rating === "R") && gate.countryRegion === "CN") {
    throw new HttpError(404, "not_found");
  }
  if ((isAdult(card) || row.rating === "R") && !gate.allowAdult) {
    throw new HttpError(403, "adult_content");
  }
  const creatorMemberId =
    row.author_member_id ?? (await findMemberIdByExternal(c.env.DB, row.provider, row.author_num_id));

  if (row.owner_state !== "visible") {
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
    const latestSub = await c.env.DB.prepare(
      `SELECT status, note FROM workshop_review_submissions
       WHERE workshop_id = ?
       ORDER BY submitted_at DESC LIMIT 1`,
    )
      .bind(item.workshopId)
      .first<{ status: string; note: string }>();
    const appealRow = await c.env.DB.prepare(
      `SELECT status FROM workshop_appeals
       WHERE workshop_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(item.workshopId)
      .first<{ status: "pending" | "upheld" | "restored" | "revoked" }>();

    const pubVer = Number(item.publishedVersion ?? 0);
    const pending = item.hasPendingRelease || item.moderationState === "pending" || latestSub?.status === "pending";
    const rejected = item.moderationState === "rejected" || latestSub?.status === "rejected";
    let status: "draft" | "pending" | "rejected" | "live" | "live_changed" | "live_pending" | "live_rejected";
    if (pubVer > 0) {
      if (pending) status = "live_pending";
      else if (rejected) status = "live_rejected";
      else if (item.changedSincePublish) status = "live_changed";
      else status = "live";
    } else {
      if (pending) status = "pending";
      else if (rejected) status = "rejected";
      else status = "draft";
    }

    const cardNum = card ? Number(card.id) : 0;
    const cardName = card ? pickLocale(JSON.parse(card.names || "{}") as Localized, lang) : item.cardName || "";
    const normalizedAppeal =
      appealRow?.status === "revoked" ? null : (appealRow?.status ?? item.appeal ?? null);
    const updatedAt = toEpochMs(item.publishedAt) ?? toEpochMs(item.updatedAt, Date.now())!;
    items.push({
      id: item.workshopId,
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
      rejectNote: latestSub?.status === "rejected" ? latestSub.note || item.lastRejectNote : item.lastRejectNote,
      ownerState: normalizeWireOwnerState(item.ownerState),
      ownerReason: item.ownerReason ?? null,
      appeal: normalizedAppeal,
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
                (SELECT p.allow_new FROM workshop_policies p WHERE p.card_id = c.id ORDER BY p.updated_at DESC LIMIT 1),
                1
              ) AS allow_new,
              EXISTS(
                SELECT 1 FROM card_workshop_interest cwi
                WHERE cwi.card_id = c.id AND cwi.member_id = ?3
              ) AS viewer_interested,
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
      .bind(like, trimmed, member.id)
      .all<CardRow & { allow_new: number; viewer_interested: number; owner_member_id: string | null }>()
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
      viewerInterested: Boolean(r.viewer_interested),
      viewerIsOwner: r.owner_member_id
        ? r.owner_member_id === member.id
        : member.provider === r.provider && member.externalId === r.author_num_id,
    })),
  };
}

export async function setCardWorkshopInterest(c: Ctx, cardIdParam: string, draftNameRaw: unknown) {
  const member = await requireMember(c);
  const card = await getCard(c.env.DB, cardIdParam);
  if (!card || card.status !== "approved" || card.public_blocked) {
    throw new HttpError(404, "not_found");
  }
  if (await memberOwnsExternal(c.env.DB, member, card.provider, card.author_num_id)) {
    throw new HttpError(400, "owner_cannot_subscribe");
  }
  const policy = await c.env.DB.prepare(
    "SELECT work_id, allow_new FROM workshop_policies WHERE card_id = ? ORDER BY updated_at DESC LIMIT 1",
  )
    .bind(Number(card.id))
    .first<{ work_id: string; allow_new: number }>();
  if ((policy?.allow_new ?? 1) === 1) {
    throw new HttpError(409, "workshop_already_open");
  }
  const workId = policy?.work_id || (await resolveWorkIdForCard(c.env.DB, card));
  const draftName = typeof draftNameRaw === "string" ? [...draftNameRaw.trim()].slice(0, 80).join("") : "";
  await c.env.DB.prepare(
    `INSERT INTO card_workshop_interest(provider, work_id, card_id, member_id, draft_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, work_id, member_id) DO UPDATE SET draft_name = excluded.draft_name`,
  )
    .bind(card.provider, workId, Number(card.id), member.id, draftName, Date.now())
    .run();
  return { interested: true };
}

export async function clearCardWorkshopInterest(c: Ctx, cardIdParam: string) {
  const member = await requireMember(c);
  const card = await getCard(c.env.DB, cardIdParam);
  if (!card) throw new HttpError(404, "not_found");
  await c.env.DB.prepare("DELETE FROM card_workshop_interest WHERE card_id = ? AND member_id = ?")
    .bind(Number(card.id), member.id)
    .run();
  return { interested: false };
}

export async function applyWorkshopEvents(env: Env, events: WorkshopOutboxEvent[]): Promise<{ applied: number }> {
  let applied = 0;
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
    const reopenedRaw = ev.reopened !== undefined ? ev.reopened : p.reopened;
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

    if (ev.kind === "policy_changed" || ev.kind === "policy_saved") {
      const resolved = await resolveCardForWork(env.DB, provider, workId, sourceRoleId);
      if (resolved && allowNewRaw !== undefined) {
        const prev = await env.DB.prepare(
          "SELECT work_id, allow_new, revision, reopen_generation FROM workshop_policies WHERE card_id = ? ORDER BY updated_at DESC LIMIT 1",
        )
          .bind(Number(resolved.card.id))
          .first<{ work_id: string; allow_new: number; revision: number; reopen_generation: number }>();
        const targetWorkId = workId || prev?.work_id || resolved.workId;
        const nextAllow = allowNewRaw === true || allowNewRaw === 1 ? 1 : 0;
        const nextRev = Number(revisionRaw ?? (prev?.revision ?? 0) + 1);
        if (!prev || nextRev >= prev.revision) {
          const reopened = Boolean(reopenedRaw || (prev && prev.allow_new === 0 && nextAllow === 1));
          const reopenGen = (prev?.reopen_generation ?? 0) + (reopened ? 1 : 0);
          await env.DB.prepare(
            `INSERT INTO workshop_policies(provider, work_id, card_id, allow_new, revision, reopen_generation, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(provider, work_id) DO UPDATE SET
               card_id = excluded.card_id,
               allow_new = excluded.allow_new,
               revision = excluded.revision,
               reopen_generation = excluded.reopen_generation,
               updated_at = excluded.updated_at`,
          )
            .bind(provider, targetWorkId, Number(resolved.card.id), nextAllow, nextRev, reopenGen, now)
            .run();

          if (reopened) {
            const ownerMemberId = await findMemberIdByExternal(env.DB, provider, resolved.card.author_num_id);
            const interestedRows = (
              await env.DB.prepare(
                "SELECT member_id, draft_name FROM card_workshop_interest WHERE card_id = ? OR (provider = ? AND work_id = ?)",
              )
                .bind(Number(resolved.card.id), provider, targetWorkId)
                .all<{ member_id: string; draft_name: string }>()
            ).results;
            const recipients = new Map<string, string>();
            for (const r of interestedRows) recipients.set(r.member_id, r.draft_name);
            for (const pubNo of interestedNosRaw) {
              if (typeof pubNo === "number" && pubNo > 0) {
                const mid = await resolveMember(env.DB, provider, pubNo, now);
                if (!recipients.has(mid)) recipients.set(mid, "");
              }
            }
            for (const [recipientId, draftName] of recipients) {
              if (recipientId === ownerMemberId) continue;
              await insertWorkshopNotice(env.DB, {
                eventKey: `workshop_reopened:${resolved.card.id}:${reopenGen}:${recipientId}`,
                recipientMemberId: recipientId,
                kind: "workshop_reopened",
                path: "/mine?tab=workshops",
                actorMemberId: ownerMemberId,
                cardId: Number(resolved.card.id),
                extra: {
                  workshopName: draftName,
                  ...(draftName ? { draftName } : {}),
                },
                now,
              });
            }
            await env.DB.prepare("DELETE FROM card_workshop_interest WHERE card_id = ? OR (provider = ? AND work_id = ?)")
              .bind(Number(resolved.card.id), provider, targetWorkId)
              .run();
          }
        }
      }
    } else if (ev.kind === "owner_action" && workshopId) {
      const ws = await env.DB.prepare("SELECT * FROM workshops WHERE id = ?")
        .bind(workshopId)
        .first<WorkshopRow>();
      if (ws && (ownerStateRaw !== undefined || actionRaw !== undefined)) {
        const gen = Number(ownerGenRaw ?? ws.owner_action_generation + 1);
        if (gen >= ws.owner_action_generation) {
          const inferred =
            ownerStateRaw ??
            (actionRaw === "hide" ? "hidden" : actionRaw === "return" ? "returned" : "visible");
          const dbState = normalizeDbOwnerState(inferred);
          const reason = dbState === "visible" ? null : (reasonRaw ?? null);
          const actedAt = dbState === "visible" ? null : createdAtMs;
          await env.DB.prepare(
            `UPDATE workshops
             SET owner_state = ?, owner_reason = ?, owner_acted_at = ?, owner_action_generation = ?,
                 protected_join_cutoff_seq = COALESCE(?, protected_join_cutoff_seq), updated_at = ?
             WHERE id = ?`,
          )
            .bind(dbState, reason, actedAt, gen, cutoffSeqRaw ?? null, now, ws.id)
            .run();

          const effectiveAction =
            actionRaw ?? (dbState === "returned" ? "return" : dbState === "hidden_by_owner" ? "hide" : "restore");
          if (effectiveAction === "return" || effectiveAction === "hide") {
            const card = await getCard(env.DB, String(ws.card_id));
            const ownerMemberId = card ? await findMemberIdByExternal(env.DB, ws.provider, card.author_num_id) : null;
            const creatorMemberId =
              ws.author_member_id ?? (await resolveMember(env.DB, provider, ws.author_num_id, now));
            if (creatorMemberId && creatorMemberId !== ownerMemberId) {
              const kind = effectiveAction === "return" ? "workshop_returned" : "workshop_hidden";
              await insertWorkshopNotice(env.DB, {
                eventKey: `${kind}:${ws.id}:${gen}`,
                recipientMemberId: creatorMemberId,
                kind,
                path: `/mine/workshops/${ws.id}/edit?section=publish`,
                actorMemberId: ownerMemberId,
                cardId: ws.card_id,
                workshopId: ws.id,
                extra: {
                  workshopName: ws.name,
                  reason: reason ?? "",
                },
                now,
              });
            }
          }
        }
      }
    } else if (ev.kind === "appeal_submitted" && workshopId) {
      const ws = await env.DB.prepare("SELECT * FROM workshops WHERE id = ?")
        .bind(workshopId)
        .first<WorkshopRow>();
      if (ws) {
        const creatorNum = Number(authorPubNoRaw ?? ws.author_num_id);
        const creatorMemberId =
          ws.author_member_id ?? (creatorNum > 0 ? await resolveMember(env.DB, provider, creatorNum, now) : null);
        const card = await getCard(env.DB, String(ws.card_id));
        const appealId = appealIdRaw || crypto.randomUUID();
        const wireSnap = normalizeWireOwnerState(ownerStateSnapRaw ?? ws.owner_state);
        const appealOwnerState = wireSnap === "returned" ? "returned" : "hidden";
        await env.DB.batch([
          env.DB.prepare(
            `INSERT OR IGNORE INTO workshop_appeals(
              id, workshop_id, card_id, provider, work_id, creator_num_id, creator_member_id,
              card_owner_num_id, owner_state_snapshot, owner_reason_snapshot, owner_acted_at, owner_action_generation,
              appeal_reason, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          ).bind(
            appealId,
            ws.id,
            ws.card_id,
            ws.provider,
            ws.work_id,
            creatorNum,
            creatorMemberId,
            card?.author_num_id ?? 0,
            appealOwnerState,
            ownerReasonSnapRaw ?? ws.owner_reason ?? "",
            ws.owner_acted_at ?? ws.updated_at,
            Number(ownerGenRaw ?? ws.owner_action_generation),
            (reasonRaw ?? "").trim(),
            createdAtMs,
          ),
          env.DB.prepare("UPDATE workshops SET appeal_state = 'pending', updated_at = ? WHERE id = ?").bind(now, ws.id),
        ]);
      }
    } else if ((ev.kind === "install_count_changed" || ev.kind === "install_count") && workshopId && typeof joinCountRaw === "number") {
      await env.DB.prepare("UPDATE workshops SET install_count = ?, updated_at = ? WHERE id = ?")
        .bind(Math.max(0, Math.trunc(joinCountRaw)), now, workshopId)
        .run();
    } else if (ev.kind === "appeal_decided" && workshopId && (decisionRaw === "upheld" || decisionRaw === "restored")) {
      const ws = await env.DB.prepare("SELECT * FROM workshops WHERE id = ?")
        .bind(workshopId)
        .first<WorkshopRow>();
      if (ws) {
        const nextGen = Math.max(ws.owner_action_generation, Number(ownerGenRaw ?? ws.owner_action_generation));
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE workshop_appeals
             SET status = ?, decided_at = COALESCE(decided_at, ?)
             WHERE workshop_id = ? AND status = 'pending'`,
          ).bind(decisionRaw, createdAtMs, ws.id),
          decisionRaw === "restored"
            ? env.DB.prepare(
                `UPDATE workshops
                 SET owner_state = 'visible', owner_reason = NULL, owner_acted_at = NULL,
                     owner_action_generation = ?, appeal_state = 'restored', updated_at = ?
                 WHERE id = ?`,
              ).bind(nextGen, now, ws.id)
            : env.DB.prepare(
                `UPDATE workshops
                 SET appeal_state = 'upheld', owner_action_generation = ?, updated_at = ?
                 WHERE id = ?`,
              ).bind(nextGen, now, ws.id),
        ]);
      }
    } else if (ev.kind === "release_committed" && workshopId) {
      if (typeof joinCountRaw === "number") {
        await env.DB.prepare("UPDATE workshops SET install_count = ?, updated_at = ? WHERE id = ?")
          .bind(Math.max(0, Math.trunc(joinCountRaw)), now, workshopId)
          .run();
      } else if (decisionRaw === "approved" && typeof versionRaw === "number" && versionRaw > 0) {
        await env.DB.prepare(
          "UPDATE workshops SET moderation_state = 'approved', version_no = MAX(version_no, ?), updated_at = ? WHERE id = ? AND moderation_state NOT IN ('revoked', 'deleted')",
        )
          .bind(Math.trunc(versionRaw), now, workshopId)
          .run();
      }
    } else if ((ev.kind === "workshop_deleted" || ev.kind === "moderated") && workshopId) {
      if (ev.kind === "workshop_deleted") {
        await env.DB.prepare("UPDATE workshops SET moderation_state = 'deleted', updated_at = ? WHERE id = ?")
          .bind(now, workshopId)
          .run();
      } else if (actionRaw === "revoke" || modStateRaw === "revoked") {
        await env.DB.batch([
          env.DB.prepare("UPDATE workshops SET moderation_state = 'revoked', updated_at = ? WHERE id = ?").bind(
            now,
            workshopId,
          ),
          env.DB.prepare(
            "UPDATE workshop_appeals SET status = 'revoked', decided_at = ? WHERE workshop_id = ? AND status = 'pending'",
          ).bind(now, workshopId),
        ]);
      } else if (actionRaw === "restore" || modStateRaw === "approved") {
        await env.DB.prepare(
          `UPDATE workshops
           SET moderation_state = IIF(version_no > 0, 'approved', 'draft'), updated_at = ?
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
  return { applied };
}

export async function drainProviderWorkshopOutbox(
  env: Env,
  provider: ProviderId = "harbor",
): Promise<{ drained: number; applied: number }> {
  const cursor = await env.DB.prepare("SELECT last_seq FROM workshop_outbox_cursor WHERE provider = ?")
    .bind(provider)
    .first<{ last_seq: number }>();
  const afterSeq = cursor?.last_seq ?? 0;
  const batch = await workshopUpstream.pullOutbox(env, afterSeq, 100, provider);
  const events = batch.events ?? [];
  if (events.length === 0) return { drained: 0, applied: 0 };
  const res = await applyWorkshopEvents(env, events);
  const maxSeq = events.reduce((m, e) => (typeof e.seq === "number" && e.seq > m ? e.seq : m), afterSeq);
  if (maxSeq > afterSeq) {
    await env.DB.prepare(
      `INSERT INTO workshop_outbox_cursor(provider, last_seq, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET last_seq = excluded.last_seq, updated_at = excluded.updated_at`,
    )
      .bind(provider, maxSeq, Date.now())
      .run();
    await workshopUpstream.ackOutbox(env, maxSeq, provider).catch(() => {});
  }
  return { drained: events.length, applied: res.applied };
}
