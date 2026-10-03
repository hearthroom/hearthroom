import { describe, expect, it } from "vitest";
import { confirmForm, confirmState, settleConfirm } from "../src/lib/confirm";

describe("confirmForm", () => {
  it("必選項加一格字：確認回兩樣（字去頭尾空白），沒選必選項就當沒按", async () => {
    const p = confirmForm({ message: "送審？", choices: [{ value: "sfw", label: "一般" }], field: { label: "原作", initial: "原神" } });
    expect(confirmState.current?.field?.initial).toBe("原神");
    settleConfirm(true, "", null, " 崩壞三 ");
    expect(confirmState.current?.message).toBe("送審？");
    settleConfirm(true, "", "sfw", " 崩壞三 ");
    expect(await p).toEqual({ choice: "sfw", text: "崩壞三" });
    expect(confirmState.current).toBeNull();
  });

  it("取消回 null", async () => {
    const p = confirmForm({ message: "送審？", choices: [{ value: "sfw", label: "一般" }], field: { label: "原作" } });
    settleConfirm(false);
    expect(await p).toBeNull();
  });
});
