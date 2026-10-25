// 確認框的預設焦點：一般確認在確認鍵；危險操作與 focusCancel 在取消鍵
// （簽到斷簽時的「直接簽到」會讓連續天數退回，ui.md §3.6 要求預設停在「回去補簽」）。
import { afterEach, describe, expect, it } from "vitest";
import { createApp, nextTick } from "vue";
import ConfirmDialog from "../src/components/ConfirmDialog.vue";
import { confirmDialog, settleConfirm } from "../src/lib/confirm";
import { i18n } from "../src/lib/i18n";

async function mountDialog() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp(ConfirmDialog);
  app.use(i18n);
  app.mount(host);
  return () => { app.unmount(); host.remove(); };
}

describe("確認框的預設焦點", () => {
  let unmount: (() => void) | null = null;
  afterEach(() => { settleConfirm(false); unmount?.(); unmount = null; });

  it("一般確認：焦點在確認鍵", async () => {
    unmount = await mountDialog();
    void confirmDialog({ message: "m", confirmText: "ok", cancelText: "back" });
    await nextTick(); await nextTick();
    expect((document.activeElement as HTMLElement | null)?.hasAttribute("data-confirm")).toBe(true);
  });

  it("focusCancel：焦點在取消鍵，確認鍵仍是一般樣式", async () => {
    unmount = await mountDialog();
    void confirmDialog({ message: "m", confirmText: "ok", cancelText: "back", focusCancel: true });
    await nextTick(); await nextTick();
    const active = document.activeElement as HTMLElement | null;
    expect(active?.hasAttribute("data-cancel")).toBe(true);
    expect(document.querySelector("[data-confirm]")?.classList.contains("btn--danger-solid")).toBe(false);
  });
});

// 低權重的危險確認（dangerAppearance: "subdued"，編輯頁的歸零與清空用）：確認鍵不是實心紅、
// 框掛自己的修飾 class（手機改成取消在上），焦點仍在取消。沒帶這個選項的危險確認照舊。
describe("低權重的危險確認", () => {
  let unmount: (() => void) | null = null;
  afterEach(() => { settleConfirm(false); unmount?.(); unmount = null; });

  it("subdued：確認鍵不是實心紅，框有修飾 class，焦點在取消", async () => {
    unmount = await mountDialog();
    void confirmDialog({ message: "m", confirmText: "ok", cancelText: "back", danger: true, dangerAppearance: "subdued", focusCancel: true });
    await nextTick(); await nextTick();
    const confirmBtn = document.querySelector("[data-confirm]")!;
    expect(confirmBtn.classList.contains("btn--danger-solid")).toBe(false);
    expect(confirmBtn.classList.contains("dlg__subdued")).toBe(true);
    expect(document.querySelector(".dlg")!.classList.contains("dlg--danger-subdued")).toBe(true);
    expect((document.activeElement as HTMLElement | null)?.hasAttribute("data-cancel")).toBe(true);
  });

  it("沒帶選項的危險確認照舊是實心紅；非危險確認忽略這個選項", async () => {
    unmount = await mountDialog();
    void confirmDialog({ message: "m", confirmText: "ok", cancelText: "back", danger: true });
    await nextTick(); await nextTick();
    expect(document.querySelector("[data-confirm]")!.classList.contains("btn--danger-solid")).toBe(true);
    expect(document.querySelector(".dlg")!.classList.contains("dlg--danger-subdued")).toBe(false);
    settleConfirm(false);
    void confirmDialog({ message: "m", confirmText: "ok", cancelText: "back", dangerAppearance: "subdued" });
    await nextTick(); await nextTick();
    expect(document.querySelector("[data-confirm]")!.classList.contains("btn--primary")).toBe(true);
    expect(document.querySelector(".dlg")!.classList.contains("dlg--danger-subdued")).toBe(false);
  });
});
