import { createExecutionContext, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { getCard, upsertCard } from "../src/cards";
import { hostGateway, submitHosted } from "../src/hosting";
import { opsMetrics } from "../src/ops-metrics";
import { upstream } from "../src/upstream";
import { countPresetTags, hasPresetTag, TAG_CATALOG, TAG_GROUPS } from "../shared/tag-catalog";
import { bearer, GENERAL_RATING, identities, identitiesFor, makeMember, ratingBody, resetDb, restoreUpstream, role, rolesOnMainSite } from "./helpers";

beforeEach(resetDb);
afterEach(() => {
  vi.restoreAllMocks();
  restoreUpstream();
});

async function visibilityRequest(path: string, token = "owner", body?: unknown) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("https://c.test" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { ...env, HOSTING_SERVICE_KEY: "fixture-issuer", WORK_SHARING_ENABLED: "true" },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

async function managedVisibilityFixture(tags: string[], unmanaged = false, portrait = "https://assets.test/cover.png", approvedPortrait = portrait) {
  const source = crypto.randomUUID();
  const work = crypto.randomUUID();
  const approved = crypto.randomUUID();
  const member = await makeMember(11);
  identitiesFor({ harbor: { owner: 11 } });
  await upsertCard(env.DB, {...role({ roleId: source, authorNumId: 11, tags }),backgroundUrl:portrait,avatarUrl:portrait}, Date.now(), { status: "unshared" });
  const card = (await getCard(env.DB, source))!;
  await env.DB.prepare("UPDATE cards SET approved_hosted_role_id=?,approved_version_id=? WHERE id=?").bind(approved, crypto.randomUUID(), card.id).run();
  await env.DB.prepare("INSERT INTO works VALUES(?,?,?,?,?)").bind(work, member, "harbor", source, Date.now()).run();
  await env.DB.prepare("INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,approved_role_id) VALUES(?,'harbor',?,'private',2,'none',?)").bind(work, source, approved).run();
  await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at,decided_at) VALUES(?,?,'harbor',?,'initial','approved',1,2)").bind(crypto.randomUUID(), card.id, source).run();
  const current = {
    sourceRoleId: source,
    workId: work,
    managed: true,
    access: "private",
    epoch: 2,
    restriction: "none",
    state: "complete",
    replayed: false,
    revisionState: "same",
    restorable: true,
    restoreReason: "same",
    approvalRevision: "approved-opaque-revision",
    policyRevision: "policy-opaque-revision",
    providerRestriction: "none",
    approvedRoleId: approved,
  };
  const receipts = new Map<string, Record<string, unknown>>();
  const behavior = { commands: 0 };
  vi.spyOn(hostGateway, "read").mockImplementation(async (_e,_t,id)=>({...role({roleId:id,authorNumId:11,tags}),backgroundUrl:approvedPortrait,avatarUrl:approvedPortrait}));
  if (unmanaged) {
    await env.DB.prepare("DELETE FROM managed_work_access").run();
    await env.DB.prepare("DELETE FROM review_submissions").run();
    await env.DB.prepare("DELETE FROM cards").run();
    await env.DB.prepare("DELETE FROM works").run();
    current.managed = false;
    current.workId = "00000000-0000-0000-0000-000000000000";
    current.epoch = 0;
    current.restorable = false;
    current.revisionState = "unknown";
    current.restoreReason = "not_approved";
    current.approvedRoleId = "";
    vi.spyOn(hostGateway, "read").mockImplementation(async (_e, _t, id) => role({ roleId: id, authorNumId: 11, tags }));
  }
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/open/v1/hosting/work-access/batch") {
      const { items } = JSON.parse(String(init?.body)) as { items: { sourceRoleId: string; workId: string; targetRoleId: string }[] };
      return Response.json({
        items: items.map((item) => ({
          ...current,
          ...item,
          shareRoleId: current.access === "public" ? current.approvedRoleId : current.access === "unlisted" ? source : "",
          targetReadable: current.access !== "private" && current.restriction !== "suspended",
          listed: current.access === "public" && current.restriction === "none",
        })),
      });
    }
    if (path.startsWith(`/open/v1/hosting/work-access/${source}/operations/`)) {
      const receipt = receipts.get(path.split("/").at(-1)!);
      return receipt ? Response.json(receipt) : Response.json({ error: "not_found" }, { status: 404 });
    }
    if (path !== `/open/v1/hosting/work-access/${source}`) throw new Error("Unexpected owner fixture request: " + path);
    if (init?.method === "POST") {
      const command = JSON.parse(String(init.body)) as { operationId: string; workId: string; expectedEpoch: number; expectedOwnerRevision?: string; action: string; access?: string; versionRoleId?: string };
      const prior = receipts.get(command.operationId);
      if (prior) return Response.json({ ...prior, replayed: true });
      if (command.expectedEpoch !== current.epoch || (command.expectedOwnerRevision && command.expectedOwnerRevision !== current.policyRevision)) {
        return Response.json({ error: "work_access_conflict" }, { status: 409 });
      }
      behavior.commands++;
      current.epoch++;
      current.policyRevision = "policy-opaque-revision-" + current.epoch;
      if (command.action === "bind") {
        current.managed = true;
        current.workId = command.workId;
        current.access = command.access!;
        current.approvedRoleId = command.versionRoleId ?? "";
      }
      current.access = command.action === "private" ? "private" : command.action === "unlisted" ? "unlisted" : command.action === "restore" ? "public" : current.access;
      const receipt = {
        sourceRoleId: source,
        workId: current.workId,
        operationId: command.operationId,
        access: current.access,
        epoch: current.epoch,
        restriction: current.restriction,
        state: "complete",
        replayed: false,
      };
      receipts.set(command.operationId, receipt);
      return Response.json(receipt);
    }
    return Response.json(current);
  });
  return { source, card, behavior };
}

