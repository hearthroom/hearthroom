import { PRIMARY_HOST, siteRootOf } from "../../../shared/site-hosts";

/**
 * 「讓 AI Agent 幫你寫卡」與寫卡指南用到的網址。
 *
 * 「讓 AI Agent 幫你寫卡」複製的那句話叫 Agent 去讀 /agent-setup.md（docs/guide/agent-setup.md，
 * 建置時由 build/llms-docs.ts 產出）。用讀者當下所在的網域：三個網域出的是同一份，連結不必跨站。
 */
export const SKILLS_REPO = "https://github.com/hearthroom/skills";

export function agentSetupUrl(origin = location.origin): string {
  return new URL("/agent-setup.md", origin).toString();
}

/** CLI 網站跟著同一個網域家族（cli.sukisuki.ai、cli.hearthroom.club⋯），本機與其他網域用主網域的。 */
export function cliSiteUrl(hostname = location.hostname): string {
  return `https://cli.${siteRootOf(hostname) ?? PRIMARY_HOST}/`;
}

