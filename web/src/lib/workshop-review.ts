/**
 * 審核工作台的擴充單（ui.md §3.9 ①）：型別與分流用的判斷。
 *
 * 擴充單和卡片單走同一組 /v1/review/* 端點（interface-worker.md §2 第 2 點），伺服器用 subjectKind 分流，
 * 所以這裡沒有新的請求函式：清單、詳情、領取、放回、蓋章都沿用 lib/api.ts 的那幾支，只在回應型別上延伸。
 * 刻意只放型別與純函式、不在模組層讀 api 的任何值：審核頁的既有測試把 lib/api 整個換成固定的假物件，
 * 這裡多讀一個沒被假造的匯出就會讓那些測試在載入時就壞掉。
 */
import type { ReviewDetail, ReviewQueueItem, ReviewSubmissionType } from "./api";
import type { Rating } from "../../../shared/content-rating";

export type ReviewSubjectKind = "card" | "workshop";

/**
 * 佇列項的 `workshop`（契約已寫）＋兩個建議補上的選填欄位（authorName、version，見回報）。
 * 擴充單的佇列項其餘欄位沿用卡片的：
 *   - `card` 是原卡（id＝卡號、name、roleId…），畫「為《原卡名》」用；
 *   - `type`：`"first"`＝這個擴充還沒發布過（首次），`"update"`＝已發布、這是新版；
 *   - `rating`：擴充自己的分級（R＝限制級）；
 *   - `claim`、`claimGeneration`、`stampedByMe`、`hold`、`attempt` 意思與卡片單相同。
 * 不帶字數門檻（`reviewLength`）：擴充不套卡片的字數門檻。
 */
export interface WorkshopReviewSummary {
  id: string;
  name: string;
  summary: string;
  coverUrl: string | null;
  /** 新版才有；首次是 null */
  updateNote: string | null;
  residentChars: number;
  loreCount: number;
  ruleCount: number;
  openingCount: number;
  /** 建議補：製作者顯示名（清單底下「作者 · 時間」）；沒帶就只畫時間 */
  authorName?: string | null;
  /** 建議補：送審的版號（例如 "v6"） */
  version?: string | null;
}

export type ReviewQueueEntry = ReviewQueueItem & { subjectKind?: ReviewSubjectKind; workshop?: WorkshopReviewSummary | null };

export const isWorkshopItem = (item: ReviewQueueEntry): item is ReviewQueueEntry & { workshop: WorkshopReviewSummary } =>
  item.subjectKind === "workshop" && !!item.workshop;

/** 擴充是不是新版（已發布過）；不是新版就當首次 */
export const isWorkshopUpdate = (item: { type?: ReviewSubmissionType }) => item.type === "update";

/**
 * `GET /v1/review/:id/detail` 擴充單的形狀（本檔定案，主研發寫進契約並通知 worker）。
 *
 * 跟卡片單最大的不同：**不必先領取就讀得到**（回 200，不回 409 "claim this submission first"）。
 * 審核頁要能畫出「未領取」「自己的擴充」「限制級·需驗證年齡」三種狀態，而後兩種本來就領不了。
 * 能不能領、能不能決定仍由伺服器在 claim／stamp 時擋（禁審自己的、R 級要年齡驗證、一章定案）。
 *
 * submission 的欄位名沿用卡片單，領取、放回、蓋章的請求完全相同。
 */
export interface WorkshopReviewDetail {
  subjectKind: "workshop";
  submission: {
    id: string;
    /** pending｜approved｜rejected（或伺服器的其他終態）；不是 pending 就畫結果 */
    status: string;
    submittedAt: number;
    /** "first"＝首次，"update"＝新版 */
    type: "first" | "update";
    /** 擴充自己的分級；R＝限制級 */
    rating: Rating | null;
    claimedByMe: boolean;
    /** 別人領著（free｜mine｜other，同佇列項）；沒帶當 free */
    claim?: "free" | "mine" | "other";
    stampedByMe?: boolean;
    claimGeneration?: string;
    /** 擴充一律 1 */
    required: number;
    stamps: { verdict: "approve" | "reject"; note: string; at: number; mine?: boolean }[];
    /** 目前這位審核員就是製作者：不能領、不能決定 */
    ownWorkshop: boolean;
    /** 擴充是 R 級、而這位審核員還沒完成年齡驗證 */
    ageVerificationRequired: boolean;
    attempt?: number;
  };
  /** 原卡：id 是公開卡號（開卡片頁、審核試玩都用它），name 畫「為《原卡名》」 */
  baseCard: { id: string; roleId: string; name: string; rating: Rating | null };
  /** 製作者（只給審核頁） */
  maker: { name: string; handle: string | null; accountNumId: number } | null;
  workshop: {
    id: string;
    releaseId: string;
    name: string;
    summary: string;
    /** 作者寫的介紹（詳情頁「介紹」那段） */
    description: string;
    coverUrl: string | null;
    /** 這次送審的版號，例如 "v6" */
    version: string;
    /** 目前上架中的版號；首次是 null */
    previousVersion: string | null;
    updateNote: string | null;
    /** 常駐字數（isConstant 且啟用的條目）與上限 */
    residentChars: number;
    residentMax: number;
    /** 世界書條目（含停用的）；常駐內容就是其中 isConstant 的那些 */
    entries: { entryId: string; name: string; content: string; keywords: string[]; secondaryKeywords: string[]; isEnabled: boolean; isConstant: boolean }[];
    /** 正規表示式規則（含停用的、含改介面的） */
    rules: { id: string; name: string; find: string; replace: string; enabled: boolean }[];
    openings: { id: string; title: string; content: string }[];
  };
}

export type ReviewSubjectDetail = ReviewDetail | WorkshopReviewDetail;

export const isWorkshopDetail = (detail: ReviewSubjectDetail): detail is WorkshopReviewDetail =>
  (detail as { subjectKind?: string }).subjectKind === "workshop";