async function visibilityCommand(target: string, targetAccess: "private" | "unlisted" | "public") {
  const response = await visibilityRequest(`/v1/me/cards/${target}/visibility`);
  const body = (await response.json()) as { workVisibility: { policyRevision: string; approvalRevision: string } };
  return {
    operationId: crypto.randomUUID(),
    targetAccess,
    expectedPolicyRevision: body.workVisibility.policyRevision,
    expectedApprovalRevision: body.workVisibility.approvalRevision,
  };
}

describe("shared preset tag catalog predicate", () => {
  it("matches any of the five locale display names and rejects custom-only or URL slug keys", () => {
    expect(countPresetTags([])).toBe(0);
    expect(hasPresetTag([])).toBe(false);
    expect(countPresetTags(["推理", "民國", "自訂"])).toBe(0);
    expect(hasPresetTag(["roleplay"])).toBe(false);
    for (const label of ["调教&强迫", "調教&強迫", "Training & coercion", "調教&強制", "조교&강제"]) {
      expect(countPresetTags(["自訂", ` ${label} `])).toBe(1);
      expect(hasPresetTag([label])).toBe(true);
    }
    expect(countPresetTags(["劇情", "Story"])).toBe(1);
  });

  it("counts preset tags beyond the 10-tag editor soft limit up to the 20-tag stored cap", () => {
    const tenCustom = Array.from({ length: 10 }, (_, i) => `自訂${i + 1}`);
    expect(hasPresetTag([...tenCustom, "角色扮演"])).toBe(true);
    const twentyCustom = Array.from({ length: 20 }, (_, i) => `自訂${i + 1}`);
    expect(hasPresetTag([...twentyCustom, "角色扮演"])).toBe(false);
  });
});

describe("public preset catalog endpoint", () => {
  it("exposes GET /v1/tags/catalog without authentication", async () => {
    const res = await SELF.fetch("https://c.test/v1/tags/catalog");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groups: string[]; items: { key: string; group: string; names: Record<string, string> }[] };
    expect(body.groups).toEqual(TAG_GROUPS);
    expect(body.items).toHaveLength(TAG_CATALOG.length);
    expect(body.items[0]).toMatchObject({
      key: "roleplay",
      group: "play",
      names: { "zh-Hans": "角色扮演", "zh-Hant": "角色扮演", en: "Roleplay", ja: "ロールプレイ", ko: "롤플레이" },
    });
  });
});

