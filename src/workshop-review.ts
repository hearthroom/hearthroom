import type { Context } from "hono";
import { auditStmt } from "./audit";
import { getCard, isAdult } from "./cards";
import { bearerOf } from "./community-admin";
import { queuePush } from "./community/push";
import { memberNsfw, requireMember, requireReviewer, reviewerRole, type Member } from "./members";
import { bumpOp } from "./ops-metrics";
import type { ProviderId } from "./providers";
import { CLAIM_TTL_MS, REVIEW_NOTE_MAX, type HoldView } from "./review";
import { communityAdmin, humanOnly, staff } from "./staff";
import { HttpError, pickLocale, type Env, type Localized } from "./types";
import {
  MAX_WORKSHOP_CONSTANT_CHARS,
  findMemberIdByExternal,
  insertWorkshopNotice,
  memberOwnsExternal,
  normalizeDbOwnerState,
  normalizeWireOwnerState,
  resolveCardForWork,
  validateSealedWorkshop,
  type WorkshopRow,
} from "./workshop";
import { ensureOperationUuid, toEpochMs, workshopUpstream } from "./workshop-gateway";

type Ctx = Pick<Context<{ Bindings: Env }>, "env" | "req" | "executionCtx">;

export interface WorkshopSubmissionRow {
  id: string;
  workshop_id: string;
  card_id: number;
  provider: string;
  work_id: string;
  source_role_id: string;
  author_num_id: number;
  author_member_id: string;
  card_owner_num_id: number;
  kind: "first" | "re";
  status: "pending" | "approved" | "rejected" | "superseded" | "withdrawn";
  publication_state: "pending" | "decided" | "published";
  sealed_release_id: string;
  operation_id: string;
  content_hash: string;
  name: string;
  summary: string;
  readme: string;
  cover_url: string;
  update_note: string;
  kinds: string;
  rating: string;
  rating_descriptors: string;
  rating_answers: string;
  resident_chars: number;
  lore_count: number;
  rule_count: number;
  opening_count: number;
  expected_owner_generation: number;
  submitted_at: number;
  claimed_by: string | null;
  claimed_at: number | null;
  claim_generation: string;
  decided_at: number | null;
  note: string;
}

export async function isWorkshopSubmission(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM workshop_review_submissions WHERE id = ?")
    .bind(id)
    .first();
  return Boolean(row);
}

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export interface NormalizedWorkshopContent {
  id: string;
  releaseId: string;
  name: string;
  summary: string;
  description: string;
  coverUrl: string | null;
  version: string;
  previousVersion: string | null;
  updateNote: string | null;
  residentChars: number;
  residentMax: number;
  entries: Array<{
    entryId: string;
    name: string;
    content: string;
    keywords: string[];
    secondaryKeywords: string[];
    isEnabled: boolean;
    isConstant: boolean;
  }>;
  rules: Array<{
    id: string;
    name: string;
    find: string;
    replace: string;
    enabled: boolean;
  }>;
  openings: Array<{
    id: string;
    title: string;
    content: string;
  }>;
}

function openingTitles(lang = "zh-Hant") {
  switch (lang) {
    case "zh-Hans":
      return {
        welcome: "开场白",
        alt: (n: number) => `备选开场白 ${n}`,
        page: "开局网页",
        prologue: "序章",
      };
    case "en":
      return {
        welcome: "Greeting",
        alt: (n: number) => `Alternate greeting ${n}`,
        page: "Opening page",
        prologue: "Prologue",
      };
    case "ja":
      return {
        welcome: "導入メッセージ",
        alt: (n: number) => `代替導入 ${n}`,
        page: "開始ページ",
        prologue: "プロローグ",
      };
    case "ko":
      return {
        welcome: "첫 인사",
        alt: (n: number) => `대체 인사 ${n}`,
        page: "시작 페이지",
        prologue: "프롤로그",
      };
    default:
      return {
        welcome: "開場白",
        alt: (n: number) => `備選開場白 ${n}`,
        page: "開局網頁",
        prologue: "序章",
      };
  }
}

function buildWorkshopContentObject(input: {
  workshopId: string;
  releaseId: string;
  name: string;
  summary: string;
  description: string;
  coverUrl: string | null;
  versionNo: number;
  previousVersionNo: number;
  updateNote: string | null;
  residentChars: number;
  sealed?: Record<string, unknown> | null;
  redacted?: boolean;
  lang?: string;
}): NormalizedWorkshopContent {
  if (input.redacted) {
    return {
      id: input.workshopId,
      releaseId: input.releaseId,
      name: input.name,
      summary: input.summary,
      description: "",
      coverUrl: null,
      version: `v${Math.max(1, input.versionNo)}`,
      previousVersion: input.previousVersionNo > 0 ? `v${input.previousVersionNo}` : null,
      updateNote: input.updateNote,
      residentChars: input.residentChars,
      residentMax: MAX_WORKSHOP_CONSTANT_CHARS,
      entries: [],
      rules: [],
      openings: [],
    };
  }

  const sealed = input.sealed ?? {};
  const rawWb = Array.isArray(sealed.worldbook)
    ? sealed.worldbook
    : sealed.worldbook && typeof sealed.worldbook === "object" && Array.isArray((sealed.worldbook as { entries?: unknown }).entries)
      ? ((sealed.worldbook as { entries: unknown[] }).entries)
      : Array.isArray(sealed.entries)
        ? sealed.entries
        : [];
  const entries = rawWb.map((raw, idx) => {
    const e = (raw ?? {}) as Record<string, unknown>;
    const kw = Array.isArray(e.keywords) ? e.keywords : Array.isArray(e.key) ? e.key : [];
    const skw = Array.isArray(e.secondaryKeywords)
      ? e.secondaryKeywords
      : Array.isArray(e.keysecondary)
        ? e.keysecondary
        : [];
    return {
      entryId: String(e.entryId ?? e.id ?? `entry-${idx + 1}`),
      name: String(e.name ?? e.comment ?? ""),
      content: String(e.content ?? ""),
      keywords: kw.map(String),
      secondaryKeywords: skw.map(String),
      isEnabled: (e.isEnabled ?? e.enabled ?? true) !== false,
      isConstant: Boolean(e.isConstant ?? e.constant ?? false),
    };
  });

  const rawRules = Array.isArray(sealed.rules)
    ? sealed.rules
    : sealed.rules && typeof sealed.rules === "object" && Array.isArray((sealed.rules as { rules?: unknown }).rules)
      ? ((sealed.rules as { rules: unknown[] }).rules)
      : [];
  const rules = rawRules.map((raw, idx) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id ?? `rule-${idx + 1}`),
      name: String(r.name ?? r.scriptName ?? ""),
      find: String(r.find ?? r.findRegex ?? ""),
      replace: String(r.replace ?? r.replaceString ?? ""),
      enabled: r.disabled === true ? false : (r.enabled ?? true) !== false,
    };
  });

  const openings: Array<{ id: string; title: string; content: string }> = [];
  if (Array.isArray(sealed.openings)) {
    for (let i = 0; i < sealed.openings.length; i++) {
      const o = (sealed.openings[i] ?? {}) as Record<string, unknown>;
      openings.push({
        id: String(o.id ?? `opening-${i + 1}`),
        title: String(o.title ?? ""),
        content: String(o.content ?? ""),
      });
    }
  } else if (sealed.opening && typeof sealed.opening === "object") {
    const op = sealed.opening as {
      mode?: unknown;
      welcome?: unknown;
      alternates?: unknown;
      prologue?: unknown;
      openingPage?: unknown;
    };
    const titles = openingTitles(input.lang);
    const mode = typeof op.mode === "string" ? op.mode.trim().toLowerCase() : "";
    const pushWelcomeAndAlts = () => {
      if (typeof op.welcome === "string" && op.welcome.trim()) {
        openings.push({ id: "welcome", title: titles.welcome, content: op.welcome });
      }
      if (Array.isArray(op.alternates)) {
        op.alternates.forEach((alt, idx) => {
          if (typeof alt === "string" && alt.trim()) {
            openings.push({ id: `alt-${idx + 1}`, title: titles.alt(idx + 1), content: alt });
          }
        });
      }
    };
    const pushPage = () => {
      if (typeof op.openingPage === "string" && op.openingPage.trim()) {
        openings.push({ id: "opening-page", title: titles.page, content: op.openingPage });
      }
    };
    const pushPrologue = () => {
      if (typeof op.prologue === "string" && op.prologue.trim()) {
        openings.push({ id: "prologue", title: titles.prologue, content: op.prologue });
      } else if (Array.isArray(op.prologue)) {
        const joined = op.prologue
          .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
          .join("\n\n");
        if (joined) openings.push({ id: "prologue", title: titles.prologue, content: joined });
      }
    };

    if (mode === "page") {
      pushPage();
    } else if (mode === "prologue") {
      pushPrologue();
    } else if (mode === "greeting" || mode === "welcome") {
      pushWelcomeAndAlts();
    } else {
      pushWelcomeAndAlts();
      pushPage();
      pushPrologue();
    }
  }

  return {
    id: input.workshopId,
    releaseId: input.releaseId,
    name: typeof sealed.name === "string" && sealed.name ? sealed.name : input.name,
    summary: typeof sealed.summary === "string" ? sealed.summary : input.summary,
    description: typeof sealed.readme === "string" ? sealed.readme : input.description,
    coverUrl:
      typeof sealed.coverUrl === "string" && sealed.coverUrl
        ? sealed.coverUrl
        : input.coverUrl || null,
    version: `v${Math.max(1, input.versionNo)}`,
    previousVersion: input.previousVersionNo > 0 ? `v${input.previousVersionNo}` : null,
    updateNote:
      typeof sealed.updateNote === "string" && sealed.updateNote
        ? sealed.updateNote
        : input.updateNote || null,
    residentChars: input.residentChars,
    residentMax: MAX_WORKSHOP_CONSTANT_CHARS,
    entries,
    rules,
    openings,
  };
}

