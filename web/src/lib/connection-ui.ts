import type { ProviderId } from "./provider";
import { i18n } from "./i18n";
export function connectionMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  const key = `linked.error.${code}`;
  return i18n.global.te(key)
    ? i18n.global.t(key)
    : i18n.global.t("linked.error.generic");
}
export function platformPath(path: string, provider: ProviderId): string {
  return `${path}${path.includes("?") ? "&" : "?"}provider=${provider}`;
}
