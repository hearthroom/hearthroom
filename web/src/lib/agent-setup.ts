import { PRIMARY_HOST, siteRootOf } from "../../../shared/site-hosts";

/**
 * 「讓 AI Agent 幫你寫卡」與寫卡指南用到的網址。
 *
 * 「讓 AI Agent 幫你寫卡」複製的那句話叫 Agent 去讀 /agent-setup.md（docs/guide/agent-setup.md，
 * 建置時由 build/llms-docs.ts 產出）。統一指向社群主網域，讓複製內容清楚標示官方入口。
 */
export const SKILLS_REPO = "https://github.com/hearthroom/skills";

export function agentSetupUrl(): string {
  return `https://${PRIMARY_HOST}/agent-setup.md`;
}

/** CLI 網站跟著同一個網域家族（cli.sukisuki.ai、cli.hearthroom.club⋯），本機與其他網域用主網域的。 */
export function cliSiteUrl(hostname = location.hostname): string {
  return `https://cli.${siteRootOf(hostname) ?? PRIMARY_HOST}/`;
}

/** 寫卡指南的兩條路。網址 ?way=web 是網頁編輯器；預設（不帶）是 AI Agent。 */
export const GUIDE_WAYS = ["agent", "web"] as const;
export type GuideWay = (typeof GUIDE_WAYS)[number];
export const guideWayOf = (raw: unknown): GuideWay => (raw === "web" ? "web" : "agent");