export async function submitWorkshop(
  c: Ctx,
  workshopId: string,
  body: { operationId?: unknown; updateNote?: unknown },
) {
  const member = await requireMember(c);
  const token = bearerOf(c);
  if (!token) throw new HttpError(401, "missing bearer token");
  const rawOperationId =
    typeof body.operationId === "string" && body.operationId.trim()
      ? body.operationId.trim().slice(0, 100)
      : crypto.randomUUID();
  const operationId = await ensureOperationUuid(rawOperationId);
  const rawUpdateNote = typeof body.updateNote === "string" ? body.updateNote : undefined;

  let existingActive = await c.env.DB.prepare(
    "SELECT * FROM workshop_review_submissions WHERE workshop_id = ? AND (status = 'pending' OR publication_state = 'decided') ORDER BY submitted_at DESC LIMIT 1",
  )
    .bind(workshopId)
    .first<WorkshopSubmissionRow>();
  if (existingActive && existingActive.publication_state === "decided") {
    try {
      await finalizeDecidedWorkshopSubmission(c.env, existingActive);
      existingActive = null;
    } catch {
      await bumpOp(c.env.DB, "workshop", "submit", "conflict");
      throw new HttpError(409, "review_commit_in_progress");
    }
  }
  if (existingActive && existingActive.status === "pending") {
    if (existingActive.operation_id === operationId && existingActive.author_member_id === member.id) {
      return {
        status: existingActive.kind === "re" ? ("live_pending" as const) : ("pending" as const),
        moderationState: "pending" as const,
        submissionId: existingActive.id,
      };
    }
    await bumpOp(c.env.DB, "workshop", "submit", "conflict");
    throw new HttpError(409, "review_already_pending");
  }

  let sealed;
  try {
    sealed = await workshopUpstream.seal(c.env, token, { workshopId, operationId, updateNote: rawUpdateNote }, member.provider);
  } catch (err) {
    await bumpOp(c.env.DB, "workshop", "submit", err instanceof HttpError && err.status < 500 ? "denied" : "error");
    throw err;
  }

  if (!(await memberOwnsExternal(c.env.DB, member, member.provider, sealed.authorPublicNo))) {
    await bumpOp(c.env.DB, "workshop", "submit", "denied");
    throw new HttpError(403, "not_the_author");
  }

  const resolved = await resolveCardForWork(c.env.DB, member.provider, sealed.workId, sealed.sourceRoleId);
  if (!resolved || resolved.card.status !== "approved" || resolved.card.public_blocked) {
    await bumpOp(c.env.DB, "workshop", "submit", "denied");
    throw new HttpError(404, "card_not_available");
  }
  const card = resolved.card;

  const existingWs = await c.env.DB.prepare("SELECT * FROM workshops WHERE id = ?")
    .bind(workshopId)
    .first<WorkshopRow>();
  const publishedVer = Math.max(existingWs?.version_no ?? 0, Number(sealed.publishedVersion ?? 0));
  const kind: "first" | "re" = publishedVer > 0 ? "re" : "first";

  if (kind === "first" && !(await memberOwnsExternal(c.env.DB, member, member.provider, card.author_num_id))) {
    const policy = await c.env.DB.prepare(
      "SELECT allow_new FROM workshop_policies WHERE card_id = ? ORDER BY updated_at DESC LIMIT 1",
    )
      .bind(Number(card.id))
      .first<{ allow_new: number }>();
    if (policy && policy.allow_new === 0) {
      await workshopUpstream.withdraw(c.env, token, { workshopId, releaseId: sealed.releaseId }, member.provider).catch(() => {});
      await bumpOp(c.env.DB, "workshop", "submit", "denied");
      throw new HttpError(403, "workshop_closed");
    }
  }

  let validated;
  try {
    validated = validateSealedWorkshop(sealed, kind === "re");
  } catch (err) {
    await workshopUpstream.withdraw(c.env, token, { workshopId, releaseId: sealed.releaseId }, member.provider).catch(() => {});
    await bumpOp(c.env.DB, "workshop", "submit", "denied");
    throw err;
  }

  const now = Date.now();
  const submissionId = crypto.randomUUID();
  const loreCount = Number(sealed.contents?.loreCount ?? 0);
  const ruleCount = Number(sealed.contents?.ruleCount ?? 0);
  const openingCount = Number(sealed.contents?.openingCount ?? 0);
  const descriptorsJson = JSON.stringify(validated.descriptors);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO workshops(
        id, card_id, provider, work_id, source_role_id, author_num_id, author_member_id,
        name, summary, readme, cover_url, kinds, rating, rating_descriptors, version_no,
        resident_chars, lore_count, rule_count, opening_count,
        moderation_state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'pending', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        author_member_id = COALESCE(workshops.author_member_id, excluded.author_member_id),
        rating_descriptors = IIF(workshops.version_no > 0, workshops.rating_descriptors, excluded.rating_descriptors),
        moderation_state = IIF(workshops.version_no > 0, workshops.moderation_state, 'pending'),
        updated_at = excluded.updated_at`,
    ).bind(
      workshopId,
      Number(card.id),
      member.provider,
      resolved.workId,
      sealed.sourceRoleId || card.source_role_id,
      sealed.authorPublicNo,
      member.id,
      (sealed.name ?? "").trim(),
      (sealed.summary ?? "").trim(),
      sealed.readme ?? "",
      sealed.coverUrl.trim(),
      JSON.stringify(validated.kinds),
      validated.rating,
      descriptorsJson,
      validated.residentChars,
      loreCount,
      ruleCount,
      openingCount,
      now,
      now,
    ),
    c.env.DB.prepare(
      `INSERT INTO workshop_review_submissions(
        id, workshop_id, card_id, provider, work_id, source_role_id,
        author_num_id, author_member_id, card_owner_num_id, kind, status, publication_state,
        sealed_release_id, operation_id, content_hash, name, summary, readme, cover_url,
        update_note, kinds, rating, rating_descriptors, rating_answers, resident_chars,
        lore_count, rule_count, opening_count, expected_owner_generation, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      submissionId,
      workshopId,
      Number(card.id),
      member.provider,
      resolved.workId,
      sealed.sourceRoleId || card.source_role_id,
      sealed.authorPublicNo,
      member.id,
      sealed.cardOwnerPublicNo ?? card.author_num_id,
      kind,
      sealed.releaseId,
      operationId,
      sealed.contentHash ?? "",
      (sealed.name ?? "").trim(),
      (sealed.summary ?? "").trim(),
      sealed.readme ?? "",
      sealed.coverUrl.trim(),
      validated.updateNote,
      JSON.stringify(validated.kinds),
      validated.rating,
      descriptorsJson,
      JSON.stringify(sealed.ratingAnswers ?? {}),
      validated.residentChars,
      loreCount,
      ruleCount,
      openingCount,
      Number(sealed.ownerGeneration ?? existingWs?.owner_action_generation ?? 0),
      now,
    ),
  ]);

  await bumpOp(c.env.DB, "workshop", "submit", "success");
  return {
    status: kind === "re" ? ("live_pending" as const) : ("pending" as const),
    moderationState: "pending" as const,
    submissionId,
  };
}

