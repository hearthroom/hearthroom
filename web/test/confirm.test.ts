import { describe, expect, it } from "vitest";
import { confirmDialog, confirmState, settleConfirm } from "../src/lib/confirm";

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
});
