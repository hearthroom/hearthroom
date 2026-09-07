/**
 * 部署前的守門：兩次髒樹部署（2026-09-06、09-07）都是操作者的命令鏈沒在該停的地方停。
 * 規則是純函式，這裡只餵 git 的輸出字串；真正跑 git 的殼在 scripts/deploy-preflight.mjs。
 */
import { describe, expect, it } from "vitest";
import { assess } from "../scripts/deploy-preflight-rules.mjs";

const clean = { porcelain: "", submoduleStatus: " 93e829b stage (heads/main)", head: "abc", originMain: "abc", stagePinned: "93e829b", stageHead: "93e829b", fetchOk: true, force: false };

describe("deploy preflight", () => {
  it("乾淨、同步、子模組對齊 → 放行", () => {
    expect(assess(clean)).toEqual({ ok: true, reasons: [], forced: false });
  });

  it("工作樹有未提交的檔 → 擋，並把檔列出來", () => {
    const r = assess({ ...clean, porcelain: " M web/src/pages/CardEditorPage.vue\n?? web/test/x.test.ts" });
    expect(r.ok).toBe(false);
    expect(r.reasons.join("\n")).toContain("CardEditorPage.vue");
  });

  it("子模組指針有 +/- 標記（檢出跟 HEAD 釘的不同）→ 擋", () => {
    expect(assess({ ...clean, submoduleStatus: "+45087bb stage (heads/main)" }).ok).toBe(false);
    expect(assess({ ...clean, submoduleStatus: "-93e829b stage" }).ok).toBe(false);
  });

  it("stage 檢出的 commit 不等於 HEAD 釘的 → 擋（symlink 借舊樹會踩到）", () => {
    const r = assess({ ...clean, stageHead: "cd69e76" });
    expect(r.ok).toBe(false);
    expect(r.reasons.join("\n")).toMatch(/stage/);
  });

  it("HEAD 不在 origin/main 上（落後、領先、分叉）→ 擋", () => {
    expect(assess({ ...clean, originMain: "def" }).ok).toBe(false);
  });

  it("fetch 失敗證明不了同步 → 擋", () => {
    expect(assess({ ...clean, fetchOk: false }).ok).toBe(false);
  });

  it("DEPLOY_FORCE=1 只放行不掩蓋：ok 但 forced，理由照列", () => {
    const r = assess({ ...clean, porcelain: " M a", force: true });
    expect(r).toMatchObject({ ok: true, forced: true });
    expect(r.reasons.length).toBe(1);
  });
});