export async function withdrawWorkshop(c: Ctx, workshopId: string) {
  const member = await requireMember(c);
  const token = bearerOf(c);
  if (!token) throw new HttpError(401, "missing bearer token");

  const pending = await c.env.DB.prepare(
    "SELECT * FROM workshop_review_submissions WHERE workshop_id = ? AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1",
  )
    .bind(workshopId)
    .first<WorkshopSubmissionRow>();
  if (!pending) throw new HttpError(404, "not_found");
  if (
    pending.author_member_id !== member.id &&
    !(await memberOwnsExternal(c.env.DB, member, pending.provider, pending.author_num_id))
  ) {
    throw new HttpError(403, "not_the_author");
  }
  if (pending.publication_state !== "pending") {
    throw new HttpError(409, "review_already_decided");
  }

  await workshopUpstream.withdraw(
    c.env,
    token,
    { workshopId, releaseId: pending.sealed_release_id },
    member.provider,
  );
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE workshop_review_submissions SET status = 'withdrawn', decided_at = ? WHERE id = ? AND status = 'pending'",
    ).bind(now, pending.id),
    c.env.DB.prepare("DELETE FROM workshop_review_holds WHERE workshop_id = ?").bind(workshopId),
    c.env.DB.prepare(
      "UPDATE workshops SET moderation_state = IIF(version_no > 0, 'approved', 'draft'), updated_at = ? WHERE id = ?",
    ).bind(now, workshopId),
  ]);
  await bumpOp(c.env.DB, "workshop", "withdraw", "success");

  const ws = await c.env.DB.prepare("SELECT version_no FROM workshops WHERE id = ?")
    .bind(workshopId)
    .first<{ version_no: number }>();
  return {
    withdrawn: true,
    status: (ws?.version_no ?? 0) > 0 ? ("live" as const) : ("draft" as const),
  };
}

export async function countClaimableWorkshopReviews(
  db: D1Database,
  reviewer: Member,
  now = Date.now(),
): Promise<number> {
  const nsfw = await memberNsfw(db, reviewer.id);
  const ageOk = nsfw.countryRegion !== "CN" && nsfw.ageVerifiedAt !== null ? 1 : 0;
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM workshop_review_submissions s
       LEFT JOIN cards c ON c.id = s.card_id
       LEFT JOIN workshop_review_holds h ON h.workshop_id = s.workshop_id
       WHERE s.status = 'pending'
         AND s.author_member_id <> ?1
         AND NOT (s.provider = ?2 AND s.author_num_id = ?3)
         AND NOT EXISTS (
           SELECT 1 FROM member_connections mc
           WHERE mc.owner_member_id = ?1 AND mc.provider = s.provider AND mc.external_id = CAST(s.author_num_id AS TEXT)
         )
         AND NOT EXISTS (
           SELECT 1 FROM member_identities mi
           WHERE mi.member_id = ?1 AND mi.provider = s.provider AND mi.external_id = CAST(s.author_num_id AS TEXT)
         )
         AND (?4 = 1 OR (s.rating <> 'R' AND COALESCE(c.rating, 'G') <> 'R'))
         AND (h.member_id IS NULL OR h.member_id = ?1)
         AND (s.claimed_by IS NULL OR s.claimed_by = ?1 OR s.claimed_at <= ?5)`,
    )
    .bind(reviewer.id, reviewer.provider, reviewer.externalId, ageOk, now - CLAIM_TTL_MS)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listWorkshopQueueItems(
  db: D1Database,
  reviewer: Member,
  lang: string,
  now = Date.now(),
) {
  const nsfw = await memberNsfw(db, reviewer.id);
  const role = await reviewerRole(db, reviewer.id);
  const manager = role === "manager" || role === "owner";

  const rows = (
    await db
      .prepare(
        `SELECT s.*,
                c.names AS card_names,
                c.summaries AS card_summaries,
                c.background_url AS card_avatar,
                c.source_role_id AS card_role_id,
                c.zone AS card_zone,
                c.tags AS card_tags,
                c.rating AS card_rating,
                w.version_no AS published_ver,
                COALESCE(NULLIF(am.display_name, ''), am.handle) AS author_name,
                h.member_id AS hold_member_id,
                h.created_at AS hold_at,
                COALESCE(NULLIF(hm.display_name, ''), hm.handle) AS hold_name,
                (SELECT COUNT(*) FROM workshop_review_stamps st WHERE st.submission_id = s.id AND st.verdict = 'approve') AS approvals,
                (SELECT COUNT(*) FROM workshop_review_stamps st WHERE st.submission_id = s.id AND st.member_id = ?1) AS mine_stamps,
                (SELECT COUNT(*) FROM workshop_review_submissions p
                  WHERE p.workshop_id = s.workshop_id
                    AND p.status IN ('approved', 'rejected')
                    AND p.submitted_at < s.submitted_at) AS earlier
         FROM workshop_review_submissions s
         LEFT JOIN cards c ON c.id = s.card_id
         LEFT JOIN workshops w ON w.id = s.workshop_id
         LEFT JOIN members am ON am.id = s.author_member_id
         LEFT JOIN workshop_review_holds h ON h.workshop_id = s.workshop_id
         LEFT JOIN members hm ON hm.id = h.member_id
         WHERE s.status = 'pending'
         ORDER BY s.submitted_at ASC
         LIMIT 200`,
      )
      .bind(reviewer.id)
      .all<
        WorkshopSubmissionRow & {
          card_names: string | null;
          card_summaries: string | null;
          card_avatar: string | null;
          card_role_id: string | null;
          card_zone: string | null;
          card_tags: string | null;
          card_rating: string | null;
          published_ver: number | null;
          author_name: string | null;
          hold_member_id: string | null;
          hold_at: number | null;
          hold_name: string | null;
          approvals: number;
          mine_stamps: number;
          earlier: number;
        }
      >()
  ).results;

  return rows
    .filter((r) => !(nsfw.countryRegion === "CN" && (r.rating === "R" || r.card_rating === "R")))
    .map((r) => {
      const claimValid = Boolean(r.claimed_by && r.claimed_at !== null && now - r.claimed_at < CLAIM_TTL_MS);
      const claim: "free" | "mine" | "other" = !claimValid
        ? "free"
        : r.claimed_by === reviewer.id
          ? "mine"
          : "other";
      const cardName = r.card_names ? pickLocale(JSON.parse(r.card_names) as Localized, lang) : `#${r.card_id}`;
      const cardSummary = r.card_summaries ? pickLocale(JSON.parse(r.card_summaries) as Localized, lang) : "";
      const hold: HoldView | null =
        r.hold_member_id && r.hold_at !== null
          ? {
              holder: (r.hold_name ?? "").slice(0, 80),
              at: r.hold_at,
              byMe: r.hold_member_id === reviewer.id,
              canRelease: r.hold_member_id === reviewer.id || manager,
            }
          : null;
      const nextVer = Math.max(1, (r.published_ver ?? 0) + 1);
      return {
        id: r.id,
        subjectKind: "workshop" as const,
        kind: r.kind,
        type: r.kind === "re" ? ("update" as const) : ("first" as const),
        submittedAt: r.submitted_at,
        attempt: r.earlier + 1,
        rating: r.rating,
        claim,
        claimedByMe: claim === "mine",
        stampedByMe: r.mine_stamps > 0,
        ...(claim === "mine" ? { claimGeneration: r.claim_generation } : {}),
        stamps: { approve: r.approvals, required: 1 },
        hold,
        reopen: false,
        lengthExempt: false,
        reviewLength: null,
        worldbookEntries: r.lore_count,
        regexRules: r.rule_count,
        card: {
          id: String(r.card_id),
          num: r.card_id,
          roleId: r.card_role_id ?? r.source_role_id,
          name: cardName,
          summary: cardSummary,
          avatarUrl: r.card_avatar ?? null,
          zone: r.card_zone ?? "all",
          tags: parseJsonArray<string>(r.card_tags),
        },
        workshop: {
          id: r.workshop_id,
          name: r.name,
          summary: r.summary,
          coverUrl: r.cover_url,
          updateNote: r.update_note,
          residentChars: r.resident_chars,
          loreCount: r.lore_count,
          ruleCount: r.rule_count,
          openingCount: r.opening_count,
          authorName: r.author_name || `#${r.author_num_id}`,
          version: `v${nextVer}`,
        },
      };
    });
}

