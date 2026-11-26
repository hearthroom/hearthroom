import type { Context } from 'hono';
import { auditStmt } from './audit';
import { getCard, isAdult } from './cards';
import { memberNsfw, reviewerRole, type Member } from './members';
import { bumpOp } from './ops-metrics';
import type { ProviderId } from './providers';
import { communityAdmin, humanOnly, staff } from './staff';
import { HttpError, type Env } from './types';
import { memberOwnsExternal, type WorkshopRow } from './workshop';
import { workshopResidentLimit } from '../shared/workshop-resident.mjs';
import { workshopUpstream } from './workshop-gateway';
type Ctx = Pick<Context<{
    Bindings: Env;
}>, 'env' | 'req' | 'executionCtx'>;
function parseJsonArray<T>(raw: string | null | undefined): T[] {
    if (!raw)
        return [];
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? (v as T[]) : [];
    }
    catch {
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
    residentMax: number;
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
            residentMax: input.residentMax,
            entries: [],
            rules: [],
            openings: [],
        };
    }
    const sealed = input.sealed ?? {};
    const rawWb = Array.isArray(sealed.worldbook)
        ? sealed.worldbook
        : sealed.worldbook && typeof sealed.worldbook === "object" && Array.isArray((sealed.worldbook as {
            entries?: unknown;
        }).entries)
            ? ((sealed.worldbook as {
                entries: unknown[];
            }).entries)
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
        : sealed.rules && typeof sealed.rules === "object" && Array.isArray((sealed.rules as {
            rules?: unknown;
        }).rules)
            ? ((sealed.rules as {
                rules: unknown[];
            }).rules)
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
    const openings: Array<{
        id: string;
        title: string;
        content: string;
    }> = [];
    if (Array.isArray(sealed.openings)) {
        for (let i = 0; i < sealed.openings.length; i++) {
            const o = (sealed.openings[i] ?? {}) as Record<string, unknown>;
            openings.push({
                id: String(o.id ?? `opening-${i + 1}`),
                title: String(o.title ?? ""),
                content: String(o.content ?? ""),
            });
        }
    }
    else if (sealed.opening && typeof sealed.opening === "object") {
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
            }
            else if (Array.isArray(op.prologue)) {
                const joined = op.prologue
                    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
                    .join("\n\n");
                if (joined)
                    openings.push({ id: "prologue", title: titles.prologue, content: joined });
            }
        };
        if (mode === "page") {
            pushPage();
        }
        else if (mode === "prologue") {
            pushPrologue();
        }
        else if (mode === "greeting" || mode === "welcome") {
            pushWelcomeAndAlts();
        }
        else {
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
        coverUrl: typeof sealed.coverUrl === "string" && sealed.coverUrl
            ? sealed.coverUrl
            : input.coverUrl || null,
        version: `v${Math.max(1, input.versionNo)}`,
        previousVersion: input.previousVersionNo > 0 ? `v${input.previousVersionNo}` : null,
        updateNote: typeof sealed.updateNote === "string" && sealed.updateNote
            ? sealed.updateNote
            : input.updateNote || null,
        residentChars: input.residentChars,
        residentMax: input.residentMax,
        entries,
        rules,
        openings,
    };
}
async function requireHumanWorkshopManager(c: Ctx): Promise<Member> {
    const s = await staff(c);
    humanOnly(s.agent);
    const role = await reviewerRole(c.env.DB, s.member.id);
    const isManager = role === "manager" || role === "owner" || (await communityAdmin(c));
    if (!isManager)
        throw new HttpError(403, "manager_required");
    return s.member;
}
export async function getModerationWorkshopContent(c: Ctx, workshopId: string, lang = "zh-Hant"): Promise<NormalizedWorkshopContent> {
    const manager = await requireHumanWorkshopManager(c);
    const ws = await c.env.DB.prepare("SELECT * FROM workshops WHERE id = ?")
        .bind(workshopId)
        .first<WorkshopRow>();
    if (!ws)
        throw new HttpError(404, "not_found");
    const card = await getCard(c.env.DB, String(ws.card_id));
    if (ws.rating === "R" || (card && isAdult(card))) {
        const nsfw = await memberNsfw(c.env.DB, manager.id);
        if (nsfw.countryRegion === "CN")
            throw new HttpError(404, "not_found");
        if (!nsfw.ageVerifiedAt)
            throw new HttpError(403, "age_verification_required");
    }
    const releaseId = ws.approved_release_id;
    if (!releaseId)
        throw new HttpError(404, "not_found");
    const provider = ws.provider as ProviderId;
    const releaseData = await workshopUpstream.readRelease(c.env, releaseId, provider);
    const verNo = ws && ws.version_no > 0 ? ws.version_no : Math.max(1, Number(releaseData.publishedVersion ?? 0) + 1);
    const prevVerNo = Math.max(0, verNo - 1);
    const verNoteRow = await c.env.DB.prepare("SELECT update_note FROM workshop_versions WHERE workshop_id = ? AND release_id = ?")
        .bind(workshopId, releaseId)
        .first<{
        update_note: string;
    }>();
    return buildWorkshopContentObject({
        workshopId,
        releaseId,
        name: ws.name,
        summary: ws.summary,
        description: ws.readme,
        coverUrl: ws.cover_url || null,
        versionNo: verNo,
        previousVersionNo: prevVerNo,
        updateNote: verNoteRow?.update_note ?? null,
        residentChars: releaseData.residentChars ?? ws.resident_chars ?? 0,
        residentMax: workshopResidentLimit((releaseData.cardOwnerPublicNo ?? card?.author_num_id) === ws.author_num_id ? "dlc" : "lorebook"),
        sealed: releaseData.sealed,
        lang,
    });
}
export async function revokeWorkshopByStaff(c: Ctx, workshopId: string, body: {
    reason?: unknown;
    operationId?: unknown;
}) {
    const manager = await requireHumanWorkshopManager(c);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
    if (!reason)
        throw new HttpError(400, "reason_required");
    const operationId = typeof body.operationId === "string" && body.operationId.trim() ? body.operationId.trim().slice(0, 100) : "";
    if (!operationId)
        throw new HttpError(400, "operation_id_required");
    const replayed = await c.env.DB.prepare("SELECT subject_id FROM audit_log WHERE actor_member_id = ? AND operation_id = ?")
        .bind(manager.id, operationId)
        .first<{
        subject_id: string;
    }>();
    if (replayed && replayed.subject_id === workshopId) {
        return { ok: true, moderationState: "revoked" as const, idempotent: true };
    }
    const ws = await c.env.DB.prepare("SELECT * FROM workshops WHERE id = ?")
        .bind(workshopId)
        .first<WorkshopRow>();
    if (!ws)
        throw new HttpError(404, "not_found");
    const card = await getCard(c.env.DB, String(ws.card_id));
    if (ws.rating === "R" || (card && isAdult(card))) {
        const nsfw = await memberNsfw(c.env.DB, manager.id);
        if (nsfw.countryRegion === "CN")
            throw new HttpError(404, "not_found");
        if (!nsfw.ageVerifiedAt)
            throw new HttpError(403, "age_verification_required");
    }
    const isOwnTarget = ws.author_member_id === manager.id ||
        (await memberOwnsExternal(c.env.DB, manager, ws.provider, ws.author_num_id)) ||
        (card ? await memberOwnsExternal(c.env.DB, manager, ws.provider, card.author_num_id) : false);
    if (isOwnTarget) {
        await bumpOp(c.env.DB, "workshop", "revoke", "denied");
        throw new HttpError(403, "cannot_decide_own_case");
    }
    await workshopUpstream.moderate(c.env, {
        workshopId: ws.id,
        action: "revoke",
        reason,
        actorPublicNo: manager.externalId,
    }, ws.provider as ProviderId);
    const now = Date.now();
    await c.env.DB.batch([
        c.env.DB.prepare("UPDATE workshops SET moderation_state = 'revoked', updated_at = ? WHERE id = ?").bind(now, ws.id),
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
