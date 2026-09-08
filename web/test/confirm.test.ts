import { describe, expect, it } from "vitest";
import { confirmDialog, confirmState, confirmTextMatches, settleConfirm } from "../src/lib/confirm";

describe("confirmDialog", () => {
  it("回答之後 promise 才落定，並且清掉狀態", async () => {
    const p = confirmDialog({ message: "刪除？" });
    expect(confirmState.current?.message).toBe("刪除？");
    settleConfirm(true);
    expect(await p).toBe(true);
    expect(confirmState.current).toBeNull();
  });

  it("還沒回答又來一個：舊的當取消，只留新的", async () => {
    const first = confirmDialog({ message: "A" });
    const second = confirmDialog({ message: "B" });
    expect(await first).toBe(false);
    expect(confirmState.current?.message).toBe("B");
    settleConfirm(false);
    expect(await second).toBe(false);
  });

  it("沒有彈窗時 settle 是 no-op", () => {
    expect(() => settleConfirm(true)).not.toThrow();
  });

  it("requireText：沒照打就當沒按，彈窗留著；打對（前後空白不算）才落定", async () => {
    const p = confirmDialog({ message: "刪除？", requireText: "夜行偵探" });
    settleConfirm(true, "夜行");
    expect(confirmState.current?.message).toBe("刪除？");
    settleConfirm(true, "  夜行偵探 ");
    expect(await p).toBe(true);
    expect(confirmState.current).toBeNull();
    expect(confirmTextMatches({ requireText: "a" }, "b")).toBe(false);
    expect(confirmTextMatches({}, "")).toBe(true);
  });

  it("requireText 的彈窗取消不用打字", async () => {
    const p = confirmDialog({ message: "刪除？", requireText: "夜行偵探" });
    settleConfirm(false);
    expect(await p).toBe(false);
  });
});

describe("confirmChoice：帶必選項的確認", () => {
  it("沒選就按不了確認；選了才落定並回選到的值；取消回 null", async () => {
    const { confirmChoice, confirmChoiceOk } = await import("../src/lib/confirm");
    const opts = { message: "分級？", choices: [{ value: "sfw", label: "一般" }, { value: "nsfw", label: "成人" }] };
    const p = confirmChoice(opts);
    expect(confirmChoiceOk(opts, null)).toBe(false);
    expect(confirmChoiceOk(opts, "other")).toBe(false);
    settleConfirm(true, "", null);
    expect(confirmState.current?.message).toBe("分級？");
    settleConfirm(true, "", "nsfw");
    expect(await p).toBe("nsfw");
    const q = confirmChoice(opts);
    settleConfirm(false);
    expect(await q).toBeNull();
  });
});