async function isOwnWorkshopSubmission(
  db: D1Database,
  sub: WorkshopSubmissionRow,
  reviewer: Member,
): Promise<boolean> {
  if (sub.author_member_id === reviewer.id) return true;
  return memberOwnsExternal(db, reviewer, sub.provider, sub.author_num_id);
}

async function loadPendingForReviewer(
  db: D1Database,
  submissionId: string,
  reviewer: Member,
): Promise<{ sub: WorkshopSubmissionRow; cardRating: string | null }> {
  const sub = await db
    .prepare("SELECT * FROM workshop_review_submissions WHERE id = ?")
    .bind(submissionId)
    .first<WorkshopSubmissionRow>();
  if (!sub) throw new HttpError(404, "not_found");
  if (await isOwnWorkshopSubmission(db, sub, reviewer)) {
    throw new HttpError(403, "workshop_self_review");
  }
  const card = await getCard(db, String(sub.card_id));
  const cardRating = card?.rating ?? null;
  if (sub.rating === "R" || (card && isAdult(card))) {
    const nsfw = await memberNsfw(db, reviewer.id);
    if (nsfw.countryRegion === "CN") throw new HttpError(404, "not_found");
    if (!nsfw.ageVerifiedAt) throw new HttpError(403, "age_verification_required");
  }
  return { sub, cardRating };
}

export async function claimWorkshopSubmission(c: Ctx, submissionId: string) {
  const reviewer = await requireReviewer(c);
  const { sub } = await loadPendingForReviewer(c.env.DB, submissionId, reviewer);
  if (sub.status !== "pending") throw new HttpError(409, "submission_already_decided");

  const hold = await c.env.DB.prepare("SELECT member_id FROM workshop_review_holds WHERE workshop_id = ?")
    .bind(sub.workshop_id)
    .first<{ member_id: string }>();
  if (hold && hold.member_id !== reviewer.id) {
    throw new HttpError(409, "submission_held");
  }

  const now = Date.now();
  if (sub.claimed_by && sub.claimed_by !== reviewer.id && sub.claimed_at && sub.claimed_at > now - CLAIM_TTL_MS) {
    throw new HttpError(409, "submission_claimed");
  }
  const generation = crypto.randomUUID();
  await c.env.DB.prepare(
    "UPDATE workshop_review_submissions SET claimed_by = ?, claimed_at = ?, claim_generation = ? WHERE id = ? AND status = 'pending'",
  )
    .bind(reviewer.id, now, generation, sub.id)
    .run();
  return { id: sub.id, ok: true, claimedAt: now, expiresAt: now + CLAIM_TTL_MS, generation };
}

export async function releaseWorkshopSubmission(
  c: Ctx,
  submissionId: string,
  body: { generation?: unknown } = {},
) {
  const reviewer = await requireReviewer(c);
  const sub = await c.env.DB.prepare("SELECT * FROM workshop_review_submissions WHERE id = ?")
    .bind(submissionId)
    .first<WorkshopSubmissionRow>();
  if (!sub) throw new HttpError(404, "not_found");
  if (
    typeof body.generation === "string" &&
    body.generation &&
    sub.claimed_by === reviewer.id &&
    sub.claim_generation &&
    body.generation !== sub.claim_generation
  ) {
    throw new HttpError(409, "claim changed");
  }
  if (sub.claimed_by === reviewer.id) {
    await c.env.DB.prepare(
      "UPDATE workshop_review_submissions SET claimed_by = NULL, claimed_at = NULL, claim_generation = '' WHERE id = ? AND claimed_by = ?",
    )
      .bind(sub.id, reviewer.id)
      .run();
  }
}

export async function holdWorkshopSubmission(
  c: Ctx,
  submissionId: string,
  body: { generation?: unknown } = {},
) {
  const reviewer = await requireReviewer(c);
  const { sub } = await loadPendingForReviewer(c.env.DB, submissionId, reviewer);
  if (sub.status !== "pending") throw new HttpError(409, "submission_already_decided");
  if (
    typeof body.generation === "string" &&
    body.generation &&
    sub.claimed_by === reviewer.id &&
    sub.claim_generation &&
    body.generation !== sub.claim_generation
  ) {
    throw new HttpError(409, "claim changed");
  }
  const existing = await c.env.DB.prepare("SELECT member_id, created_at FROM workshop_review_holds WHERE workshop_id = ?")
    .bind(sub.workshop_id)
    .first<{ member_id: string; created_at: number }>();
  if (existing && existing.member_id !== reviewer.id) {
    throw new HttpError(409, "submission_held");
  }
  const now = existing?.created_at ?? Date.now();
  await c.env.DB.prepare(
    `INSERT INTO workshop_review_holds(workshop_id, member_id, submission_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(workshop_id) DO NOTHING`,
  )
    .bind(sub.workshop_id, reviewer.id, sub.id, now)
    .run();
  const holderRow = await c.env.DB.prepare("SELECT COALESCE(NULLIF(display_name, ''), handle) AS name FROM members WHERE id = ?")
    .bind(reviewer.id)
    .first<{ name: string | null }>();
  const hold: HoldView = {
    holder: (holderRow?.name ?? "").slice(0, 80),
    at: now,
    byMe: true,
    canRelease: true,
  };
  return { ok: true, hold };
}

export async function unholdWorkshopSubmission(c: Ctx, submissionId: string) {
  const reviewer = await requireReviewer(c);
  const sub = await c.env.DB.prepare("SELECT * FROM workshop_review_submissions WHERE id = ?")
    .bind(submissionId)
    .first<WorkshopSubmissionRow>();
  if (!sub) throw new HttpError(404, "not_found");
  const hold = await c.env.DB.prepare("SELECT member_id FROM workshop_review_holds WHERE workshop_id = ?")
    .bind(sub.workshop_id)
    .first<{ member_id: string }>();
  if (!hold) return { ok: true, hold: null };
  const role = await reviewerRole(c.env.DB, reviewer.id);
  const isManager = role === "manager" || role === "owner" || (await communityAdmin(c));
  if (hold.member_id !== reviewer.id && !isManager) {
    throw new HttpError(403, "not_hold_owner");
  }
  await c.env.DB.prepare("DELETE FROM workshop_review_holds WHERE workshop_id = ?").bind(sub.workshop_id).run();
  return { ok: true, hold: null };
}

/**
 * 擴充審核詳情（對齊 interface-web.md §11）：
 * 未領取、本人作品（ownWorkshop=true）、限制級但審核員未驗年齡（ageVerificationRequired=true）皆回 200，
 * 讓網頁能在詳情頁呈現對應說明；未驗年齡時限制級內文遮蔽為空，不外洩成人內容。
 */
