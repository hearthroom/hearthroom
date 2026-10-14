import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { auditStmt } from "../src/audit";
import { bumpOp, opsMetrics } from "../src/ops-metrics";
import { readSettings, writeSettings } from "../src/community-settings";
import { isReviewAgent } from "../src/members";
import { makeAgent, makeReviewer, resetDb } from "./helpers";

beforeEach(resetDb);

describe("稽核", () => {
  it("同一個操作編號只寫一次；不能改", async () => {
    const e = { subjectKind: "comment" as const, subjectId: "c1", actorMemberId: "m1", actorKind: "human" as const, action: "remove", reason: "spam", before: { status: "visible" }, after: { status: "removed" }, operationId: "op-0000000000000001", now: 1 };
    await env.DB.batch([auditStmt(env.DB, e)]);
    await expect(env.DB.batch([auditStmt(env.DB, e)])).rejects.toThrow(/UNIQUE/);
    await expect(env.DB.prepare("UPDATE audit_log SET reason='x'").run()).rejects.toThrow(/append-only/);
    const row = await env.DB.prepare("SELECT before_json, after_json FROM audit_log").first<{ before_json: string; after_json: string }>();
    expect(JSON.parse(row!.after_json)).toEqual({ status: "removed" });
  });
  it("不在名單上的主體類型直接丟錯", () => {
    expect(() => auditStmt(env.DB, { subjectKind: "nope" as never, subjectId: "x", actorMemberId: null, actorKind: "system", action: "x", operationId: "op-0000000000000002", now: 1 })).toThrow();
  });
});

describe("計數", () => {
  it("只輸出列舉內的值", async () => {
    await bumpOp(env.DB, "comment_moderation", "remove", "success");
    await bumpOp(env.DB, "comment_moderation", "remove", "success");
    await env.DB.prepare("INSERT INTO ops_metrics VALUES('comment_moderation','evil\"}','success',1)").run();
    const text = await opsMetrics(env.DB);
    expect(text).toContain('hearthroom_comment_moderation_total{action="remove",outcome="success"} 2');
    expect(text).not.toContain("evil");
  });
});

describe("運營設定", () => {
  it("沒設的門檻是 null；寫入留稽核；數字要合法", async () => {
    expect(await readSettings(env.DB)).toEqual({ commentNewAccountDays: null, commentMaxLinks: null, commentReportFoldThreshold: null });
    await writeSettings(env.DB, { commentMaxLinks: 2 }, { memberId: "m-admin", kind: "human" }, "op-0000000000000003", 5);
    expect((await readSettings(env.DB)).commentMaxLinks).toBe(2);
    await writeSettings(env.DB, { commentMaxLinks: null }, { memberId: "m-admin", kind: "human" }, "op-0000000000000004", 6);
    expect((await readSettings(env.DB)).commentMaxLinks).toBeNull();
    await expect(writeSettings(env.DB, { commentReportFoldThreshold: 0 }, { memberId: "m-admin", kind: "human" }, "op-0000000000000005", 7)).rejects.toThrow(/invalid_settings/);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE subject_kind='community_settings'").first<{ n: number }>();
    expect(n!.n).toBe(2);
  });
});

describe("運營設定只認自己的鍵", () => {
  it("toString、__proto__ 這類繼承來的名字一律當未知的鍵", async () => {
    for (const patch of [{ toString: 1 }, JSON.parse('{"__proto__": 1}')]) {
      await expect(writeSettings(env.DB, patch, { memberId: "m-admin", kind: "human" }, crypto.randomUUID(), 8)).rejects.toThrow(/invalid_settings/);
    }
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM community_settings").first<{ n: number }>())!.n).toBe(0);
    await env.DB.prepare("INSERT INTO community_settings VALUES ('toString','3',NULL,1)").run();
    expect(await readSettings(env.DB)).toEqual({ commentNewAccountDays: null, commentMaxLinks: null, commentReportFoldThreshold: null });
  });
});

describe("AI 審核帳號", () => {
  it("審核人加上代理標記才算", async () => {
    const human = await makeReviewer(41001);
    const agent = await makeAgent(41002);
    expect(await isReviewAgent(env.DB, human)).toBe(false);
    expect(await isReviewAgent(env.DB, agent)).toBe(true);
  });
});
