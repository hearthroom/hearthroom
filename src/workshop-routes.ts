import { Hono, type Context } from "hono";
import { countTop, listReplies, listTop, postComment, sortOf, type Viewer } from "./comments";
import { queuePush } from "./community/push";
import { isHumanReviewer, requireMember } from "./members";
import { HttpError, type Env } from "./types";
import {
  applyWorkshopEvents,
  batchGetWorkshops,
  clearCardWorkshopInterest,
  commentWorkshopAt,
  drainProviderWorkshopOutbox,
  getWorkshopDetail,
  listCardWorkshops,
  listMyWorkshopCards,
  listMyWorkshops,
  listWorkshopVersions,
  setCardWorkshopInterest,
} from "./workshop";
import type { WorkshopOutboxEvent } from "./workshop-gateway";
import {
  decideWorkshopAppeal,
  getModerationWorkshopContent,
  listWorkshopAppeals,
  revokeWorkshopByStaff,
  submitWorkshop,
  withdrawWorkshop,
} from "./workshop-review";

const pageOf = (raw: string | undefined) => Math.min(500, Math.max(1, Math.floor(Number(raw)) || 1));

function langOf(c: Context<{ Bindings: Env }>): string {
  const q = c.req.query("lang");
  if (q) return q;
  const al = c.req.header("Accept-Language") ?? "";
  if (/zh-(?:cn|hans|sg)/i.test(al)) return "zh-Hans";
  if (/^ja\b/i.test(al)) return "ja";
  if (/^ko\b/i.test(al)) return "ko";
  if (/^en\b/i.test(al)) return "en";
  return "zh-Hant";
}

async function workshopCommentViewer(c: Context<{ Bindings: Env }>): Promise<Viewer> {
  if (!c.req.header("Authorization")) return { memberId: null, moderator: false };
  try {
    const member = await requireMember(c);
    return { memberId: member.id, moderator: await isHumanReviewer(c.env.DB, member.id) };
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) return { memberId: null, moderator: false };
    throw err;
  }
}

function assertHostingServiceKey(c: Context<{ Bindings: Env }>): void {
  const expected = new TextEncoder().encode(c.env.HOSTING_SERVICE_KEY ?? "");
  const actual = new TextEncoder().encode(c.req.header("X-Hosting-Key") ?? "");
  if (!expected.length || actual.length !== expected.length || !crypto.subtle.timingSafeEqual(expected, actual)) {
    throw new HttpError(401, "unauthorized");
  }
}

export const workshopRoutes = new Hono<{ Bindings: Env }>();