export async function workshopSubmissionDetail(c: Ctx, submissionId: string, lang: string) {
  const reviewer = await requireReviewer(c);
  const sub = await c.env.DB.prepare("SELECT * FROM workshop_review_submissions WHERE id = ?")
    .bind(submissionId)
    .first<WorkshopSubmissionRow>();
  if (!sub) throw new HttpError(404, "not_found");

  const card = await getCard(c.env.DB, String(sub.card_id));
  const nsfw = await memberNsfw(c.env.DB, reviewer.id);
  const adultTarget = sub.rating === "R" || Boolean(card && isAdult(card));
  if (adultTarget && nsfw.countryRegion === "CN") {
    throw new HttpError(404, "not_found");
  }

  const ownWorkshop = await isOwnWorkshopSubmission(c.env.DB, sub, reviewer);
  const ageVerificationRequired = adultTarget && nsfw.ageVerifiedAt === null;

  const now = Date.now();
  const claimValid = Boolean(sub.claimed_by && sub.claimed_at !== null && now - sub.claimed_at < CLAIM_TTL_MS);
  const claimedByMe = claimValid && sub.claimed_by === reviewer.id;
  const claim: "free" | "mine" | "other" = !claimValid ? "free" : claimedByMe ? "mine" : "other";

  const [ws, authorMember, stampsRes, earlierRow, holdRow, role, verRow] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM workshops WHERE id = ?").bind(sub.workshop_id).first<WorkshopRow>(),
    c.env.DB.prepare("SELECT handle, display_name FROM members WHERE id = ?")
      .bind(sub.author_member_id)
      .first<{ handle: string | null; display_name: string | null }>(),
    c.env.DB.prepare(
      "SELECT verdict, note, created_at, member_id FROM workshop_review_stamps WHERE submission_id = ? ORDER BY created_at ASC",
    )
      .bind(sub.id)
      .all<{ verdict: "approve" | "reject"; note: string; created_at: number; member_id: string }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM workshop_review_submissions
       WHERE workshop_id = ? AND status IN ('approved', 'rejected') AND submitted_at < ?`,
    )
      .bind(sub.workshop_id, sub.submitted_at)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT h.member_id, h.created_at, COALESCE(NULLIF(m.display_name, ''), m.handle) AS holder
       FROM workshop_review_holds h
       LEFT JOIN members m ON m.id = h.member_id
       WHERE h.workshop_id = ?`,
    )
      .bind(sub.workshop_id)
      .first<{ member_id: string; created_at: number; holder: string | null }>(),
    reviewerRole(c.env.DB, reviewer.id),
    c.env.DB.prepare("SELECT version_no FROM workshop_versions WHERE workshop_id = ? AND release_id = ?")
      .bind(sub.workshop_id, sub.sealed_release_id)
      .first<{ version_no: number }>(),
  ]);

  let releaseData: Awaited<ReturnType<typeof workshopUpstream.readRelease>> | null = null;
  if (!ageVerificationRequired) {
    try {
      releaseData = await workshopUpstream.readRelease(c.env, sub.sealed_release_id, sub.provider as ProviderId);
    } catch (err) {
      if (sub.status !== "pending" && err instanceof HttpError && err.status === 404) {
        releaseData = null;
      } else {
        throw err;
      }
    }
  }

  const prevVer =
    verRow?.version_no !== undefined
      ? Math.max(0, verRow.version_no - 1)
      : Math.max(0, Number(releaseData?.publishedVersion ?? ws?.version_no ?? 0));
  const targetVer = verRow?.version_no ?? prevVer + 1;

  const isManager = role === "manager" || role === "owner";
  const hold: HoldView | null = holdRow
    ? {
        holder: (holdRow.holder ?? "").slice(0, 80),
        at: holdRow.created_at,
        byMe: holdRow.member_id === reviewer.id,
        canRelease: holdRow.member_id === reviewer.id || isManager,
      }
    : null;

  const stamps = stampsRes.results.map((st) => ({
    verdict: st.verdict,
    note: st.note,
    at: st.created_at,
    mine: st.member_id === reviewer.id,
  }));

  const workshopObj = buildWorkshopContentObject({
    workshopId: sub.workshop_id,
    releaseId: sub.sealed_release_id,
    name: sub.name,
    summary: sub.summary,
    description: sub.readme,
    coverUrl: sub.cover_url || null,
    versionNo: targetVer,
    previousVersionNo: prevVer,
    updateNote: sub.update_note || null,
    residentChars: releaseData?.residentChars ?? sub.resident_chars,
    sealed: releaseData?.sealed ?? null,
    redacted: ageVerificationRequired,
    lang,
  });

  const cardName = card ? pickLocale(JSON.parse(card.names || "{}") as Localized, lang) : `#${sub.card_id}`;
  const cardRoleId = card ? card.approved_hosted_role_id || card.source_role_id : sub.source_role_id;

  return {
    subjectKind: "workshop" as const,
    submission: {
      id: sub.id,
      status: sub.status,
      submittedAt: sub.submitted_at,
      type: sub.kind === "re" ? ("update" as const) : ("first" as const),
      rating: sub.rating,
      claimedByMe,
      claim,
      stampedByMe: stamps.some((s) => s.mine),
      claimGeneration: sub.claim_generation,
      required: 1,
      hold,
      stamps,
      ownWorkshop,
      ageVerificationRequired,
      attempt: (earlierRow?.n ?? 0) + 1,
    },
    baseCard: {
      id: String(sub.card_id),
      roleId: cardRoleId,
      name: cardName,
      rating: card?.rating ?? null,
    },
    maker: {
      name: authorMember?.display_name || authorMember?.handle || `#${sub.author_num_id}`,
      handle: authorMember?.handle ?? null,
      accountNumId: sub.author_num_id,
    },
    workshop: workshopObj,
  };
}

async function finalizeDecidedWorkshopSubmission(env: Env, sub: WorkshopSubmissionRow) {
  const decision = sub.status === "approved" ? "approved" : "rejected";
  const opMetric = decision === "approved" ? "approve" : "reject";
  const operationId = await ensureOperationUuid(sub.id);

  let receipt;
  try {
    receipt = await workshopUpstream.commit(
      env,
      {
        workshopId: sub.workshop_id,
        releaseId: sub.sealed_release_id,
        operationId,
        decision,
        note: sub.note || undefined,
        expectedOwnerGeneration: sub.expected_owner_generation,
      },
      sub.provider as ProviderId,
    );
  } catch (err) {
    await bumpOp(env.DB, "workshop", opMetric, "error");
    throw err;
  }

  const now = Date.now();
  if (decision === "approved") {
    const existing = await env.DB.prepare("SELECT * FROM workshops WHERE id = ?")
      .bind(sub.workshop_id)
      .first<WorkshopRow>();
    const publishedAt = toEpochMs(receipt.publishedAt, now) ?? now;
    const existingVer = existing?.version_no ?? 0;
    const isStaleVersion = receipt.version < existingVer;
    const firstPublishedAt = existing?.first_published_at ?? publishedAt;
    const isFirstPublish = existingVer === 0 && receipt.version === 1;
    const dbOwner = normalizeDbOwnerState(receipt.ownerState);

    const stmts: D1PreparedStatement[] = [];
    if (!isStaleVersion) {
      stmts.push(
        env.DB.prepare(
          `UPDATE workshops SET
            name = ?, summary = ?, readme = ?, cover_url = ?, kinds = ?, rating = ?, rating_descriptors = ?,
            version_no = ?, approved_release_id = ?, content_hash = ?,
            resident_chars = ?, lore_count = ?, rule_count = ?, opening_count = ?,
            install_count = COALESCE(?, install_count),
            moderation_state = 'approved',
            owner_state = ?,
            owner_reason = IIF(? = 'visible', NULL, owner_reason),
            owner_acted_at = IIF(? = 'visible', NULL, owner_acted_at),
            owner_action_generation = ?,
            first_published_at = ?,
            published_at = ?,
            updated_at = ?
           WHERE id = ?`,
        ).bind(
          sub.name,
          sub.summary,
          sub.readme,
          sub.cover_url,
          sub.kinds,
          sub.rating,
          sub.rating_descriptors || "[]",
          receipt.version,
          sub.sealed_release_id,
          sub.content_hash,
          sub.resident_chars,
          sub.lore_count,
          sub.rule_count,
          sub.opening_count,
          receipt.joinCount ?? null,
          dbOwner,
          dbOwner,
          dbOwner,
          receipt.ownerGeneration ?? sub.expected_owner_generation,
          firstPublishedAt,
          publishedAt,
          now,
          sub.workshop_id,
        ),
      );
    }
    stmts.push(
      env.DB.prepare(
        `INSERT INTO workshop_versions(workshop_id, version_no, release_id, submission_id, update_note, rating, published_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workshop_id, release_id) DO UPDATE SET
           version_no = excluded.version_no,
           published_at = excluded.published_at`,
      ).bind(
        sub.workshop_id,
        receipt.version,
        sub.sealed_release_id,
        sub.id,
        sub.update_note,
        sub.rating,
        publishedAt,
        now,
      ),
    );
    const pubStmtIdx = stmts.length;
    stmts.push(
      env.DB.prepare(
        "UPDATE workshop_review_submissions SET publication_state = 'published' WHERE id = ? AND publication_state = 'decided'",
      ).bind(sub.id),
      env.DB.prepare("DELETE FROM workshop_review_holds WHERE workshop_id = ?").bind(sub.workshop_id),
    );

    const batchRes = await env.DB.batch(stmts);
    if ((batchRes[pubStmtIdx]?.meta?.changes ?? 0) > 0) {
      await bumpOp(env.DB, "workshop", opMetric, "success");
    }

    // 1) 審核結果通知製作者
    await insertWorkshopNotice(env.DB, {
      eventKey: `workshop_review_result:${sub.id}`,
      recipientMemberId: sub.author_member_id,
      kind: "workshop_review_result",
      path: `/mine/workshops/${sub.workshop_id}/edit?section=publish`,
      cardId: sub.card_id,
      workshopId: sub.workshop_id,
      extra: {
        workshopName: sub.name,
        status: "approved",
        ...(sub.note ? { note: sub.note } : {}),
      },
      now,
    });

    // 2) 首版 v1 上架且非原卡作者自建時，通知原卡作者
    if (isFirstPublish && sub.author_num_id !== sub.card_owner_num_id) {
      const cardOwnerMemberId = await findMemberIdByExternal(env.DB, sub.provider, sub.card_owner_num_id);
      if (cardOwnerMemberId && cardOwnerMemberId !== sub.author_member_id) {
        await insertWorkshopNotice(env.DB, {
          eventKey: `workshop_published:${sub.workshop_id}`,
          recipientMemberId: cardOwnerMemberId,
          kind: "workshop_published",
          path: `/workshops/${sub.workshop_id}`,
          actorMemberId: sub.author_member_id,
          cardId: sub.card_id,
          workshopId: sub.workshop_id,
          extra: { workshopName: sub.name },
          now,
        });
      }
    }
    return { status: "approved" as const, version: receipt.version };
  } else {
    const batchRes = await env.DB.batch([
      env.DB.prepare(
        "UPDATE workshops SET moderation_state = IIF(version_no > 0, 'approved', 'rejected'), updated_at = ? WHERE id = ?",
      ).bind(now, sub.workshop_id),
      env.DB.prepare(
        "UPDATE workshop_review_submissions SET publication_state = 'published' WHERE id = ? AND publication_state = 'decided'",
      ).bind(sub.id),
      env.DB.prepare("DELETE FROM workshop_review_holds WHERE workshop_id = ?").bind(sub.workshop_id),
    ]);
    if ((batchRes[1]?.meta?.changes ?? 0) > 0) {
      await bumpOp(env.DB, "workshop", opMetric, "success");
    }

    await insertWorkshopNotice(env.DB, {
      eventKey: `workshop_review_result:${sub.id}`,
      recipientMemberId: sub.author_member_id,
      kind: "workshop_review_result",
      path: `/mine/workshops/${sub.workshop_id}/edit?section=publish`,
      cardId: sub.card_id,
      workshopId: sub.workshop_id,
      extra: {
        workshopName: sub.name,
        status: "rejected",
        ...(sub.note ? { note: sub.note } : {}),
      },
      now,
    });
    return { status: "rejected" as const, version: receipt.version };
  }
}

