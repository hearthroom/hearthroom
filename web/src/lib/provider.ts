/**
 * 目前接的是哪一家供應商，以及它有哪些能力。
 *
 * 獨立成一個沒有任何 import 的檔：api.ts 的頂層常數要讀它，而 harbor.ts 又引用 api.ts——
 * 旗標放在 harbor.ts 的話，瀏覽器依 oauth → harbor → api 的順序載入時會在初始化前讀到它。
 */
export const HARBOR = import.meta.env.VITE_PROVIDER === "harbor";

/** 這家供應商有沒有這項能力。LunaTalk 全部都有；Harbor 目前只有卡片本身、封面與錢包。 */
export const FEATURES = {
  comments: !HARBOR,
  worldbook: !HARBOR,
  regex: !HARBOR,
  library: !HARBOR,
  persona: !HARBOR,
  validation: !HARBOR,
  deleteRole: !HARBOR,
  tags: !HARBOR,
  welcomeExtras: !HARBOR,
  outputContract: !HARBOR,
  chatTest: !HARBOR,
  previewPage: !HARBOR,
} as const;

