import type { Composer } from "vue-i18n";
import { ADVANCED_PARAMS, BASIC_PARAMS, paramState, type ParamKey, type PresetDocument } from "@/lib/st-preset";

/** 數值參數的合理範圍：超出就擋存檔，不替玩家夾回範圍內。 */
export const PARAM_RANGE: Partial<Record<ParamKey, { min: number; max: number; step: number }>> = {
  temperature: { min: 0, max: 2, step: 0.05 },
  top_p: { min: 0, max: 1, step: 0.01 },
  top_a: { min: 0, max: 1, step: 0.01 },
  min_p: { min: 0, max: 1, step: 0.01 },
  frequency_penalty: { min: -2, max: 2, step: 0.05 },
  presence_penalty: { min: -2, max: 2, step: 0.05 },
  repetition_penalty: { min: 1, max: 2, step: 0.01 },
  top_k: { min: 0, max: 500, step: 1 },
  seed: { min: -1, max: 2147483647, step: 1 },
  openai_max_tokens: { min: 1, max: 100000, step: 1 },
};
export const PARAM_CHOICES: Partial<Record<ParamKey, string[]>> = {
  reasoning_effort: ["low", "medium", "high"],
  verbosity: ["low", "medium", "high"],
};

export function paramInvalid(doc: PresetDocument, key: ParamKey): boolean {
  const { value, adopted } = paramState(doc, key);
  const range = PARAM_RANGE[key];
  return adopted && !!range && (typeof value !== "number" || value < range.min || value > range.max);
}

export const invalidParams = (doc: PresetDocument): ParamKey[] => [...BASIC_PARAMS, ...ADVANCED_PARAMS].filter((k) => paramInvalid(doc, k));
export const anyParamInvalid = (doc: PresetDocument) => invalidParams(doc).length > 0;

/** 參數在文案裡的名字（key 用駝峰，跟酒館的欄位名分開）。 */
const PARAM_COPY: Record<ParamKey, string> = {
  temperature: "temperature", top_p: "topP", top_k: "topK", top_a: "topA", min_p: "minP",
  frequency_penalty: "frequencyPenalty", presence_penalty: "presencePenalty", repetition_penalty: "repetitionPenalty",
  seed: "seed", openai_max_tokens: "outputTokenCap", reasoning_effort: "reasoningEffort", verbosity: "verbosity",
};
export const paramLabelKey = (key: ParamKey) => `preset.params.${PARAM_COPY[key]}`;

type T = Composer["t"];
type Te = Composer["te"];

/**
 * 酒館設定鍵的顯示名。連線與模型類的鍵合成一個名字、不列值；表裡沒有的直接顯示原鍵名
 * （酒館玩家認得），只當純文字。
 */
export function settingLabel(key: string, t: T, te: Te): string {
  if (/^(custom_url|proxy_password|reverse_proxy)$|_(model|endpoint)$/.test(key)) return t("preset.setting.connection");
  if (key in PARAM_COPY) return t(paramLabelKey(key as ParamKey));
  if (key === "stop_sequences") return t("preset.setting.stop");
  return te(`preset.setting.${key}`) ? t(`preset.setting.${key}`) : key;
}

/** 欄位層級的原因句，{name} 是設定的顯示名。requires_model_validation 依標示分兩句。 */
export function fieldReason(code: string, status: string | undefined, name: string, t: T, te: Te): string {
  const variant = code === "requires_model_validation" ? (status === "unsupported" ? ".unsupported" : ".adjust") : "";
  const key = `preset.reason.field.${code}${variant}`;
  return te(key) ? t(key, { name }) : "";
}