export async function stampWorkshopSubmission(
  c: Ctx,
  submissionId: string,
  body: { verdict?: unknown; note?: unknown; generation?: unknown },
) {
  const reviewer = await requireReviewer(c);
  const verdict = body.verdict === "approve" ? "approve" : body.verdict === "reject" ? "reject" : null;
  if (!verdict) throw new HttpError(400, "invalid_verdict");
  const rawNote = typeof body.note === "string" ? body.note.trim() : "";
  if (rawNote.length > REVIEW_NOTE_MAX) throw new HttpError(400, "note_too_long");
  if (verdict === "reject" && !rawNote) throw new HttpError(400, "note_required");

  const { sub } = await loadPendingForReviewer(c.env.DB, submissionId, reviewer);
  if (sub.status !== "pending") {
    if (sub.publication_state === "decided") {
      const res = await finalizeDecidedWorkshopSubmission(c.env, sub);
      queuePush(c);
      return {
        id: sub.id,
        status: res.status,
        cardStatus: res.status,
        version: res.version,
        stamps: { approve: sub.status === "approved" ? 1 : 0, required: 1 },
      };
    }
    throw new HttpError(409, "submission_already_decided");
  }

  const now = Date.now();
  if (!sub.claimed_by || sub.claimed_by !== reviewer.id || !sub.claimed_at || sub.claimed_at <= now - CLAIM_TTL_MS) {
    throw new HttpError(409, "claim_required");
  }
  if (typeof body.generation === "string" && body.generation && body.generation !== sub.claim_generation) {
    throw new HttpError(409, "claim changed");
  }

  const hold = await c.env.DB.prepare("SELECT member_id FROM workshop_review_holds WHERE workshop_id = ?")
    .bind(sub.workshop_id)
    .first<{ member_id: string }>();
  if (hold && hold.member_id !== reviewer.id) {
    throw new HttpError(409, "submission_held");
  }

  const nextStatus = verdict === "approve" ? "approved" : "rejected";
  // Phase 1: durable local decision in D1 before calling Provider commit.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR REPLACE INTO workshop_review_stamps(submission_id, member_id, verdict, note, created_at, claim_generation)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(sub.id, reviewer.id, verdict, rawNote, now, sub.claim_generation),
    c.env.DB.prepare(
      `UPDATE workshop_review_submissions
       SET status = ?, publication_state = 'decided', decided_at = ?, note = ?
       WHERE id = ? AND status = 'pending'`,
    ).bind(nextStatus, now, rawNote, sub.id),
  ]);

  const decidedSub = await c.env.DB.prepare("SELECT * FROM workshop_review_submissions WHERE id = ?")
    .bind(sub.id)
    .first<WorkshopSubmissionRow>();
  if (!decidedSub) throw new HttpError(404, "not_found");

  // Phase 2: commit exact releaseId on Provider and project version_no to D1.
  const outcome = await finalizeDecidedWorkshopSubmission(c.env, decidedSub);
  queuePush(c);
  return {
    id: sub.id,
    status: outcome.status,
    cardStatus: outcome.status,
    version: outcome.version,
    stamps: { approve: verdict === "approve" ? 1 : 0, required: 1 },
  };
}

export async function reconcilePendingWorkshopCommits(env: Env): Promise<number> {
  const rows = (
    await env.DB.prepare(
      "SELECT * FROM workshop_review_submissions WHERE publication_state = 'decided' ORDER BY decided_at ASC LIMIT 20",
    ).all<WorkshopSubmissionRow>()
  ).results;
  let count = 0;
  for (const sub of rows) {
    try {
      await finalizeDecidedWorkshopSubmission(env, sub);
      count++;
    } catch {
      // Next scheduled cycle retries idempotently.
    }
  }
  return count;
}

async function requireHumanWorkshopManager(c: Ctx): Promise<Member> {
  const s = await staff(c);
  humanOnly(s.agent);
  const role = await reviewerRole(c.env.DB, s.member.id);
  const isManager = role === "manager" || role === "owner" || (await communityAdmin(c));
  if (!isManager) throw new HttpError(403, "manager_required");
  return s.member;
}

