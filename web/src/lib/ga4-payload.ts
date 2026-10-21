import { siteRootOf, isCardAppHost } from "../../../shared/site-hosts";

type Params = Record<string, string | number>;
export interface GaEvent { name: string; params: Params }
interface EventData { detail?: string; subject?: string; ok?: boolean }

/** Only route templates may leave the site; never document.title or a raw URL. */
function route(url: URL): { path: string; type: string } | null {
  const prefix = /^\/(zh-Hant|zh-Hans|en|ja|ko)(?=\/|$)/.exec(url.pathname)?.[0] ?? "";
  const bare = url.pathname.slice(prefix.length).replace(/\/$/, "") || "/";
  if (isCardAppHost(url.hostname)) {
    if (bare === "/login" || bare === "/auth/callback") return { path: bare, type: "login" };
    return { path: "/_/", type: "play" };
  }
  if (/^\/review(?:\/|$)/.test(bare)) return null;
  const masked: [RegExp, string, string][] = [
    [/^\/cards\/[^/]+\/edit$/, "/cards/_/edit", "editor"],
    [/^\/cards\/[^/]+$/, "/cards/_", "card"],
    [/^\/authors\/[^/]+$/, "/authors/_", "author"],
    [/^\/play\/[^/]+$/, "/play/_", "play"],
    [/^\/campaign\/[^/]+$/, "/campaign/_", "campaign"],
    [/^\/blog(?:\/[^/]+){0,2}$/, "/blog", "blog"],
  ];
  for (const [pattern, path, type] of masked) if (pattern.test(bare)) return { path: prefix + path, type };
  const fixed: Record<string, string> = {
    "/": "board", "/search": "search", "/library": "library", "/me": "me", "/mine": "mine",
    "/me/badges": "me", "/me/community": "me", "/me/notifications": "me", "/me/referral": "me",
    "/create": "editor", "/wallet": "wallet", "/checkin": "checkin", "/go/plan": "plan", "/go/topup": "wallet",
    "/resources": "resources", "/settings": "settings", "/developers": "developers", "/download": "download",
    "/guide": "guide", "/privacy": "privacy", "/updates": "updates", "/campaigns": "campaign", "/login": "login", "/auth/callback": "login",
  };
  return fixed[bare] ? { path: prefix + bare, type: fixed[bare] } : { path: "/404", type: "404" };
}

export interface GaPage { page_location: string; page_title: string; page_type: string; page_referrer: string }
export function gaPage(href: string, referrer = ""): GaPage | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || !siteRootOf(url.hostname)) return null;
    const page = route(url);
    if (!page) return null;
    let previous = "";
    try {
      const ref = new URL(referrer);
      if (["https:", "http:"].includes(ref.protocol)) {
        previous = siteRootOf(ref.hostname) ? (route(ref) ? ref.origin + route(ref)!.path : "") : ref.origin + "/";
      }
    } catch { /* Empty or malformed referrers contain no useful attribution. */ }
    return { page_location: url.origin + page.path, page_title: page.type, page_type: page.type, page_referrer: previous };
  } catch { return null; }
}

/** Marketing input is restricted to operational source/medium vocabularies. */
export function gaCampaign(href: string): Params {
  const url = new URL(href);
  const query = url.searchParams;
  const source = query.get("utm_source") ?? "";
  const medium = query.get("utm_medium") ?? "";
  if ([...query.keys()].some(key => key.startsWith("utm_"))) {
    const params: Params = {};
    if (["discord", "line", "x", "threads", "reddit", "blog", "newsletter"].includes(source)) params.campaign_source = source;
    if (["social", "community", "email", "referral"].includes(medium)) params.campaign_medium = medium;
    const campaign = query.get("utm_campaign") ?? "";
    if (params.campaign_source && /^[a-z0-9][a-z0-9-]{0,63}$/.test(campaign)) params.campaign_name = campaign;
    return params;
  }
  if (query.has("s")) return { campaign_source: "campaign_share", campaign_medium: "referral" };
  if (query.has("ref")) return { campaign_source: /\/cards\/[^/]+/.test(url.pathname) ? "card_share" : "invite", campaign_medium: "referral" };
  return {};
}

export function appShell(input: { userAgent?: string; referrer?: string; twa?: boolean; standalone?: boolean }): string {
  if (/ HearthroomApp\//.test(input.userAgent ?? "")) return "webview";
  if (input.twa || input.referrer === "android-app://club.hearthroom.app") return "twa";
  return input.standalone ? "pwa" : "web";
}

/** An allowlist, not a generic parameter forwarder. `subject` is deliberately unused. */
export function gaEvent(event: string, data: EventData, page: string): GaEvent | null {
  if (data.ok === false) return null;
  const detail = data.detail ?? "";
  const make = (name: string, params: Params = {}): GaEvent => ({ name, params });
  if (event === "campaign_share") return make("share", { method: "clipboard", content_type: "campaign" });
  if (event === "invite_click" && detail === "invite_copy") return make("share", { method: "clipboard", content_type: "invite" });
  if (event === "pwa_card_install_click") return make("pwa_install", { outcome: "click", where: "card" });
  if (event === "ga_login") return make("login", { method: "harper" });
  if (event === "ga_sign_up") return make("sign_up", { method: "harper", signup_via: ["invite", "card_share", "campaign_share"].includes(detail) ? detail : "none" });
  if (event === "topup_click" || event === "plan_click") {
    const entry = page === "wallet" ? "wallet" : page === "checkin" ? "newcomer" : "profile";
    return make("begin_checkout", { item_category: event === "plan_click" ? "plan" : "topup", entry });
  }
  if (event === "credits_shortfall_click" && ["plan", "topup"].includes(detail)) return make("begin_checkout", { item_category: detail, entry: "shortfall" });
  if (event === "credits_shortfall_shown" || event === "credits_shortfall_click") return make("credits_shortfall", { action: event.endsWith("shown") ? "shown" : "click" });
  if (event === "checkin_claim" && ["daily", "newcomer", "task"].includes(detail)) return make(event, { kind: detail });
  if (event === "chat_start" || event === "first_chat") return make(event);
  if (event === "android_download") return make("file_download", { file_extension: "apk", file_name: "hearthroom-android" });
  if (event === "tour_begin" || event === "newcomer_tour_begin") return make("tutorial_begin", {
    tour: event === "tour_begin" ? "coach" : "newcomer", ...(event === "newcomer_tour_begin" && /^[1-7]$/.test(detail) ? { day: Number(detail) } : {}),
  });
  if (event === "share" || event === "blog_share") {
    const method = detail.replace(/^share_/, "");
    if (!["web", "clipboard", "manual", "line", "x", "facebook", "telegram", "whatsapp", "reddit", "threads", "bluesky", "weibo", "discord", "qq", "wechat"].includes(method)) return null;
    const content = event === "blog_share" || page === "blog" ? "blog" : page === "campaign" ? "campaign" : ["card", "play"].includes(page) ? "card" : "invite";
    return make("share", { method, content_type: content });
  }
  if (["tour_done", "newcomer_tour_done"].includes(event)) {
    const params: Params = { tour: event.startsWith("newcomer") ? "newcomer" : "coach" };
    if (event.startsWith("newcomer") && /^[1-7]$/.test(detail)) params.day = Number(detail);
    return make("tutorial_complete", params);
  }
  if (/^pwa_install_(click|later)$/.test(event)) return make("pwa_install", { outcome: event.slice(12), where: ["card", "play"].includes(page) ? "card" : "site" });
  return null;
}
