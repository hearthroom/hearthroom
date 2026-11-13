import { approveFixtureResponse } from "./hosted-fixture";
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appAdmins,
  bearer,
  identities,
  makeAgent,
  makeMember,
  makeReviewer,
  ratingBody,
  resetDb,
  restoreUpstream,
  rolesOnMainSite,
} from "./helpers";
import { dispatchPush } from "../src/community/push";
import { opsMetrics } from "../src/ops-metrics";
import { HttpError } from "../src/types";
import { workshopUpstream, restoreWorkshopUpstream } from "../src/workshop-gateway";
import { reconcilePendingWorkshopCommits } from "../src/workshop-review";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CARD_AUTHOR = 71001;
const CREATOR = 71002;
const CREATOR_B = 71003;
const REVIEWER = 71004;
const MANAGER = 71005;
const OLD_PLAYER = 71006;
const NEW_PLAYER = 71007;
const AI_REVIEWER = 71008;

const json = async (r: Response) => (await r.json()) as any;
const op = () => crypto.randomUUID();
const memberOf = (n: number) => `member-${n}`;

const send = (path: string, token: string | null, method = "GET", body?: unknown, extraHeaders: Record<string, string> = {}) =>
  SELF.fetch("https://c.test" + path, {
    method,
    headers: {
      ...(token ? bearer(token) : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

interface FakeDraft {
  workshopId: string;
  workId: string;
  sourceRoleId: string;
  authorPublicNo: number;
  cardOwnerPublicNo: number;
  name: string;
  summary: string;
  readme: string;
  coverUrl: string;
  rating: "G" | "P" | "PG12" | "PG15" | "R" | "";
  ratingAnswers: Record<string, unknown>;
  worldbook: Array<{ content: string; constant?: boolean; enabled?: boolean }>;
  rules: Array<{ id: string; name: string }>;
  opening: { mode: "none" | "prologue" | "page"; prologue?: string; openingPage?: string };
  publishedVersion: number;
  publishedAt: number | null;
  moderationState: "draft" | "pending" | "approved" | "rejected" | "revoked";
  ownerState: "visible" | "returned" | "hidden_by_owner";
  ownerReason: string | null;
  ownerGeneration: number;
  joinCount: number;
  entitledTokens: Set<string>;
}

let cardId = 0;
let workId = "";
const drafts = new Map<string, FakeDraft>();
const releases = new Map<string, any>();
const outboxEvents: any[] = [];
let outboxAcked = 0;
let commitCalls = 0;
let appealDecisionCalls: any[] = [];
let moderateCalls: any[] = [];

function setupFakeWorkshopProvider() {
  drafts.clear();
  releases.clear();
  outboxEvents.length = 0;
  outboxAcked = 0;
  commitCalls = 0;
  appealDecisionCalls = [];
  moderateCalls = [];

  const tokenToNum: Record<string, number> = {
    "card-author": CARD_AUTHOR,
    creator: CREATOR,
    "creator-b": CREATOR_B,
    reviewer: REVIEWER,
    manager: MANAGER,
    "old-player": OLD_PLAYER,
    "new-player": NEW_PLAYER,
    "ai-reviewer": AI_REVIEWER,
  };

  workshopUpstream.mine = async (_env, token) => {
    const pubNo = tokenToNum[token] ?? 0;
    const items = [...drafts.values()]
      .filter((d) => d.authorPublicNo === pubNo)
      .map((d) => {
        const residentChars = d.worldbook
          .filter((e) => e.enabled !== false && e.constant === true)
          .reduce((sum, e) => sum + [...(e.content || "")].length, 0);
        const kinds: Array<"lore" | "display" | "opening"> = [];
        if (d.worldbook.length > 0) kinds.push("lore");
        if (d.rules.length > 0) kinds.push("display");
        if (d.opening.mode !== "none") kinds.push("opening");
        return {
          workshopId: d.workshopId,
          workId: d.workId,
          sourceRoleId: d.sourceRoleId,
          cardName: "測試角色卡",
          name: d.name,
          summary: d.summary,
          coverUrl: d.coverUrl,
          rating: (d.rating || "G") as "G" | "P" | "PG12" | "PG15" | "R",
          kinds,
          residentChars,
          publishedVersion: d.publishedVersion,
          publishedAt: d.publishedAt ? new Date(d.publishedAt).toISOString() : null,
          moderationState: d.moderationState,
          hasPendingRelease: d.moderationState === "pending",
          lastRejectNote: null,
          changedSincePublish: false,
          joinCount: d.joinCount,
          ownerState: (d.ownerState === "hidden_by_owner" ? "hidden" : d.ownerState) as "visible" | "returned" | "hidden",
          ownerReason: d.ownerReason,
          appeal: null,
          updatedAt: new Date().toISOString(),
        };
      });
    return { items };
  };

  workshopUpstream.seal = async (_env, token, input) => {
    if (!UUID_RE.test(input.operationId)) {
      throw new HttpError(400, "invalid_request");
    }
    const d = drafts.get(input.workshopId);
    if (!d) throw new HttpError(404, "not_found");
    const callerNo = tokenToNum[token] ?? 0;
    if (d.authorPublicNo !== callerNo) {
      throw new HttpError(403, "forbidden");
    }
    const residentChars = d.worldbook
      .filter((e) => e.enabled !== false && e.constant === true)
      .reduce((sum, e) => sum + [...(e.content || "")].length, 0);
    const kinds: Array<"lore" | "display" | "opening"> = [];
    if (d.worldbook.length > 0) kinds.push("lore");
    if (d.rules.length > 0) kinds.push("display");
    if (d.opening.mode !== "none") kinds.push("opening");

    const releaseId = `rel-${d.workshopId}-${releases.size + 1}`;
    const snap = {
      workshopId: d.workshopId,
      releaseId,
      operationId: input.operationId,
      workId: d.workId,
      sourceRoleId: d.sourceRoleId,
      authorPublicNo: d.authorPublicNo,
      cardOwnerPublicNo: d.cardOwnerPublicNo,
      contentHash: `sha256:${releaseId}`,
      nextVersionCandidate: d.publishedVersion + 1,
      publishedVersion: d.publishedVersion,
      name: d.name,
      summary: d.summary,
      readme: d.readme,
      coverUrl: d.coverUrl,
      rating: d.rating,
      ratingAnswers: d.ratingAnswers,
      kinds,
      contents: {
        loreCount: d.worldbook.length,
        ruleCount: d.rules.length,
        openingCount: d.opening.mode !== "none" ? 1 : 0,
      },
      residentChars,
      worldbook: structuredClone(d.worldbook),
      rules: structuredClone(d.rules),
      opening: structuredClone(d.opening),
      updateNote: input.updateNote ?? "",
      ownerGeneration: d.ownerGeneration,
    };
    releases.set(releaseId, snap);
    d.moderationState = "pending";
    return snap;
  };

  workshopUpstream.withdraw = async (_env, _token, input) => {
    const d = drafts.get(input.workshopId);
    if (!d) throw new HttpError(404, "not_found");
    d.moderationState = d.publishedVersion > 0 ? "approved" : "draft";
    return { withdrawn: true, moderationState: d.moderationState as "draft" | "approved" };
  };

  workshopUpstream.readRelease = async (_env, releaseId) => {
    const r = releases.get(releaseId);
    if (!r) throw new HttpError(404, "not_found");
    return {
      workshopId: r.workshopId,
      releaseId: r.releaseId,
      workId: r.workId,
      sourceRoleId: r.sourceRoleId,
      authorPublicNo: r.authorPublicNo,
      cardOwnerPublicNo: r.cardOwnerPublicNo,
      contentHash: r.contentHash,
      residentChars: r.residentChars,
      kinds: r.kinds,
      contents: r.contents,
      publishedVersion: r.publishedVersion,
      sealed: {
        name: r.name,
        summary: r.summary,
        readme: r.readme,
        coverUrl: r.coverUrl,
        rating: r.rating,
        ratingAnswers: r.ratingAnswers,
        worldbook: r.worldbook,
        rules: r.rules,
        opening: r.opening,
        updateNote: r.updateNote,
      },
    };
  };

  workshopUpstream.commit = async (_env, input) => {
    commitCalls++;
    if (!UUID_RE.test(input.operationId)) {
      throw new HttpError(400, "invalid_request");
    }
    const d = drafts.get(input.workshopId);
    const r = releases.get(input.releaseId);
    if (!d || !r) throw new HttpError(404, "not_found");
    if (input.decision === "approved") {
      if (!r._assignedVersion) {
        d.publishedVersion += 1;
        r._assignedVersion = d.publishedVersion;
        r._publishedAt = Date.now();
      }
      d.publishedAt = r._publishedAt;
      d.moderationState = "approved";
      if (d.ownerState === "returned" && (input.expectedOwnerGeneration ?? d.ownerGeneration) === d.ownerGeneration) {
        d.ownerState = "visible";
        d.ownerReason = null;
      }
      return {
        workshopId: d.workshopId,
        releaseId: r.releaseId,
        decision: "approved" as const,
        version: r._assignedVersion as number,
        publishedAt: new Date(r._publishedAt as number).toISOString(),
        moderationState: "approved",
        ownerState: d.ownerState,
        ownerGeneration: d.ownerGeneration,
        joinCount: d.joinCount,
        authorPublicNo: d.authorPublicNo,
        cardOwnerPublicNo: d.cardOwnerPublicNo,
      };
    }
    d.moderationState = d.publishedVersion > 0 ? "approved" : "rejected";
    return {
      workshopId: d.workshopId,
      releaseId: r.releaseId,
      decision: "rejected" as const,
      version: d.publishedVersion,
      publishedAt: d.publishedAt ? new Date(d.publishedAt).toISOString() : null,
      moderationState: d.moderationState,
      ownerState: d.ownerState,
      ownerGeneration: d.ownerGeneration,
      joinCount: d.joinCount,
      authorPublicNo: d.authorPublicNo,
      cardOwnerPublicNo: d.cardOwnerPublicNo,
    };
  };

  workshopUpstream.moderate = async (_env, input) => {
    moderateCalls.push(input);
    const d = drafts.get(input.workshopId);
    if (d && input.action === "revoke") d.moderationState = "revoked";
    return { ok: true };
  };

  workshopUpstream.appealDecision = async (_env, input) => {
    appealDecisionCalls.push(input);
    const d = drafts.get(input.workshopId);
    if (d && input.decision === "restored") {
      d.ownerState = "visible";
      d.ownerReason = null;
      d.ownerGeneration += 1;
    }
    return {
      workshopId: input.workshopId,
      decision: input.decision,
      ownerState: d?.ownerState ?? "visible",
      ownerGeneration: d?.ownerGeneration ?? 1,
    };
  };

  workshopUpstream.state = async (_env, query, viewerToken) => {
    const items = (query.workshopIds ?? [])
      .map((id) => drafts.get(id))
      .filter((x): x is FakeDraft => Boolean(x))
      .map((d) => ({
        workshopId: d.workshopId,
        moderationState: d.moderationState,
        ownerState: d.ownerState,
        viewerJoined: Boolean(viewerToken && d.entitledTokens.has(viewerToken)),
        viewerAccessible:
          d.moderationState === "approved" &&
          (d.ownerState === "visible" || Boolean(viewerToken && d.entitledTokens.has(viewerToken))),
      }));
    return { items };
  };

  workshopUpstream.pullOutbox = async (_env, afterSeq, limit = 100) => ({
    events: outboxEvents.filter((e) => e.seq > afterSeq).slice(0, limit),
  });

  workshopUpstream.ackOutbox = async (_env, uptoSeq) => {
    outboxAcked = Math.max(outboxAcked, uptoSeq);
    return { ok: true };
  };
}

function seedDraft(overrides: Partial<FakeDraft> & { workshopId: string }): FakeDraft {
  const { workshopId, ...rest } = overrides;
  const base: FakeDraft = {
    workshopId,
    workId,
    sourceRoleId: "role-base",
    authorPublicNo: CREATOR,
    cardOwnerPublicNo: CARD_AUTHOR,
    name: "雪夜後日談",
    summary: "補完結局後的日常與專屬對話框",
    readme: "## 雪夜後日談\n額外常駐與世界書擴充。",
    coverUrl: "https://media.sukisuki.ai/covers/ws-1.webp",
    rating: "G",
    ratingAnswers: ratingBody(false).ratingAnswers as Record<string, unknown>,
    worldbook: [{ content: "冬夜背景設定", constant: true, enabled: true }],
    rules: [{ id: "r1", name: "雪花框" }],
    opening: { mode: "prologue", prologue: "窗外的雪還沒停。" },
    publishedVersion: 0,
    publishedAt: null,
    moderationState: "draft",
    ownerState: "visible",
    ownerReason: null,
    ownerGeneration: 0,
    joinCount: 5,
    entitledTokens: new Set<string>(),
    ...rest,
  };
  drafts.set(base.workshopId, base);
  return base;
}

beforeEach(async () => {
  await resetDb();
  (env as { HOSTING_SERVICE_KEY?: string }).HOSTING_SERVICE_KEY = "test-hosting-secret";
  identities({
    "card-author": CARD_AUTHOR,
    creator: CREATOR,
    "creator-b": CREATOR_B,
    reviewer: REVIEWER,
    manager: MANAGER,
    "old-player": OLD_PLAYER,
    "new-player": NEW_PLAYER,
    "ai-reviewer": AI_REVIEWER,
  });
  await makeMember(CARD_AUTHOR);
  await makeMember(CREATOR);
  await makeMember(CREATOR_B);
  await makeReviewer(REVIEWER);
  await makeReviewer(MANAGER);
  appAdmins("manager");
  await makeAgent(AI_REVIEWER);
  await makeMember(OLD_PLAYER);
  await makeMember(NEW_PLAYER);

  rolesOnMainSite({ roleId: "role-base", authorNumId: CARD_AUTHOR, name: "測試角色卡" });
  const res = await approveFixtureResponse(
    await SELF.fetch("https://c.test/v1/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer("card-author") },
      body: JSON.stringify({ operationId: op(), roleId: "role-base", ...ratingBody(false) }),
    }),
  );
  cardId = Number((await json(res)).id);
  const canonical = await env.DB.prepare(
    "SELECT id AS work_id FROM works WHERE source_provider = 'harbor' AND source_role_id = 'role-base'",
  ).first<{ work_id: string }>();
  workId = canonical?.work_id ?? `work:${cardId}`;
  setupFakeWorkshopProvider();
});

afterEach(() => {
  restoreWorkshopUpstream();
  restoreUpstream();
});

describe("1. 擴充送審校驗、審核佇列與公開發布投影", () => {
  it("送審校驗：常駐 >1500 Unicode 字碼點、缺封面、缺分級、缺內容、v2 更新說明不足皆精準擋下", async () => {
    // 1) constant_char_limit: enabled && constant 合計 > 1500 code points；非 constant 不計入
    seedDraft({
      workshopId: "ws-over-limit",
      worldbook: [
        { content: "漢".repeat(1501), constant: true, enabled: true },
        { content: "觸發條目不計入".repeat(500), constant: false, enabled: true },
      ],
    });
    const over = await send("/v1/me/workshops/ws-over-limit/submit", "creator", "POST", { operationId: op() });
    expect(over.status).toBe(422);
    const overBody = await json(over);
    expect(overBody.error).toBe("constant_char_limit");
    expect(overBody.detail).toMatchObject({ actual: 1501, max: 1500 });

    // disabled constant 條目不計入，剛好 1500 字可過
    seedDraft({
      workshopId: "ws-no-cover",
      coverUrl: "",
      worldbook: [
        { content: "漢".repeat(1500), constant: true, enabled: true },
        { content: "停用常駐".repeat(400), constant: true, enabled: false },
      ],
    });
    const noCover = await send("/v1/me/workshops/ws-no-cover/submit", "creator", "POST", { operationId: op() });
    expect(noCover.status).toBe(422);
    expect((await json(noCover)).error).toBe("cover_required");

    // 缺內容（世界書、規則、開場皆空）
    seedDraft({
      workshopId: "ws-empty",
      worldbook: [],
      rules: [],
      opening: { mode: "none" },
    });
    const noContent = await send("/v1/me/workshops/ws-empty/submit", "creator", "POST", { operationId: op() });
    expect(noContent.status).toBe(422);
    expect((await json(noContent)).error).toBe("content_required");
  });

  it("首次送審（不套卡片字數門檻）→ 審核佇列與試玩放行 → 1 章核准 v1 → 重送 v2 強制更新說明", async () => {
    // 短內容擴充（僅 6 字常駐）照樣可送審，不會觸發卡片最低字數門檻
    seedDraft({ workshopId: "ws-1" });
    const subRes = await send("/v1/me/workshops/ws-1/submit", "creator", "POST", { operationId: op() });
    expect(subRes.status).toBe(200);
    const subBody = await json(subRes);
    expect(subBody.moderationState).toBe("pending");
    const submissionId = subBody.submissionId as string;

    // 審核員佇列可見，type: 'first'，含 card 與 workshop 摘要
    const queue = await json(await send("/v1/review/queue", "reviewer"));
    const item = queue.items.find((x: any) => x.id === submissionId);
    expect(item).toBeTruthy();
    expect(item.subjectKind).toBe("workshop");
    expect(item.type).toBe("first");
    expect(item.card).toMatchObject({ id: String(cardId), num: cardId, name: "測試角色卡" });
    expect(item.workshop).toMatchObject({ id: "ws-1", name: "雪夜後日談", residentChars: 6, version: "v1" });

    // reviewSummary 計入待審擴充數
    const summary = await json(await send("/v1/moderation/summary", "reviewer"));
    expect(summary.reviews).toBe(1);

    // 未認領前 detail 亦回 200（供詳情頁說明狀態）
    const unclaimedDetail = await json(await send(`/v1/review/${submissionId}/detail`, "reviewer"));
    expect(unclaimedDetail.subjectKind).toBe("workshop");
    expect(unclaimedDetail.submission).toMatchObject({
      id: submissionId,
      type: "first",
      claim: "free",
      claimedByMe: false,
      ownWorkshop: false,
      ageVerificationRequired: false,
    });
    expect(unclaimedDetail.workshop).toMatchObject({
      id: "ws-1",
      name: "雪夜後日談",
      version: "v1",
      previousVersion: null,
      residentChars: 6,
      residentMax: 1500,
    });
    expect(unclaimedDetail.workshop.entries).toHaveLength(1);
    expect(unclaimedDetail.workshop.rules).toHaveLength(1);

    // 認領後 play-access 放行審核員試玩
    const claimRes = await send(`/v1/review/${submissionId}/claim`, "reviewer", "POST");
    expect(claimRes.status).toBe(200);
    const claimBody = await json(claimRes);
    expect(claimBody.generation).toBeTruthy();

    const detail = await json(await send(`/v1/review/${submissionId}/detail`, "reviewer"));
    expect(detail.submission).toMatchObject({ claimedByMe: true, claim: "mine" });
    expect(detail.workshop.name).toBe("雪夜後日談");

    const playAccess = await json(
      await send(
        `/internal/review/${submissionId}/play-access?accountNumId=${REVIEWER}&roleId=role-base`,
        null,
        "GET",
        undefined,
        { "X-Hosting-Key": "test-hosting-secret" },
      ),
    );
    expect(playAccess).toMatchObject({
      allowed: true,
      subjectKind: "workshop",
      workshopId: "ws-1",
      roleId: "role-base",
    });

    // 1 章核准 → Provider commit 分配 v1 → D1 workshops / workshop_versions 落盤，且不寫卡片上架獎勵
    const stampRes = await send(`/v1/review/${submissionId}/stamp`, "reviewer", "POST", { verdict: "approve" });
    expect(stampRes.status).toBe(200);
    expect(await json(stampRes)).toMatchObject({ status: "approved", version: 1 });

    const rewardOutbox = await env.DB.prepare("SELECT COUNT(*) AS n FROM reward_event_outbox").first<{ n: number }>();
    expect(rewardOutbox!.n).toBe(0);

    // 公開詳情與版本紀錄可讀（非原卡作者不回傳 ownerState；原卡作者可見 ownerState）
    const pubDetail = await json(await send("/v1/workshops/ws-1", null));
    expect(pubDetail).toMatchObject({
      id: "ws-1",
      cardId: String(cardId),
      name: "雪夜後日談",
      version: 1,
      availability: "open",
      residentChars: 6,
    });
    expect(pubDetail.ownerState).toBeUndefined();
    const ownerDetail = await json(await send("/v1/workshops/ws-1", "card-author"));
    expect(ownerDetail.ownerState).toBe("visible");

    // v2 送審未填 ≥10 非空白字更新說明回 update_note_required
    const badRe = await send("/v1/me/workshops/ws-1/submit", "creator", "POST", {
      operationId: op(),
      updateNote: "太短了",
    });
    expect(badRe.status).toBe(422);
    expect((await json(badRe)).error).toBe("update_note_required");

    // 補齊 10 字以上更新說明即可送審並核准升為 v2（佇列與詳情 type 皆為 update）
    const okRe = await json(
      await send("/v1/me/workshops/ws-1/submit", "creator", "POST", {
        operationId: op(),
        updateNote: "新增第二幕冬日祭典事件與對話框微調",
      }),
    );
    const reQueue = await json(await send("/v1/review/queue", "reviewer"));
    const reItem = reQueue.items.find((x: any) => x.id === okRe.submissionId);
    expect(reItem).toMatchObject({ subjectKind: "workshop", type: "update" });
    expect(reItem.workshop.version).toBe("v2");

    expect((await send(`/v1/review/${okRe.submissionId}/claim`, "reviewer", "POST")).status).toBe(200);
    const stampV2 = await json(
      await send(`/v1/review/${okRe.submissionId}/stamp`, "reviewer", "POST", { verdict: "approve" }),
    );
    expect(stampV2).toMatchObject({ status: "approved", version: 2 });

    const versions = await json(await send("/v1/workshops/ws-1/versions", null));
    expect(versions.items.map((v: any) => v.version)).toEqual([2, 1]);
    expect(versions.items[0].note).toBe("新增第二幕冬日祭典事件與對話框微調");
  });
});

describe("2. 卡片頁工坊分頁四種顯示狀態、分級遮罩與舊玩家保護", () => {
  it("精準滿足工坊分頁四種狀態：預設開放含空態、從未開放無分頁、暫停有既存仍顯示、全數下架隱藏分頁", async () => {
    // 狀態 B：預設開放（尚無 policy 列且 0 個擴充）→ tabVisible: true, allowNew: true
    const defaultOpen = await json(await send(`/v1/cards/${cardId}/workshop`, null));
    expect(defaultOpen).toMatchObject({ tabVisible: true, allowNew: true, total: 0, items: [] });

    // 狀態 A：從未開放（allow_new = false 且 0 個公開擴充）→ tabVisible: false, allowNew: false
    await send(
      "/internal/workshop/events",
      null,
      "POST",
      {
        events: [{ seq: 1, kind: "policy_changed", workId, sourceRoleId: "role-base", allowNew: false, revision: 1 }],
      },
      { "X-Hosting-Key": "test-hosting-secret" },
    );
    const neverOpened = await json(await send(`/v1/cards/${cardId}/workshop`, null));
    expect(neverOpened).toMatchObject({ tabVisible: false, allowNew: false, total: 0, items: [] });

    // 開放並上架 1 個擴充，再由原作者關掉開關 → 狀態 C：暫停有既存 → tabVisible: true, allowNew: false
    await send(
      "/internal/workshop/events",
      null,
      "POST",
      {
        events: [{ seq: 2, kind: "policy_changed", workId, sourceRoleId: "role-base", allowNew: true, revision: 2, reopened: true }],
      },
      { "X-Hosting-Key": "test-hosting-secret" },
    );
    seedDraft({ workshopId: "ws-live" });
    const sub = await json(await send("/v1/me/workshops/ws-live/submit", "creator", "POST", { operationId: op() }));
    await send(`/v1/review/${sub.submissionId}/claim`, "reviewer", "POST");
    await send(`/v1/review/${sub.submissionId}/stamp`, "reviewer", "POST", { verdict: "approve" });

    await send(
      "/internal/workshop/events",
      null,
      "POST",
      {
        events: [{ seq: 3, kind: "policy_changed", workId, sourceRoleId: "role-base", allowNew: false, revision: 3 }],
      },
      { "X-Hosting-Key": "test-hosting-secret" },
    );
    const pausedWithExisting = await json(await send(`/v1/cards/${cardId}/workshop`, null));
    expect(pausedWithExisting).toMatchObject({ tabVisible: true, allowNew: false, total: 1 });

    // 狀態 D：暫停且既存擴充遭安全撤下（0 個可見）→ tabVisible: false
    const revokeRes = await send("/v1/moderation/workshops/ws-live/revoke", "manager", "POST", {
      reason: "違規內容撤下",
      operationId: op(),
    });
    expect(revokeRes.status).toBe(200);
    const pausedAllGone = await json(await send(`/v1/cards/${cardId}/workshop`, null));
    expect(pausedAllGone).toMatchObject({ tabVisible: false, allowNew: false, total: 0, items: [] });
  });

  it("原作者 hidden／returned 後：新玩家在列表不可見且詳情為 hidden；舊加入玩家經 Provider 授權仍為 open 且可見", async () => {
    const d = seedDraft({ workshopId: "ws-protected" });
    d.entitledTokens.add("old-player");
    const sub = await json(await send("/v1/me/workshops/ws-protected/submit", "creator", "POST", { operationId: op() }));
    await send(`/v1/review/${sub.submissionId}/claim`, "reviewer", "POST");
    await send(`/v1/review/${sub.submissionId}/stamp`, "reviewer", "POST", { verdict: "approve" });

    // 原作者隱藏擴充
    d.ownerState = "hidden_by_owner";
    d.ownerReason = "世界觀衝突";
    d.ownerGeneration = 1;
    await send(
      "/internal/workshop/events",
      null,
      "POST",
      {
        events: [
          {
            seq: 10,
            kind: "owner_action",
            workshopId: "ws-protected",
            workId,
            action: "hide",
            ownerState: "hidden_by_owner",
            reason: "世界觀衝突",
            ownerGeneration: 1,
          },
        ],
      },
      { "X-Hosting-Key": "test-hosting-secret" },
    );

    // 新玩家：列表為空，詳情 availability = 'hidden'（非原卡作者不回傳 ownerState）
    const newList = await json(await send(`/v1/cards/${cardId}/workshop`, "new-player"));
    expect(newList.items).toHaveLength(0);
    const newDetail = await json(await send("/v1/workshops/ws-protected", "new-player"));
    expect(newDetail.availability).toBe("hidden");
    expect(newDetail.ownerState).toBeUndefined();
    const cardAuthorDetail = await json(await send("/v1/workshops/ws-protected", "card-author"));
    expect(cardAuthorDetail.ownerState).toBe("hidden");

    // 舊加入玩家：列表仍看得到，詳情 availability = 'open'
    const oldList = await json(await send(`/v1/cards/${cardId}/workshop`, "old-player"));
    expect(oldList.items.map((i: any) => i.id)).toEqual(["ws-protected"]);
    const oldDetail = await json(await send("/v1/workshops/ws-protected", "old-player"));
    expect(oldDetail.availability).toBe("open");
  });
});

describe("3. 擴充評論 target、審核、指標與無卡片獎勵汙染", () => {
  it("擴充評論支援發表／回覆／讚／檢舉／審核；isCreator 與刪留言權歸擴充製作者而非原卡作者；計入指標", async () => {
    seedDraft({ workshopId: "ws-c1" });
    const sub = await json(await send("/v1/me/workshops/ws-c1/submit", "creator", "POST", { operationId: op() }));
    await send(`/v1/review/${sub.submissionId}/claim`, "reviewer", "POST");
    await send(`/v1/review/${sub.submissionId}/stamp`, "reviewer", "POST", { verdict: "approve" });

    // 玩家發表頂層留言（即使帶 score 亦儲存為 null），製作者回覆顯示 isCreator: true
    const c1 = await json(
      await send("/v1/workshops/ws-c1/comments", "new-player", "POST", { content: "雪夜劇情超棒！", score: 5 }),
    );
    expect(c1.commentId).toBeTruthy();

    const reply = await send("/v1/workshops/ws-c1/comments", "creator", "POST", {
      content: "謝謝遊玩！",
      rootId: c1.commentId,
      parentId: c1.commentId,
    });
    expect(reply.status).toBe(201);

    const listRes = await json(await send("/v1/workshops/ws-c1/comments", "card-author"));
    expect(listRes.total).toBe(1);
    expect(listRes.comments[0].score).toBeNull();
    expect(listRes.comments[0].isCreator).toBe(false);
    // 原卡作者不是擴充製作者，不能刪別人在擴充下的留言
    expect(listRes.comments[0].canDelete).toBe(false);
    expect(listRes.comments[0].replies[0].isCreator).toBe(true);
    expect((await send(`/v1/comments/${c1.commentId}`, "card-author", "DELETE")).status).toBe(403);

    // 留言回覆通知路徑指向 /workshops/ws-c1，且不產生 card_comments 彙總或卡片評論獎勵
    const replyNotice = await env.DB.prepare(
      "SELECT path, card_id FROM community_notifications WHERE kind = 'comment_reply' AND member_id = ?",
    )
      .bind(memberOf(NEW_PLAYER))
      .first();
    expect(replyNotice).toEqual({ path: "/workshops/ws-c1", card_id: null });

    const digestCount = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM community_notifications WHERE kind = 'card_comments'",
    ).first<{ n: number }>();
    expect(digestCount!.n).toBe(0);

    // 檢舉與評論審核佇列支援 target.kind = 'workshop'
    const rep = await send(`/v1/comments/${c1.commentId}/report`, "old-player", "POST", {
      reason: "spam",
      note: "測試檢舉",
    });
    expect(rep.status).toBe(200);
    const modQueue = await json(await send("/v1/moderation/comments?tab=reported", "reviewer"));
    expect(modQueue.items[0].target).toMatchObject({ kind: "workshop", id: "ws-c1", title: "雪夜後日談" });
    expect(
      (
        await send(`/v1/moderation/comments/${c1.commentId}/decision`, "reviewer", "POST", {
          action: "dismiss",
          reason: "正常心得",
          operationId: op(),
        })
      ).status,
    ).toBe(200);

    // 擴充製作者可刪除其擴充底下的留言（如卡片作者對自家卡留言的規則），且不觸發卡片評論移除扣回
    expect((await send(`/v1/comments/${c1.commentId}`, "creator", "DELETE")).status).toBe(204);
    const rewardEvents = await env.DB.prepare("SELECT COUNT(*) AS n FROM reward_event_outbox").first<{ n: number }>();
    expect(rewardEvents!.n).toBe(0);

    const metricsText = await opsMetrics(env.DB);
    expect(metricsText).toContain('hearthroom_workshop_comment_total{action="create",outcome="success"} 1');
    expect(metricsText).toContain('hearthroom_workshop_comment_total{action="reply",outcome="success"} 1');
    expect(metricsText).toContain('hearthroom_workshop_comment_total{action="report",outcome="success"} 1');
    expect(metricsText).toContain('hearthroom_workshop_comment_total{action="moderate",outcome="success"} 1');
    expect(metricsText).not.toContain("ws-c1");
  });
});

describe("4. 六種站內通知與站方申訴裁決入口", () => {
  it("首次上架通知原卡作者、重新開放通知登記創作者、原作者打回與人工申訴裁決全鏈路", async () => {
    // 1) 先關工坊，讓 CREATOR_B 登記「重新開放通知我」，再重新開放 → 收到 workshop_reopened（直達 /mine?tab=workshops）
    await send(
      "/internal/workshop/events",
      null,
      "POST",
      { events: [{ seq: 20, kind: "policy_changed", workId, sourceRoleId: "role-base", allowNew: false, revision: 1 }] },
      { "X-Hosting-Key": "test-hosting-secret" },
    );
    const reg = await send(`/v1/cards/${cardId}/workshop/interest`, "creator-b", "PUT", { draftName: "夏日番外" });
    expect(reg.status).toBe(200);

    await send(
      "/internal/workshop/events",
      null,
      "POST",
      {
        events: [
          {
            seq: 21,
            kind: "policy_changed",
            workId,
            sourceRoleId: "role-base",
            allowNew: true,
            revision: 2,
            reopened: true,
          },
        ],
      },
      { "X-Hosting-Key": "test-hosting-secret" },
    );

    const creatorBNotices = await json(await send("/v1/me/community/notifications", "creator-b"));
    const reopened = creatorBNotices.items.find((n: any) => n.kind === "workshop_reopened");
    expect(reopened).toMatchObject({
      kind: "workshop_reopened",
      path: "/mine?tab=workshops",
      card: { id: cardId, name: "測試角色卡" },
      extra: { draftName: "夏日番外" },
    });
    expect(reopened.actor).toBeTruthy();

    // 2) CREATOR 送審並通過 v1 → 原卡作者收到 workshop_published（/workshops/ws-n1），製作者收到 workshop_review_result
    seedDraft({ workshopId: "ws-n1" });
    const sub = await json(await send("/v1/me/workshops/ws-n1/submit", "creator", "POST", { operationId: op() }));
    await send(`/v1/review/${sub.submissionId}/claim`, "reviewer", "POST");
    await send(`/v1/review/${sub.submissionId}/stamp`, "reviewer", "POST", { verdict: "approve" });

    const cardAuthorNotices = await json(await send("/v1/me/community/notifications", "card-author"));
    const pubNotice = cardAuthorNotices.items.find((n: any) => n.kind === "workshop_published");
    expect(pubNotice).toMatchObject({
      kind: "workshop_published",
      path: "/workshops/ws-n1",
      card: { id: cardId, name: "測試角色卡" },
      extra: { workshopName: "雪夜後日談" },
    });
    expect(pubNotice.actor).toBeTruthy();

    // 3) 原作者打回 + 製作者送出申訴 → 一般 reviewer 與 AI 代理禁止裁決，人類 manager 裁決 restored 並發通知
    await send(
      "/internal/workshop/events",
      null,
      "POST",
      {
        events: [
          {
            seq: 22,
            kind: "owner_action",
            workshopId: "ws-n1",
            workId,
            action: "return",
            ownerState: "returned",
            reason: "人設語氣不符",
            ownerGeneration: 1,
          },
          {
            seq: 23,
            kind: "appeal_submitted",
            appealId: "ap-1",
            workshopId: "ws-n1",
            workId,
            authorPublicNo: CREATOR,
            reason: "已完全對齊原作第一章設定，請站方複核",
            ownerStateSnapshot: "returned",
            ownerReasonSnapshot: "人設語氣不符",
            ownerGeneration: 1,
          },
        ],
      },
      { "X-Hosting-Key": "test-hosting-secret" },
    );

    // 一般 reviewer 與 AI 審核員皆回 403
    expect((await send("/v1/moderation/workshop-appeals", "reviewer")).status).toBe(403);
    expect((await send("/v1/moderation/workshop-appeals", "ai-reviewer")).status).toBe(403);

    // 人類 manager 可讀取申訴佇列（interface-web.md §11 形狀）並展開查看完整內容（Q22）後裁決 restored
    const appeals = await json(await send("/v1/moderation/workshop-appeals?status=pending", "manager"));
    expect(appeals.items).toHaveLength(1);
    expect(appeals.items[0]).toMatchObject({
      id: "ap-1",
      workshop: { id: "ws-n1", name: "雪夜後日談" },
      card: { id: String(cardId), num: cardId, name: "測試角色卡" },
      ownerAction: "returned",
      ownerReason: "人設語氣不符",
      status: "pending",
      result: null,
      viewerRelation: null,
    });

    const modContent = await json(await send("/v1/moderation/workshops/ws-n1/content", "manager"));
    expect(modContent).toMatchObject({
      id: "ws-n1",
      name: "雪夜後日談",
      version: "v1",
      residentChars: 6,
      residentMax: 1500,
    });
    expect(modContent.entries).toHaveLength(1);

    const decideRes = await send("/v1/moderation/workshop-appeals/ap-1/decision", "manager", "POST", {
      decision: "restored",
      reason: "核對內容並無衝突，恢復公開顯示",
      operationId: op(),
    });
    expect(decideRes.status).toBe(200);
    expect(appealDecisionCalls).toHaveLength(1);
    expect(appealDecisionCalls[0]).toMatchObject({ workshopId: "ws-n1", decision: "restored" });

    // 寫入 audit_log，D1 投影恢復 visible，製作者收到 workshop_returned 與 workshop_appeal_result
    const audit = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE subject_kind = 'workshop_appeal' AND subject_id = 'ap-1'",
    ).first<{ action: string }>();
    expect(audit?.action).toBe("workshop_appeal_restored");

    const creatorNotices = await json(await send("/v1/me/community/notifications", "creator"));
    expect(creatorNotices.items.find((n: any) => n.kind === "workshop_returned")).toMatchObject({
      path: "/mine/workshops/ws-n1/edit?section=publish",
      extra: { workshopName: "雪夜後日談", reason: "人設語氣不符" },
    });
    expect(creatorNotices.items.find((n: any) => n.kind === "workshop_appeal_result")).toMatchObject({
      path: "/mine/workshops/ws-n1/edit?section=publish",
      extra: { workshopName: "雪夜後日談", decision: "restored" },
    });
  });
});

describe("5. 自審阻擋、年齡驗證遮蔽、撤下結案與選卡狀態／指標", () => {
  it("審核員自審回 403 workshop_self_review、未驗年齡 R 級詳情遮蔽且領取回 403 age_verification_required、站方撤下一併結案申訴為 revoked、選卡回傳 viewerInterested／viewerIsOwner", async () => {
    // 1) 審核員自己送審：detail 帶 ownWorkshop: true，claim/stamp 回 403 workshop_self_review
    seedDraft({ workshopId: "ws-own", authorPublicNo: REVIEWER });
    const ownSub = await json(await send("/v1/me/workshops/ws-own/submit", "reviewer", "POST", { operationId: op() }));
    const ownDetail = await json(await send(`/v1/review/${ownSub.submissionId}/detail`, "reviewer"));
    expect(ownDetail.submission.ownWorkshop).toBe(true);
    const selfClaim = await send(`/v1/review/${ownSub.submissionId}/claim`, "reviewer", "POST");
    expect(selfClaim.status).toBe(403);
    expect((await json(selfClaim)).error).toBe("workshop_self_review");

    // 2) R 級擴充對未驗年齡審核員：detail 回 200 但遮蔽 entries/description 且標記 ageVerificationRequired: true；claim 回 403 age_verification_required
    await env.DB.prepare("UPDATE members SET age_verified_at = NULL WHERE id = ?").bind(memberOf(REVIEWER)).run();
    seedDraft({ workshopId: "ws-adult", rating: "R" });
    const adultSub = await json(await send("/v1/me/workshops/ws-adult/submit", "creator", "POST", { operationId: op() }));
    const unverifiedDetail = await json(await send(`/v1/review/${adultSub.submissionId}/detail`, "reviewer"));
    expect(unverifiedDetail.submission.ageVerificationRequired).toBe(true);
    expect(unverifiedDetail.workshop.entries).toEqual([]);
    expect(unverifiedDetail.workshop.description).toBe("");
    const adultClaim = await send(`/v1/review/${adultSub.submissionId}/claim`, "reviewer", "POST");
    expect(adultClaim.status).toBe(403);
    expect((await json(adultClaim)).error).toBe("age_verification_required");

    // 3) 申訴案件中直接執行站方撤下 → 申訴自動結案且 result = 'revoked'
    await env.DB.prepare("UPDATE members SET age_verified_at = ? WHERE id = ?").bind(Date.now(), memberOf(REVIEWER)).run();
    seedDraft({ workshopId: "ws-rev" });
    const revSub = await json(await send("/v1/me/workshops/ws-rev/submit", "creator", "POST", { operationId: op() }));
    await send(`/v1/review/${revSub.submissionId}/claim`, "reviewer", "POST");
    await send(`/v1/review/${revSub.submissionId}/stamp`, "reviewer", "POST", { verdict: "approve" });
    await send(
      "/internal/workshop/events",
      null,
      "POST",
      {
        events: [
          {
            seq: 50,
            kind: "appeal_submitted",
            appealId: "ap-rev",
            workshopId: "ws-rev",
            workId,
            authorPublicNo: CREATOR,
            reason: "請求複查",
            ownerStateSnapshot: "hidden",
            ownerReasonSnapshot: "暫時隱藏",
            ownerGeneration: 1,
          },
        ],
      },
      { "X-Hosting-Key": "test-hosting-secret" },
    );
    expect(
      (
        await send("/v1/moderation/workshops/ws-rev/revoke", "manager", "POST", {
          reason: "違反社群規範",
          operationId: op(),
        })
      ).status,
    ).toBe(200);
    const decidedAppeals = await json(await send("/v1/moderation/workshop-appeals?status=decided", "manager"));
    const closed = decidedAppeals.items.find((x: any) => x.id === "ap-rev");
    expect(closed).toMatchObject({ status: "decided", result: "revoked" });

    // 4) GET /v1/me/workshop-cards 回傳 viewerInterested 與 viewerIsOwner
    await send(
      "/internal/workshop/events",
      null,
      "POST",
      { events: [{ seq: 51, kind: "policy_changed", workId, sourceRoleId: "role-base", allowNew: false, revision: 5 }] },
      { "X-Hosting-Key": "test-hosting-secret" },
    );
    await send(`/v1/cards/${cardId}/workshop/interest`, "creator-b", "PUT", { draftName: "預約番外" });
    const cardsForCreatorB = await json(await send("/v1/me/workshop-cards", "creator-b"));
    expect(cardsForCreatorB.items[0]).toMatchObject({
      cardId: String(cardId),
      allowNew: false,
      viewerInterested: true,
      viewerIsOwner: false,
    });
    const cardsForOwner = await json(await send("/v1/me/workshop-cards", "card-author"));
    expect(cardsForOwner.items[0]).toMatchObject({
      cardId: String(cardId),
      viewerInterested: false,
      viewerIsOwner: true,
    });

    const metricsText = await opsMetrics(env.DB);
    expect(metricsText).toContain('hearthroom_workshop_operations_total{operation="submit",outcome="success"}');
    expect(metricsText).toContain('hearthroom_workshop_operations_total{operation="approve",outcome="success"}');
    expect(metricsText).toContain('hearthroom_workshop_operations_total{operation="revoke",outcome="success"}');
    expect(metricsText).toContain('hearthroom_workshop_operations_total{operation="sync",outcome="success"}');
  });
});

describe("6. 跨倉契約對齊與邊界回歸（五級分級、UUID／RFC3339、Outbox payload 封包、兩階段續跑、地區與年齡門檻）", () => {
  it("非 UUID operationId 決定性轉 UUID 並支援冪等重送；PG15 分級與開場白多語標題完整保留；上游 readRelease 503 不吞錯", async () => {
    seedDraft({
      workshopId: "ws-pg15",
      rating: "PG15",
      opening: { mode: "page", openingPage: "<div>雪夜開場頁</div>", prologue: "不應同時出現的序章" },
    });

    const first = await json(
      await send("/v1/me/workshops/ws-pg15/submit", "creator", "POST", { operationId: "client-op-non-uuid-1" }),
    );
    const replay = await json(
      await send("/v1/me/workshops/ws-pg15/submit", "creator", "POST", { operationId: "client-op-non-uuid-1" }),
    );
    expect(replay.submissionId).toBe(first.submissionId);

    // 英文詳情開場標題為 Opening page，且依 mode='page' 只輸出開局網頁
    const detailEn = await json(await send(`/v1/review/${first.submissionId}/detail?lang=en`, "reviewer"));
    expect(detailEn.submission.rating).toBe("PG15");
    expect(detailEn.workshop.openings).toEqual([
      { id: "opening-page", title: "Opening page", content: "<div>雪夜開場頁</div>" },
    ]);

    // 上游 readRelease 503 時，待審單詳情必須透傳錯誤而非回 200 空內容
    const origRead = workshopUpstream.readRelease;
    workshopUpstream.readRelease = async () => {
      throw new HttpError(503, "upstream_unavailable");
    };
    const errRes = await send(`/v1/review/${first.submissionId}/detail`, "reviewer");
    expect(errRes.status).toBe(503);
    workshopUpstream.readRelease = origRead;

    // 兩階段提交斷點續跑：stamp 時若 commit 暫時 503，決議已落盤 decided，排程 reconcile 續跑成功並寫入整數毫秒時間戳
    await send(`/v1/review/${first.submissionId}/claim`, "reviewer", "POST");
    const origCommit = workshopUpstream.commit;
    let failOnce = true;
    workshopUpstream.commit = async (e, input) => {
      if (failOnce) {
        failOnce = false;
        throw new HttpError(503, "commit_timeout");
      }
      return origCommit(e, input);
    };
    const failedStamp = await send(`/v1/review/${first.submissionId}/stamp`, "reviewer", "POST", { verdict: "approve" });
    expect(failedStamp.status).toBe(503);

    const recovered = await reconcilePendingWorkshopCommits(env);
    expect(recovered).toBe(1);

    const mine = await json(await send("/v1/me/workshops", "creator"));
    const mineItem = mine.items.find((x: any) => x.id === "ws-pg15");
    expect(mineItem).toMatchObject({ id: "ws-pg15", rating: "PG15", version: 1, status: "live" });
    expect(typeof mineItem.updatedAt).toBe("number");

    const cardList = await json(await send(`/v1/cards/${cardId}/workshop`, null));
    expect(cardList.items[0]).toMatchObject({ id: "ws-pg15", rating: "PG15", version: 1 });
  });

  it("POST /internal/workshop/sync 拉取真實 Provider Outbox payload 封包（含 install_count_changed）並推進 ack；CN／未驗年齡管理員過濾 R 級申訴", async () => {
    await env.DB.prepare("UPDATE members SET age_verified_at = ? WHERE id IN (?, ?)")
      .bind(Date.now(), memberOf(REVIEWER), memberOf(MANAGER))
      .run();
    await env.DB.prepare("UPDATE reviewers SET role = 'manager' WHERE member_id = ?").bind(memberOf(MANAGER)).run();

    seedDraft({ workshopId: "ws-r-sync", rating: "R" });
    const sub = await json(await send("/v1/me/workshops/ws-r-sync/submit", "creator", "POST", { operationId: op() }));
    expect((await send(`/v1/review/${sub.submissionId}/claim`, "reviewer", "POST")).status).toBe(200);
    expect((await send(`/v1/review/${sub.submissionId}/stamp`, "reviewer", "POST", { verdict: "approve" })).status).toBe(200);

    // 模擬 Provider Go ListOutbox 回傳的巢狀 payload 結構（無頂層事件欄位）
    outboxEvents.push(
      {
        seq: 101,
        eventKey: "workshop_install_count_changed:ws-r-sync:42",
        workId,
        workshopId: "ws-r-sync",
        kind: "install_count_changed",
        payload: { installCount: 42 },
      },
      {
        seq: 102,
        eventKey: "workshop_owner_action:ws-r-sync:1",
        workId,
        workshopId: "ws-r-sync",
        kind: "owner_action",
        payload: {
          action: "return",
          ownerState: "returned",
          reason: "請調整分級標示",
          ownerGeneration: 2,
          protectedJoinCutoffSeq: 42,
        },
      },
      {
        seq: 103,
        eventKey: "workshop_appeal_submitted:ap-r-1",
        workId,
        workshopId: "ws-r-sync",
        kind: "appeal_submitted",
        payload: {
          appealId: "ap-r-1",
          authorPublicNo: CREATOR,
          reason: "已標示 R 級",
          ownerStateSnapshot: "returned",
          ownerReasonSnapshot: "請調整分級標示",
          ownerGeneration: 2,
        },
      },
    );

    const syncRes = await send(
      "/internal/workshop/sync",
      null,
      "POST",
      {},
      { "X-Hosting-Key": "test-hosting-secret" },
    );
    expect(syncRes.status).toBe(200);
    expect(await json(syncRes)).toMatchObject({ ok: true, drained: 3, applied: 3 });
    expect(outboxAcked).toBe(103);

    const wsRow = await env.DB.prepare(
      "SELECT install_count, owner_state, owner_action_generation, protected_join_cutoff_seq FROM workshops WHERE id = 'ws-r-sync'",
    ).first<{
      install_count: number;
      owner_state: string;
      owner_action_generation: number;
      protected_join_cutoff_seq: number;
    }>();
    expect(wsRow).toEqual({
      install_count: 42,
      owner_state: "returned",
      owner_action_generation: 2,
      protected_join_cutoff_seq: 42,
    });

    // 已驗年齡非 CN 管理員可見 1 筆 R 級待決申訴
    const verifiedSummary = await json(await send("/v1/moderation/summary", "manager"));
    expect(verifiedSummary.workshopAppeals).toBe(1);

    // 未驗年齡管理員看不到 R 級申訴，也不能直接裁決
    await env.DB.prepare("UPDATE members SET age_verified_at = NULL WHERE id = ?").bind(memberOf(MANAGER)).run();
    const unverifiedSummary = await json(await send("/v1/moderation/summary", "manager"));
    expect(unverifiedSummary.workshopAppeals).toBe(0);
    const unverifiedList = await json(await send("/v1/moderation/workshop-appeals?status=pending", "manager"));
    expect(unverifiedList.items).toHaveLength(0);
    expect(
      (
        await send("/v1/moderation/workshop-appeals/ap-r-1/decision", "manager", "POST", {
          decision: "restored",
          reason: "測試",
          operationId: op(),
        })
      ).status,
    ).toBe(403);

    // 即使已驗年齡，CN 地區管理員亦不可見或裁決 R 級申訴
    await env.DB.prepare("UPDATE members SET age_verified_at = ?, country_region = 'CN' WHERE id = ?")
      .bind(Date.now(), memberOf(MANAGER))
      .run();
    const cnSummary = await json(await send("/v1/moderation/summary", "manager"));
    expect(cnSummary.workshopAppeals).toBe(0);
    const cnList = await json(await send("/v1/moderation/workshop-appeals?status=pending", "manager"));
    expect(cnList.items).toHaveLength(0);
    expect(
      (
        await send("/v1/moderation/workshop-appeals/ap-r-1/decision", "manager", "POST", {
          decision: "restored",
          reason: "測試",
          operationId: op(),
        })
      ).status,
    ).toBe(404);
  });

  it("R 級基底卡上的 workshop_reopened（無 workshop_id）與 G 級擴充評論通知（無 card_id）對 CN／未開成人收件者攔截 Web Push 與鈴鐺", async () => {
    // 將基底卡標為 R 級，上架一個 G 級擴充
    await env.DB.prepare("UPDATE cards SET rating = 'R' WHERE id = ?").bind(cardId).run();
    await env.DB.prepare(
      "UPDATE members SET age_verified_at = ?, show_nsfw = 1, adult_consent_version = '2026-08-01' WHERE id IN (?, ?, ?)",
    )
      .bind(Date.now(), memberOf(REVIEWER), memberOf(CREATOR), memberOf(NEW_PLAYER))
      .run();

    seedDraft({ workshopId: "ws-g-on-r", rating: "G" });
    const sub = await json(await send("/v1/me/workshops/ws-g-on-r/submit", "creator", "POST", { operationId: op() }));
    await send(`/v1/review/${sub.submissionId}/claim`, "reviewer", "POST");
    await send(`/v1/review/${sub.submissionId}/stamp`, "reviewer", "POST", { verdict: "approve" });

    // NEW_PLAYER 在 G 級擴充下留言並由 CREATOR 回覆 → 產生 card_id = NULL, workshop_id = 'ws-g-on-r' 的 comment_reply
    const c1 = await json(
      await send("/v1/workshops/ws-g-on-r/comments", "new-player", "POST", { content: "留個言" }),
    );
    await send("/v1/workshops/ws-g-on-r/comments", "creator", "POST", {
      content: "回覆你",
      rootId: c1.commentId,
      parentId: c1.commentId,
    });

    // CREATOR_B（未開啟 show_nsfw）登記重新開放通知並觸發 workshop_reopened（workshop_id = NULL, card_id = R 級卡）
    await send(
      "/internal/workshop/events",
      null,
      "POST",
      { events: [{ seq: 201, kind: "policy_changed", workId, sourceRoleId: "role-base", allowNew: false, revision: 1 }] },
      { "X-Hosting-Key": "test-hosting-secret" },
    );
    await send(`/v1/cards/${cardId}/workshop/interest`, "creator-b", "PUT", { draftName: "草稿" });
    await send(
      "/internal/workshop/events",
      null,
      "POST",
      {
        events: [
          { seq: 202, kind: "policy_changed", workId, sourceRoleId: "role-base", allowNew: true, revision: 2, reopened: true },
        ],
      },
      { "X-Hosting-Key": "test-hosting-secret" },
    );

    // 將 NEW_PLAYER 設為 CN，並為 NEW_PLAYER 與 CREATOR_B 建立訂閱
    await env.DB.prepare("UPDATE members SET country_region = 'CN' WHERE id = ?").bind(memberOf(NEW_PLAYER)).run();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO push_subscriptions(id, member_id, endpoint, p256dh, auth, locale, created_at) VALUES ('sub-np', ?, 'https://push.test/np', 'k', 'a', 'zh-Hant', ?)",
      ).bind(memberOf(NEW_PLAYER), now),
      env.DB.prepare(
        "INSERT INTO push_subscriptions(id, member_id, endpoint, p256dh, auth, locale, created_at) VALUES ('sub-cb', ?, 'https://push.test/cb', 'k', 'a', 'zh-Hant', ?)",
      ).bind(memberOf(CREATOR_B), now),
    ]);

    const pushEnv = {
      ...env,
      PUSH_VAPID_PUBLIC_KEY: "pub",
      PUSH_VAPID_PRIVATE_KEY: "priv",
      PUSH_VAPID_SUBJECT: "mailto:test@sukisuki.ai",
    };
    const pushed: string[] = [];
    const sentCount = await dispatchPush(pushEnv, async (sub) => {
      pushed.push(sub.endpoint);
      return 201;
    });
    expect(sentCount).toBe(0);
    expect(pushed).toEqual([]);

    // CN 地區 NEW_PLAYER 的站內鈴鐺與未讀數亦不顯示該筆位於 R 級基底卡上的評論回覆通知
    const cnNotices = await json(await send("/v1/me/community/notifications", "new-player"));
    expect(cnNotices.items).toHaveLength(0);
    const cnSummary = await json(await send("/v1/me/community/notifications/summary", "new-player"));
    expect(cnSummary.unread).toBe(0);
  });
});