export async function countPendingWorkshopAppeals(db: D1Database, member: Member): Promise<number> {
  const nsfw = await memberNsfw(db, member.id);
  const allowAdult = nsfw.countryRegion !== "CN" && nsfw.ageVerifiedAt !== null ? 1 : 0;
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM workshop_appeals a
       LEFT JOIN workshops w ON w.id = a.workshop_id
       LEFT JOIN cards c ON c.id = a.card_id
       WHERE a.status = 'pending'
         AND COALESCE(a.creator_member_id, '') <> ?1
         AND NOT (a.provider = ?2 AND (a.creator_num_id = ?3 OR a.card_owner_num_id = ?3))
         AND NOT EXISTS (
           SELECT 1 FROM member_connections mc
           WHERE mc.owner_member_id = ?1 AND mc.provider = a.provider
             AND mc.external_id IN (CAST(a.creator_num_id AS TEXT), CAST(a.card_owner_num_id AS TEXT))
         )
         AND NOT EXISTS (
           SELECT 1 FROM member_identities mi
           WHERE mi.member_id = ?1 AND mi.provider = a.provider
             AND mi.external_id IN (CAST(a.creator_num_id AS TEXT), CAST(a.card_owner_num_id AS TEXT))
         )
         AND (?4 = 1 OR (COALESCE(w.rating, 'G') <> 'R' AND COALESCE(c.rating, 'G') <> 'R'))`,
    )
    .bind(member.id, member.provider, member.externalId, allowAdult)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * 站方申訴清單（對齊 interface-web.md §11）：一頁 30 筆，含 workshop、card、maker、owner、
 * ownerAction、ownerReason、ownerActedAt、appealReason、appealedAt、status、result、decidedAt、viewerRelation。
 */
export async function listWorkshopAppeals(
  c: Ctx,
  statusParam: string,
  offsetParam: number,
  lang: string,
) {
  const manager = await requireHumanWorkshopManager(c);
  const nsfw = await memberNsfw(c.env.DB, manager.id);
  const allowAdult = nsfw.countryRegion !== "CN" && nsfw.ageVerifiedAt !== null ? 1 : 0;
  const status = statusParam === "decided" ? "decided" : "pending";
  const offset = Math.max(0, Math.trunc(offsetParam || 0));
  const limit = 30;
  const whereSql =
    status === "pending"
      ? "a.status = 'pending'"
      : "a.status IN ('upheld','restored','revoked')";
  const rows = (
    await c.env.DB.prepare(
      `SELECT a.*,
              w.name AS workshop_name,
              w.cover_url AS workshop_cover,
              w.rating AS workshop_rating,
              c.names AS card_names,
              c.author_name AS card_author_name,
              c.rating AS card_rating,
              mm.id AS maker_member_id,
              mm.handle AS maker_handle,
              mm.display_name AS maker_display_name,
              om.id AS owner_member_id,
              om.handle AS owner_handle,
              om.display_name AS owner_display_name
       FROM workshop_appeals a
       LEFT JOIN workshops w ON w.id = a.workshop_id
       LEFT JOIN cards c ON c.id = a.card_id
       LEFT JOIN members mm ON mm.id = COALESCE(
         a.creator_member_id,
         w.author_member_id,
         (SELECT owner_member_id FROM member_connections mc0 WHERE mc0.provider = a.provider AND mc0.external_id = CAST(a.creator_num_id AS TEXT)),
         (SELECT member_id FROM member_identities mi WHERE mi.provider = a.provider AND mi.external_id = CAST(a.creator_num_id AS TEXT))
       )
       LEFT JOIN members om ON om.id = COALESCE(
         (SELECT owner_member_id FROM member_connections mc WHERE mc.provider = a.provider AND mc.external_id = CAST(a.card_owner_num_id AS TEXT)),
         (SELECT member_id FROM member_identities mi2 WHERE mi2.provider = a.provider AND mi2.external_id = CAST(a.card_owner_num_id AS TEXT))
       )
       WHERE ${whereSql}
         AND (? = 1 OR (COALESCE(w.rating, 'G') <> 'R' AND COALESCE(c.rating, 'G') <> 'R'))
       ORDER BY a.created_at ASC
       LIMIT ? OFFSET ?`,
    )
      .bind(allowAdult, limit + 1, offset)
      .all<{
        id: string;
        workshop_id: string;
        card_id: number;
        provider: string;
        work_id: string;
        creator_num_id: number;
        creator_member_id: string | null;
        card_owner_num_id: number;
        owner_state_snapshot: string;
        owner_reason_snapshot: string;
        owner_acted_at: number | null;
        owner_action_generation: number;
        appeal_reason: string;
        status: "pending" | "upheld" | "restored" | "revoked";
        decided_by: string | null;
        decision_reason: string | null;
        created_at: number;
        decided_at: number | null;
        workshop_name: string | null;
        workshop_cover: string | null;
        workshop_rating: string | null;
        card_names: string | null;
        card_author_name: string | null;
        card_rating: string | null;
        maker_member_id: string | null;
        maker_handle: string | null;
        maker_display_name: string | null;
        owner_member_id: string | null;
        owner_handle: string | null;
        owner_display_name: string | null;
      }>()
  ).results;

  const hasNext = rows.length > limit;
  return {
    items: rows.slice(0, limit).map((r) => {
      const isMaker =
        r.creator_member_id === manager.id ||
        r.maker_member_id === manager.id ||
        (r.provider === manager.provider && r.creator_num_id === manager.externalId);
      const isOwner =
        !isMaker &&
        (r.owner_member_id === manager.id ||
          (r.provider === manager.provider && r.card_owner_num_id === manager.externalId));
      const viewerRelation: "maker" | "owner" | null = isMaker ? "maker" : isOwner ? "owner" : null;
      const wireOwner = normalizeWireOwnerState(r.owner_state_snapshot);
      const ownerAction: "returned" | "hidden" = wireOwner === "returned" ? "returned" : "hidden";
      return {
        id: r.id,
        workshop: {
          id: r.workshop_id,
          name: r.workshop_name ?? "",
          coverUrl: r.workshop_cover ?? "",
        },
        card: {
          id: String(r.card_id),
          num: r.card_id,
          name: r.card_names ? pickLocale(JSON.parse(r.card_names) as Localized, lang) : `#${r.card_id}`,
        },
        maker: {
          handle: r.maker_handle ?? null,
          name: r.maker_display_name || r.maker_handle || `#${r.creator_num_id}`,
        },
        owner: {
          handle: r.owner_handle ?? null,
          name: r.owner_display_name || r.owner_handle || r.card_author_name || `#${r.card_owner_num_id}`,
        },
        ownerAction,
        ownerReason: r.owner_reason_snapshot,
        ownerActedAt: r.owner_acted_at ?? r.created_at,
        appealReason: r.appeal_reason,
        appealedAt: r.created_at,
        status: r.status === "pending" ? ("pending" as const) : ("decided" as const),
        result: r.status === "pending" ? null : r.status,
        decidedAt: r.decided_at,
        viewerRelation,
      };
    }),
    hasNext,
  };
}

/**
 * 站方查看完整擴充內容（PM 11-14 Q22，對齊 interface-web.md §11）：
 * 限人工 manager／owner，回傳與審核詳情相同的 workshop 內容物件供申訴頁「查看」展開。
 */
export async function getModerationWorkshopContent(
  c: Ctx,
  workshopId: string,
  lang = "zh-Hant",
): Promise<NormalizedWorkshopContent> {
  const manager = await requireHumanWorkshopManager(c);
  const ws = await c.env.DB.prepare("SELECT * FROM workshops WHERE id = ?")
    .bind(workshopId)
    .first<WorkshopRow>();
  const latestSub = await c.env.DB.prepare(
    "SELECT * FROM workshop_review_submissions WHERE workshop_id = ? ORDER BY submitted_at DESC LIMIT 1",
  )
    .bind(workshopId)
    .first<WorkshopSubmissionRow>();

  if (!ws && !latestSub) throw new HttpError(404, "not_found");

  const cardId = ws?.card_id ?? latestSub!.card_id;
  const card = await getCard(c.env.DB, String(cardId));
  const rating = ws?.rating ?? latestSub?.rating ?? null;
  if (rating === "R" || (card && isAdult(card))) {
    const nsfw = await memberNsfw(c.env.DB, manager.id);
    if (nsfw.countryRegion === "CN") throw new HttpError(404, "not_found");
    if (!nsfw.ageVerifiedAt) throw new HttpError(403, "age_verification_required");
  }

  const releaseId = ws?.approved_release_id ?? latestSub?.sealed_release_id ?? "";
  if (!releaseId) throw new HttpError(404, "not_found");

  const provider = (ws?.provider ?? latestSub!.provider) as ProviderId;
  const releaseData = await workshopUpstream.readRelease(c.env, releaseId, provider);
  const verNo = ws && ws.version_no > 0 ? ws.version_no : Math.max(1, Number(releaseData.publishedVersion ?? 0) + 1);
  const prevVerNo = Math.max(0, verNo - 1);

  const verNoteRow = await c.env.DB.prepare(
    "SELECT update_note FROM workshop_versions WHERE workshop_id = ? AND release_id = ?",
  )
    .bind(workshopId, releaseId)
    .first<{ update_note: string }>();

  return buildWorkshopContentObject({
    workshopId,
    releaseId,
    name: ws?.name ?? latestSub?.name ?? "",
    summary: ws?.summary ?? latestSub?.summary ?? "",
    description: ws?.readme ?? latestSub?.readme ?? "",
    coverUrl: (ws?.cover_url || latestSub?.cover_url) ?? null,
    versionNo: verNo,
    previousVersionNo: prevVerNo,
    updateNote: verNoteRow?.update_note ?? latestSub?.update_note ?? null,
    residentChars: releaseData.residentChars ?? ws?.resident_chars ?? latestSub?.resident_chars ?? 0,
    sealed: releaseData.sealed,
    lang,
  });
}

