/**
 * 送審差異的欄位名稱（審核頁「更新內容」與 AI 分歧仲裁共用）。伺服器的欄位鍵見 src/review-diff.ts。
 */
/** 欄位名稱沿用編輯頁與審核頁現有的字；作者資產的欄位帶 asset. 前綴 */
export const FIELD_LABELS: Record<string, string> = {
  name: "editor.name",
  summary: "editor.summary",
  setting: "editor.detail",
  userName: "reviewV2.diff.field.userName",
  instructions: "editor.jailbreak",
  talkExample: "editor.talkExample",
  outputContract: "editor.contract",
  speech: "reviewV2.diff.field.speech",
  type: "reviewV2.diff.field.type",
  sex: "settings.persona.sex",
  language: "create.language",
  tags: "review.tags",
  world: "editor.section.world",
  opening: "editor.welcome",
  alternates: "editor.alternates",
  prologue: "editor.prologue",
  "asset.openingPage": "editor.opening.page",
  "asset.openingMode": "editor.opening.mode",
  "asset.cardFormat": "reviewV2.diff.field.cardFormat",
  "asset.cardCss": "editor.cardCss.title",
  "asset.cardCssDialect": "reviewV2.diff.field.cardCssDialect",
  "asset.pageMode": "reviewV2.diff.field.pageMode",
  "asset.mountTrigger": "reviewV2.diff.field.mountTrigger",
  "asset.mountLayer": "reviewV2.diff.field.mountLayer",
};

/* 伺服器之後多比一個欄位、這裡還沒有字時，退回鍵名本身，不讓整塊消失 */
export const reviewDiffFieldLabel = (key: string, t: (k: string) => string, te: (k: string) => boolean) =>
  FIELD_LABELS[key] && te(FIELD_LABELS[key]) ? t(FIELD_LABELS[key]) : key.replace(/^asset\./, "");
