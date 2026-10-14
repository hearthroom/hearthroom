/**
 * 留言與發布的錯誤以前把伺服器的英文原文丟給使用者（「comment not found」），
 * 或只說「請求失敗 (comment_rate_limited)」。留言的碼要有自己的一句；
 * 伺服器寫給開發者的小寫英文短語按狀態碼講他的語言，不夾英文。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createComment, describeApiError } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { i18n } from "@/lib/i18n";

afterEach(() => { i18n.global.locale.value = "en"; vi.unstubAllGlobals(); });

describe("comment and publish errors", () => {
  it("names the comment codes in the player's language", () => {
    i18n.global.locale.value = "ja";
    for (const code of ["comment_rate_limited", "comment_too_long", "comment_required"]) {
      const said = describeApiError(code === "comment_rate_limited" ? 429 : 400, code);
      expect(said).not.toContain(code);
      expect(said).not.toMatch(/\(\w+\)$/);
    }
  });

  it("does not show the server's internal English phrases", () => {
    i18n.global.locale.value = "zh-Hant";
    expect(describeApiError(404, "comment not found")).toBe(i18n.global.t("state.notFound"));
    expect(describeApiError(403, "not allowed to delete this comment")).toBe(i18n.global.t("state.forbidden"));
    expect(describeApiError(409, "claim changed")).toBe(i18n.global.t("state.requestFailed"));
  });

  it("still shows a sentence written for people", () => {
    expect(describeApiError(400, "內容包含不適當字詞")).toBe("內容包含不適當字詞");
    expect(describeApiError(400, "Contains a link to an external site.")).toBe("Contains a link to an external site.");
  });
});

describe("muted commenter", () => {
  const muted = (until: number | null) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "comment_muted", until }), { status: 403 })));
  it("says until when a timed mute ends", async () => {
    i18n.global.locale.value = "zh-Hant";
    const until = Date.UTC(2026, 9, 21, 8, 30);
    muted(until);
    await expect(createComment("1", { content: "hi" }, "t")).rejects.toThrow(i18n.global.t("comment.error.mutedUntil", { date: dateTime(until) }));
  });
  it("says it is permanent when there is no end", async () => {
    i18n.global.locale.value = "en";
    muted(null);
    await expect(createComment("1", { content: "hi" }, "t")).rejects.toThrow(i18n.global.t("comment.error.mutedPermanent"));
  });
});