describe("server preset tag enforcement", () => {
  it("rejects POST /v1/cards without a preset tag before reading review settings, sealing, or writing versions", async () => {
    identities({ author: 10001 });
    rolesOnMainSite({ roleId: "custom-only", authorNumId: 10001, tags: ["推理", "自訂標籤"] });
    const seal = vi.spyOn(hostGateway, "seal");
    const readForReview = vi.spyOn(upstream, "readForReview");

    const response = await SELF.fetch("https://c.test/v1/cards", {
      method: "POST",
      headers: { ...bearer("author"), "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: "custom-only", ...ratingBody(false), operationId: crypto.randomUUID() }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; detail: { field: string; hint: string; catalogEndpoint: string; presets: unknown[] } };
    expect(body.error).toBe("preset_tag_required");
    expect(body.detail.field).toBe("roleTag");
    expect(body.detail.hint).toContain("/v1/tags/catalog");
    expect(body.detail.catalogEndpoint).toBe("/v1/tags/catalog");
    expect(body.detail.presets).toHaveLength(TAG_CATALOG.length);
    expect(seal).not.toHaveBeenCalled();
    expect(readForReview).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM hosting_versions").first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM review_submissions").first("n")).toBe(0);
    expect(await opsMetrics(env.DB)).toContain('hearthroom_preset_tag_checks_total{phase="draft",outcome="missing"} 1');
  });

  it("checks the sealed revision even if the draft passed preflight", async () => {
    const memberId = await makeMember(10001);
    const draft = role({ roleId: "tag-race", authorNumId: 10001, tags: ["角色扮演"] });
    vi.spyOn(hostGateway, "seal").mockImplementation(async (_env, _token, _role, workId, versionId) => ({
      workId,
      versionId,
      hostedRevisionId: "sealed-tag-race",
    }));
    vi.spyOn(hostGateway, "read").mockResolvedValue({ ...draft, roleId: "sealed-tag-race", tags: ["自訂"] });
    vi.spyOn(upstream, "readForReview").mockResolvedValue({
      document: { roleName:"Fixture",roleTag:["Roleplay"],roleDetailDesc: "字".repeat(3001) },greetings:{welcome:"Welcome",alternates:[],prologue:[]},
      hashes: { card: "", welcome: "", worldbook: "", authorAsset: "", content: "" },
    });

    await expect(
      submitHosted(env, {
        memberId,
        account: 10001,
        role: draft,
        token: "author",
        rating: GENERAL_RATING,
        operationId: crypto.randomUUID(),
        now: Date.now(),
      }),
    ).rejects.toMatchObject({ status: 400, message: "preset_tag_required" });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM review_submissions").first("n")).toBe(0);
    const metrics = await opsMetrics(env.DB);
    expect(metrics).toContain('hearthroom_preset_tag_checks_total{phase="draft",outcome="eligible"} 1');
    expect(metrics).toContain('hearthroom_preset_tag_checks_total{phase="sealed",outcome="missing"} 1');
  });

  it("keeps legacy tagless approved cards public, replays accepted operations, and blocks updates until a preset tag is added", async () => {
    const { claim, stamp } = await import("../src/review");
    const memberId = await makeMember(10001);
    const initial = role({ roleId: "legacy-card", authorNumId: 10001, tags: ["Roleplay"] });
    let currentSealedTags = ["Roleplay"];
    vi.spyOn(hostGateway, "seal").mockImplementation(async (_env, _token, _role, workId, versionId) => ({
      workId,
      versionId,
      hostedRevisionId: "sealed-" + versionId,
    }));
    vi.spyOn(hostGateway, "read").mockImplementation(async (_env, _token, id) => ({ ...initial, roleId: id, tags: currentSealedTags }));
    vi.spyOn(upstream, "readForReview").mockResolvedValue({
      document: { roleName:"Fixture",roleTag:["Roleplay"],roleDetailDesc: "字".repeat(3001) },greetings:{welcome:"Welcome",alternates:[],prologue:[]},
      hashes: { card: "", welcome: "", worldbook: "", authorAsset: "", content: "" },
    });

    const firstOp = {
      memberId,
      account: 10001,
      role: initial,
      token: "author",
      rating: GENERAL_RATING,
      operationId: crypto.randomUUID(),
      now: Date.now(),
    };
    const receipt = await submitHosted(env, firstOp);
    const sub = await env.DB.prepare("SELECT id FROM review_submissions").first<{ id: string }>();
    await claim(env.DB, sub!.id, "reviewer", Date.now());
    await stamp(env.DB, { submissionId: sub!.id, memberId: "reviewer", verdict: "approve", note: "", now: Date.now() }, env);

    // Simulate pre-rule approved card having custom-only tags on the live row
    await env.DB.prepare("UPDATE cards SET tags=? WHERE source_role_id='legacy-card'").bind(JSON.stringify(["舊自訂"])).run();

    // Idempotent replay of the original accepted operation still succeeds
    expect(await submitHosted(env, { ...firstOp, role: { ...initial, tags: ["舊自訂"] } })).toEqual(receipt);

    // New update without preset tag is rejected while live card remains approved
    currentSealedTags = ["舊自訂"];
    await expect(
      submitHosted(env, {
        ...firstOp,
        role: { ...initial, tags: ["舊自訂"] },
        operationId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 400, message: "preset_tag_required" });
    expect(await env.DB.prepare("SELECT status, tags FROM cards WHERE source_role_id='legacy-card'").first()).toEqual({
      status: "approved",
      tags: JSON.stringify(["舊自訂"]),
    });

    // Adding a preset tag at position 11 (after 10 custom tags) allows the update
    const elevenTags = [...Array.from({ length: 10 }, (_, i) => `自訂${i + 1}`), "ロールプレイ"];
    currentSealedTags = elevenTags;
    const updated = await submitHosted(env, {
      ...firstOp,
      role: { ...initial, tags: elevenTags },
      operationId: crypto.randomUUID(),
    });
    expect(updated.versionId).toBeTruthy();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM review_submissions").first("n")).toBe(2);
  });

  it("blocks restore_public when approved version lacks a preset tag, but never blocks unlisted or private", async () => {
    // 1. Unmanaged card without preset tags can link-share (unlisted)
    const unmanaged = await managedVisibilityFixture(["純自訂"], true);
    const bindUnlisted = await visibilityCommand(unmanaged.source, "unlisted");
    expect((await visibilityRequest(`/v1/me/cards/${unmanaged.source}/visibility`, "owner", bindUnlisted)).status).toBe(200);
    expect(unmanaged.behavior.commands).toBe(1);

    await resetDb();

    // 2. Managed legacy card whose approved version lacks preset tags:
    //    unlisted & private succeed, restore_public fails with 400 preset_tag_required
    const legacy = await managedVisibilityFixture(["純自訂"]);
    const tryRestore = await visibilityCommand(legacy.card.id, "public");
    const blocked = await visibilityRequest(`/v1/me/cards/${legacy.card.id}/visibility`, "owner", tryRestore);
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({ error: "preset_tag_required", detail: { field: "roleTag" } });
    expect(legacy.behavior.commands).toBe(0);
    expect(await opsMetrics(env.DB)).toContain('hearthroom_preset_tag_checks_total{phase="restore",outcome="missing"} 1');

    const toUnlisted = await visibilityCommand(legacy.card.id, "unlisted");
    expect((await visibilityRequest(`/v1/me/cards/${legacy.card.id}/visibility`, "owner", toUnlisted)).status).toBe(200);
    const toPrivate = await visibilityCommand(legacy.card.id, "private");
    expect((await visibilityRequest(`/v1/me/cards/${legacy.card.id}/visibility`, "owner", toPrivate)).status).toBe(200);

    await resetDb();

    // 3. Managed card whose approved version has a preset tag: restore_public succeeds
    const valid = await managedVisibilityFixture(["自訂", "롤플레이"]);
    const okRestore = await visibilityCommand(valid.card.id, "public");
    expect((await visibilityRequest(`/v1/me/cards/${valid.card.id}/visibility`, "owner", okRestore)).status).toBe(200);
    expect(await opsMetrics(env.DB)).toContain('hearthroom_preset_tag_checks_total{phase="restore",outcome="eligible"} 1');
  });
});

it('refuses public restoration without a portrait before creating an operation',async()=>{
 const f=await managedVisibilityFixture(['Roleplay'],false,'');
 const current=await visibilityRequest(`/v1/me/cards/${f.source}/visibility`);
 const body=await current.json() as {workVisibility:{policyRevision:string;approvalRevision:string}};
 const response=await visibilityRequest(`/v1/me/cards/${f.source}/visibility`,'owner',{operationId:crypto.randomUUID(),targetAccess:'public',expectedPolicyRevision:body.workVisibility.policyRevision,expectedApprovalRevision:body.workVisibility.approvalRevision});
 expect(response.status).toBe(422);
 expect(await response.json()).toMatchObject({error:'cover_required'});
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM author_visibility_operations').first('n')).toBe(0);
});

it.each([
 ['stale-present','https://assets.test/stale.png','',422],
 ['stale-empty','','https://assets.test/approved.png',200],
] as const)('checks the immutable approved portrait instead of the %s index',async(_case,indexPortrait,approvedPortrait,status)=>{
 const f=await managedVisibilityFixture(['Roleplay'],false,indexPortrait,approvedPortrait);
 const current=await visibilityRequest(`/v1/me/cards/${f.source}/visibility`);
 const body=await current.json() as {workVisibility:{policyRevision:string;approvalRevision:string}};
 const response=await visibilityRequest(`/v1/me/cards/${f.source}/visibility`,'owner',{operationId:crypto.randomUUID(),targetAccess:'public',expectedPolicyRevision:body.workVisibility.policyRevision,expectedApprovalRevision:body.workVisibility.approvalRevision});
 expect(response.status).toBe(status);
 if(status===422){expect(await response.json()).toMatchObject({error:'cover_required'});expect(f.behavior.commands).toBe(0);}
});