workshopRoutes.get("/v1/cards/:cardId/workshop", async (c) => {
  const res = await listCardWorkshops(c, c.req.param("cardId"), {
    sort: c.req.query("sort"),
    page: pageOf(c.req.query("page")),
    lang: langOf(c),
  });
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.put("/v1/cards/:cardId/workshop/interest", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { draftName?: unknown };
  const res = await setCardWorkshopInterest(c, c.req.param("cardId"), body.draftName);
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.delete("/v1/cards/:cardId/workshop/interest", async (c) => {
  const res = await clearCardWorkshopInterest(c, c.req.param("cardId"));
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.get("/v1/workshops", async (c) => {
  const raw = c.req.query("ids") ?? "";
  const ids = raw.split(",");
  const res = await batchGetWorkshops(c, ids);
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.get("/v1/workshops/:id", async (c) => {
  const res = await getWorkshopDetail(c, c.req.param("id"), langOf(c));
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.get("/v1/workshops/:id/versions", async (c) => {
  const res = await listWorkshopVersions(c, c.req.param("id"), pageOf(c.req.query("page")));
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.get("/v1/workshops/:id/comments", async (c) => {
  const { workshop, creatorMemberId } = await commentWorkshopAt(c, c.req.param("id"));
  const res = await listTop(
    c.env.DB,
    { kind: "workshop", workshop: { id: workshop.id, creatorMemberId } },
    await workshopCommentViewer(c),
    pageOf(c.req.query("page")),
    sortOf(c.req.query("sort")),
  );
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.get("/v1/workshops/:id/comments/count", async (c) => {
  const { workshop, creatorMemberId } = await commentWorkshopAt(c, c.req.param("id"));
  const count = await countTop(c.env.DB, { kind: "workshop", workshop: { id: workshop.id, creatorMemberId } });
  return c.json({ count }, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.get("/v1/workshops/:id/comments/:rootId/replies", async (c) => {
  const { workshop, creatorMemberId } = await commentWorkshopAt(c, c.req.param("id"));
  const res = await listReplies(
    c.env.DB,
    { kind: "workshop", workshop: { id: workshop.id, creatorMemberId } },
    c.req.param("rootId"),
    await workshopCommentViewer(c),
    pageOf(c.req.query("page")),
  );
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.post("/v1/workshops/:id/comments", async (c) => {
  const member = await requireMember(c);
  const { workshop, creatorMemberId } = await commentWorkshopAt(c, c.req.param("id"));
  const body = (await c.req.json().catch(() => ({}))) as { content?: unknown; parentId?: unknown; rootId?: unknown };
  const created = await postComment(c.env.DB, {
    target: { kind: "workshop", workshop: { id: workshop.id, creatorMemberId } },
    memberId: member.id,
    content: body.content,
    parentId: body.parentId,
    rootId: body.rootId,
    now: Date.now(),
  });
  queuePush(c);
  return c.json(created, 201, { "Cache-Control": "private, no-store" });
});

workshopRoutes.get("/v1/me/workshops", async (c) => {
  const res = await listMyWorkshops(c, langOf(c));
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.post("/v1/me/workshops/:id/submit", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { operationId?: unknown; updateNote?: unknown };
  const res = await submitWorkshop(c, c.req.param("id"), body);
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.post("/v1/me/workshops/:id/withdraw", async (c) => {
  const res = await withdrawWorkshop(c, c.req.param("id"));
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.get("/v1/me/workshop-cards", async (c) => {
  const res = await listMyWorkshopCards(c, c.req.query("q") ?? "", langOf(c));
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.get("/v1/moderation/workshop-appeals", async (c) => {
  const res = await listWorkshopAppeals(
    c,
    c.req.query("status") ?? "pending",
    Number(c.req.query("offset") ?? 0),
    langOf(c),
  );
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.post("/v1/moderation/workshop-appeals/:id/decision", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    decision?: unknown;
    reason?: unknown;
    operationId?: unknown;
  };
  const res = await decideWorkshopAppeal(c, c.req.param("id"), body);
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.post("/v1/moderation/workshops/:id/revoke", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown; operationId?: unknown };
  const res = await revokeWorkshopByStaff(c, c.req.param("id"), body);
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

workshopRoutes.get("/v1/moderation/workshops/:id/content", async (c) => {
  const res = await getModerationWorkshopContent(c, c.req.param("id"), langOf(c));
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

async function handleInternalWorkshopEvents(c: Context<{ Bindings: Env }>) {
  c.header("Cache-Control", "private, no-store");
  assertHostingServiceKey(c);
  const body = (await c.req.json().catch(() => ({}))) as { events?: unknown } & Record<string, unknown>;
  const events: WorkshopOutboxEvent[] = Array.isArray(body.events)
    ? (body.events as WorkshopOutboxEvent[])
    : typeof body.kind === "string"
      ? [body as unknown as WorkshopOutboxEvent]
      : [];
  const res = await applyWorkshopEvents(c.env, events);
  if (res.applied > 0) queuePush(c);
  return c.json({ ok: true, ...res }, 200);
}

async function handleInternalWorkshopSync(c: Context<{ Bindings: Env }>) {
  c.header("Cache-Control", "private, no-store");
  assertHostingServiceKey(c);
  const body = (await c.req.json().catch(() => ({}))) as { events?: unknown } & Record<string, unknown>;
  const pushed: WorkshopOutboxEvent[] = Array.isArray(body.events)
    ? (body.events as WorkshopOutboxEvent[])
    : typeof body.kind === "string"
      ? [body as unknown as WorkshopOutboxEvent]
      : [];
  let applied = 0;
  if (pushed.length > 0) {
    applied += (await applyWorkshopEvents(c.env, pushed)).applied;
  }
  const pulled = await drainProviderWorkshopOutbox(c.env);
  applied += pulled.applied;
  if (applied > 0) queuePush(c);
  return c.json({ ok: true, drained: pulled.drained, applied }, 200);
}

workshopRoutes.post("/internal/workshop/events", handleInternalWorkshopEvents);
workshopRoutes.post("/internal/workshop/sync", handleInternalWorkshopSync);
