import { describe, expect, it } from "vitest";
import { confirmForm, confirmState, settleConfirm } from "../src/lib/confirm";

describe("confirmForm", () => {
  it("一格字：確認回填的字（去頭尾空白）", async () => {
    const p = confirmForm({ message: "送審？", field: { label: "原作", initial: "原神" } });
    expect(confirmState.current?.field?.initial).toBe("原神");
    settleConfirm(true, "", " 崩壞三 ");
    expect(await p).toEqual({ text: "崩壞三" });
    expect(confirmState.current).toBeNull();
  });

  it("取消回 null", async () => {
    const p = confirmForm({ message: "送審？", field: { label: "原作" } });
    settleConfirm(false);
    expect(await p).toBeNull();
  });
});
