import type { ReviewSubmissionType } from "./api";

/** 送審類型；舊版伺服器沒有 type 時，用 kind 與 reopen 推一個最接近的 */
export const submissionTypeOf = (s: { type?: ReviewSubmissionType; kind: "first" | "re"; reopen?: boolean }): ReviewSubmissionType =>
  s.type ?? (s.reopen ? "reopen" : s.kind === "re" ? "update" : "first");

/** 類型的標籤 key；重新審核沿用既有的「重新審核」 */
export const submissionTypeKey = (type: ReviewSubmissionType) => (type === "reopen" ? "review.reopen.chip" : `review.type.${type}`);