export async function decideWorkshopAppeal(
  c: Ctx,
  appealId: string,
  body: { decision?: unknown; reason?: unknown; operationId?: unknown },
) {
  const manager = await requireHumanWorkshopManager(c);
  const decision = body.decision === "upheld" ? "upheld" : body.decision === "restored" ? "restored" : null;
  if (!decision) throw new HttpError(400, "invalid_decision");
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
  if (!reason) throw new HttpError(400, "reason_required");
  const operationId = typeof body.operationId === "string" && body.operationId.trim() ? body.operationId.trim().slice(0, 100) : "";
  if (!operationId) throw new HttpError(400, "operation_id_required");

  const replayed = await c.env.DB.prepare(
    "SELECT subject_id, action FROM audit_log WHERE actor_member_id = ? AND operation_id = ?",
  )
    .bind(manager.id, operationId)
    .first<{ subject_id: string; action: string }>();
  if (replayed && replayed.subject_id === appealId) {
    return { ok: true, idempotent: true };
  }

  const appeal = await c.env.DB.prepare("SELECT * FROM workshop_appeals WHERE id = ?")
    .bind(appealId)
    .first<{
      id: string;
      workshop_id: string;
      card_id: number;
      provider: string;
      work_id: string;
      creator_num_id: number;
      creator_member_id: string | null;
      card_owner_num_id: number;
      owner_state_snapshot: string;
      owner_action_generation: number;
      status: string;
    }>();
  if (!appeal) throw new HttpError(404, "not_found");
  if (appeal.status !== "pending") throw new HttpError(409, "appeal_already_decided");

  const isOwnAppeal =
    appeal.creator_member_id === manager.id ||
    (await memberOwnsExternal(c.env.DB, manager, appeal.provider, appeal.creator_num_id)) ||
    (await memberOwnsExternal(c.env.DB, manager, appeal.provider, appeal.card_owner_num_id));
  if (isOwnAppeal) {
    await bumpOp(c.env.DB, "workshop", "appeal_decide", "denied");
    throw new HttpError(403, "cannot_decide_own_case");
  }

  const [ws, card] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM workshops WHERE id = ?").bind(appeal.workshop_id).first<WorkshopRow>(),
    getCard(c.env.DB, String(appeal.card_id)),
  ]);
  if (ws?.rating === "R" || (card && isAdult(card))) {
    const nsfw = await memberNsfw(c.env.DB, manager.id);
    if (nsfw.countryRegion === "CN") throw new HttpError(404, "not_found");
    if (!nsfw.ageVerifiedAt) throw new HttpError(403, "age_verification_required");
  }

  const syncRes = await workshopUpstream.appealDecision(
    c.env,
    {
      workshopId: appeal.workshop_id,
      decision,
      note: reason,
      actorPublicNo: manager.externalId,
    },
    appeal.provider as ProviderId,
  );

  const now = Date.now();
  const nextDbOwner = decision === "restored" ? "visible" : normalizeDbOwnerState(syncRes.ownerState ?? ws?.owner_state);
  const nextGen = Number(syncRes.ownerGeneration ?? (ws?.owner_action_generation ?? 0) + (decision === "restored" ? 1 : 0));

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE workshop_appeals
       SET status = ?, decided_by = ?, decision_reason = ?, operation_id = ?, sync_state = 'complete', decided_at = ?
       WHERE id = ? AND status = 'pending'`,
    ).bind(decision, manager.id, reason, operationId, now, appeal.id),
    c.env.DB.prepare(
      `UPDATE workshops
       SET appeal_state = ?, owner_state = ?,
           owner_reason = IIF(? = 'visible', NULL, owner_reason),
           owner_acted_at = IIF(? = 'visible', NULL, owner_acted_at),
           owner_action_generation = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(decision, nextDbOwner, nextDbOwner, nextDbOwner, nextGen, now, appeal.workshop_id),
    auditStmt(c.env.DB, {
      subjectKind: "workshop_appeal",
      subjectId: appeal.id,
      actorMemberId: manager.id,
      actorKind: "human",
      action: `workshop_appeal_${decision}`,
      reason,
      before: { status: appeal.status, ownerState: appeal.owner_state_snapshot },
      after: { status: decision, ownerState: normalizeWireOwnerState(nextDbOwner) },
      operationId,
      now,
    }),
  ]);

  const creatorMemberId =
    appeal.creator_member_id ??
    ws?.author_member_id ??
    (await findMemberIdByExternal(c.env.DB, appeal.provider, appeal.creator_num_id));
  if (creatorMemberId) {
    await insertWorkshopNotice(c.env.DB, {
      eventKey: `workshop_appeal_result:${appeal.id}`,
      recipientMemberId: creatorMemberId,
      kind: "workshop_appeal_result",
      path: `/mine/workshops/${appeal.workshop_id}/edit?section=publish`,
      cardId: appeal.card_id,
      workshopId: appeal.workshop_id,
      extra: {
        workshopName: ws?.name ?? "",
        decision,
      },
      now,
    });
    queuePush(c);
  }

  await bumpOp(c.env.DB, "workshop", "appeal_decide", "success");
  return { ok: true, status: decision, ownerState: normalizeWireOwnerState(nextDbOwner) };
}

export async function revokeWorkshopByStaff(
  c: Ctx,
  workshopId: string,
  body: { reason?: unknown; operationId?: unknown },
) {
  const manager = await requireHumanWorkshopManager(c);
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
  if (!reason) throw new HttpError(400, "reason_required");
  const operationId = typeof body.operationId === "string" && body.operationId.trim() ? body.operationId.trim().slice(0, 100) : "";
  if (!operationId) throw new HttpError(400, "operation_id_required");

  const replayed = await c.env.DB.prepare(
    "SELECT subject_id FROM audit_log WHERE actor_member_id = ? AND operation_id = ?",
  )
    .bind(manager.id, operationId)
    .first<{ subject_id: string }>();
  if (replayed && replayed.subject_id === workshopId) {
    return { ok: true, moderationState: "revoked" as const, idempotent: true };
  }

  const ws = await c.env.DB.prepare("SELECT * FROM workshops WHERE id = ?")
    .bind(workshopId)
    .first<WorkshopRow>();
  if (!ws) throw new HttpError(404, "not_found");
  const card = await getCard(c.env.DB, String(ws.card_id));
  if (ws.rating === "R" || (card && isAdult(card))) {
    const nsfw = await memberNsfw(c.env.DB, manager.id);
    if (nsfw.countryRegion === "CN") throw new HttpError(404, "not_found");
    if (!nsfw.ageVerifiedAt) throw new HttpError(403, "age_verification_required");
  }
  const isOwnTarget =
    ws.author_member_id === manager.id ||
    (await memberOwnsExternal(c.env.DB, manager, ws.provider, ws.author_num_id)) ||
    (card ? await memberOwnsExternal(c.env.DB, manager, ws.provider, card.author_num_id) : false);
  if (isOwnTarget) {
    await bumpOp(c.env.DB, "workshop", "revoke", "denied");
    throw new HttpError(403, "cannot_decide_own_case");
  }

  await workshopUpstream.moderate(
    c.env,
    {
      workshopId: ws.id,
      action: "revoke",
      reason,
      actorPublicNo: manager.externalId,
    },
    ws.provider as ProviderId,
  );

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE workshops SET moderation_state = 'revoked', appeal_state = IIF(appeal_state = 'pending', 'revoked', appeal_state), updated_at = ? WHERE id = ?",
    ).bind(now, ws.id),
    c.env.DB.prepare(
      `UPDATE workshop_appeals
       SET status = 'revoked', decided_by = ?, decision_reason = ?, operation_id = ?, sync_state = 'complete', decided_at = ?
       WHERE workshop_id = ? AND status = 'pending'`,
    ).bind(manager.id, reason, operationId, now, ws.id),
    auditStmt(c.env.DB, {
      subjectKind: "workshop",
      subjectId: ws.id,
      actorMemberId: manager.id,
      actorKind: "human",
      action: "workshop_revoke",
      reason,
      before: { moderationState: ws.moderation_state },
      after: { moderationState: "revoked" },
      operationId,
      now,
    }),
  ]);

  await bumpOp(c.env.DB, "workshop", "revoke", "success");
  return { ok: true, moderationState: "revoked" as const };
}
