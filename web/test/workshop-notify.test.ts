import { expect, it } from "vitest";
import { i18n } from "../src/lib/i18n";
import { noticeDetail, noticeText } from "../src/lib/notifications";
import type { CommunityNotice } from "../src/lib/community";

const notice = (kind: string, extra: Record<string, unknown>, more: Partial<CommunityNotice> = {}): CommunityNotice => ({ id: "n1", kind, path: "/mine/workshops/w1/edit?section=publish", created_at: 0, read_at: null, extra, ...more });

it("tells the maker who returned the extension and why, as a title plus a body line", () => {
  i18n.global.locale.value = "zh-Hant";
  const n = notice("workshop_returned", { workshopName: "雪夜篇", reason: "介面規則  會蓋掉\n狀態列" });
  expect(noticeText(n)).toBe("「雪夜篇」被原作者退回");
  expect(noticeDetail(n)?.body).toContain("理由：介面規則 會蓋掉 狀態列");
});

it("splits a review result into published and rejected, and names the card for the original author", () => {
  i18n.global.locale.value = "zh-Hant";
  expect(noticeText(notice("workshop_review_result", { workshopName: "雪夜篇", status: "rejected" }))).toBe("「雪夜篇」審核未通過");
  expect(noticeText(notice("workshop_review_result", { workshopName: "雪夜篇", status: "approved" }))).toBe("「雪夜篇」已發布");
  expect(noticeText(notice("workshop_published", { workshopName: "雪夜篇" }, { actor: { handle: "h", name: "霧港" }, card: { id: 1, name: "燈塔" } }))).toBe("霧港 為你的《燈塔》建立了擴充");
});
