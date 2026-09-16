/**
 * 第二家的錯誤碼也要有人話。
 *
 * 兩家的碼表幾乎不重疊（那邊叫 forbidden，這邊的表裡寫的是 permission_denied），
 * 所以那一家的錯誤原本會原封不動把英文代號丟到使用者臉上。這裡釘住：它的碼
 * 翻得出句子，而且句子裡不會夾著代號。
 */
import { describe, expect, it } from "vitest";
import { describeApiError } from "@/lib/api";
import { i18n } from "@/lib/i18n";

/** 翻不出來的碼會被附在句子後面 —— 出現括號就是沒翻到。 */
const translated = (s: string) => !/\(\w+\)$/.test(s);

describe("第二家的錯誤碼", () => {
  const reuse: [string, number, string][] = [
    ["invalid_request", 400, "error.invalidArguments"],
    ["forbidden", 403, "state.forbidden"],
    ["not_the_author", 403, "state.forbidden"],
    ["role_not_found", 404, "state.notFound"],
    ["asset_not_found", 404, "state.notFound"],
    ["account_not_found", 404, "state.notFound"],
    ["grantee_not_found", 404, "state.notFound"],
    ["unauthorized", 401, "auth.expired"],
    ["role_not_passed_review", 400, "error.roleInReview"],
    ["temporarily_unavailable", 503, "state.serverBusy"],
    ["file_too_large", 413, "error.payloadTooLarge"],
    ["upload_not_found", 404, "error.uploadRetry"],
    ["size_mismatch", 400, "error.uploadRetry"],
  ];

  for (const [code, status, key] of reuse) {
    it(`${code} 用既有的那句`, () => {
      expect(describeApiError(status, code)).toBe(i18n.global.t(key));
    });
  }

  const own: string[] = [
    "insufficient_scope",
    "unsupported_media_type",
    "invalid_cursor",
    "quota_exceeded",
    "asset_not_passed_review",
  ];

  for (const code of own) {
    it(`${code} 有自己的一句，而且不露代號`, () => {
      const said = describeApiError(400, code);
      expect(translated(said)).toBe(true);
      expect(said).not.toContain(code);
    });
  }
});
