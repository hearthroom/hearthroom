import { appShell, gaCampaign, gaEvent, gaPage } from "./ga4-payload";
import { analyticsIdentity, validClientId, type AnalyticsIdentity } from "../../../shared/ga4";
import { SITE_HOSTS } from "../../../shared/site-hosts";
import { captureGa4Source, ga4SignupVia } from "./ga4-attribution";

const MEASUREMENT_ID = "G-K82Q2QC7P4";
type Command = IArguments;
type Data = { detail?: string; subject?: string; ok?: boolean };
/** This is a candidate only; Google must independently resolve the same ID. */
function linkerCandidate(href: string): string | null {
  try {
    const token = new URL(href).searchParams.get("_gl")?.match(/(?:^|\*)_ga\*([^*]+)/)?.[1];
    if (!token || token.length > 128) return null;
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/").replace(/\./g, "=");
    const value = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return validClientId(value) ? value : null;
  } catch { return null; }
}
declare global { interface Window { hearthroomGaData?: Command[]; "ga-disable-G-K82Q2QC7P4"?: boolean } }

/** Only validated pseudonyms and route templates leave this adapter. */
export function createGa4() {
  let enabled = false;
  let initialized = false;
  let lastLocation = "";
  let lastNavigation = "";
  let referrer = "";
  let shell = "web";
  let clientId: string | undefined;
  let identity: AnalyticsIdentity | null = null;
  let landingUrl = "";
  let accountGeneration = 0;
  let onClientId: ((clientId: string) => void) | undefined;
  let sessionId: string | undefined;
  let linkerPending = false;
  const pendingEvents: { name: string; params: Record<string, unknown>; page?: boolean }[] = [];
  const commands: Command[] = [];
  const allowed = () => {
    const gpc = typeof navigator === "undefined" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
    if (typeof window !== "undefined") window["ga-disable-G-K82Q2QC7P4"] = gpc || !enabled;
    if (gpc) identity = null;
    return enabled && !gpc;
  };
  const context = () => allowed() ? gaPage(location.href, referrer) : null;
  // gtag consumes Arguments objects, matching the official dataLayer snippet.
  function send(..._args: unknown[]) { commands.push(arguments); }
  function emit(event: { name: string; params: Record<string, unknown>; page?: boolean }) {
    if (event.page) send("set", event.params);
    send("event", event.name, event.params);
  }

  function initialize(): boolean {
    if (!allowed()) return false;
    if (initialized) return true;
    const page = context();
    if (!page) return false;
    try {
      const twa = document.referrer === "android-app://club.hearthroom.app" || sessionStorage.getItem("hearthroom.ga4.twa") === "1";
      if (twa) sessionStorage.setItem("hearthroom.ga4.twa", "1");
      shell = appShell({ twa, userAgent: navigator.userAgent, standalone: window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone });
    } catch { shell = appShell({ userAgent: navigator.userAgent, referrer: document.referrer }); }
    window.hearthroomGaData = commands;
    send("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    send("js", new Date());
    send("set", { ...page, allow_google_signals: false, allow_ad_personalization_signals: false });
    send("set", "linker", { domains: [...SITE_HOSTS], accept_incoming: true });
    const linked = linkerCandidate(landingUrl || location.href);
    send("config", MEASUREMENT_ID, { ...page, ...gaCampaign(landingUrl || location.href), ...(clientId && !linked ? { client_id: clientId } : {}), send_page_view: false,
      cookie_expires: 390 * 86400, cookie_update: false, cookie_flags: "SameSite=Lax;Secure",
      ...(new URL(landingUrl || location.href).searchParams.get("ga_debug") === "1" ? { debug_mode: true } : {}),
      ignore_referrer: /https:\/\/console\.harperharbor\.com\//.test(document.referrer),
      allow_google_signals: false, allow_ad_personalization_signals: false });
    if (linked) {
      linkerPending = true;
      const settle = (value: unknown) => {
        if (!linkerPending) return;
        clearTimeout(timer);
        if (allowed()) {
          if (validClientId(value) && value === linked) { clientId = value; onClientId?.(value); }
          else send("config", MEASUREMENT_ID, { client_id: clientId, send_page_view: false,
            cookie_expires: 390 * 86400, cookie_update: false, cookie_flags: "SameSite=Lax;Secure" });
        }
        linkerPending = false;
        for (const event of pendingEvents.splice(0)) if (allowed()) emit(event);
      };
      const timer = setTimeout(() => settle(null), 3000);
      send("get", MEASUREMENT_ID, "client_id", settle);
    }
    send("get", MEASUREMENT_ID, "session_id", (value: unknown) => {
      const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value : "";
      if (allowed() && /^[1-9][0-9]{0,19}$/.test(text)) sessionId = text;
    });
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}&l=hearthroomGaData`;
    script.referrerPolicy = "no-referrer";
    script.dataset.hearthroomGa4 = "";
    document.head.appendChild(script);
    window.addEventListener("focus", allowed);
    initialized = true;
    return true;
  }

  const params = () => {
    const page = context();
    if (!page) return null;
    const locale = document.documentElement.lang;
    return { ...page, app_shell: shell, ui_locale: ["zh-Hant", "zh-Hans", "en", "ja", "ko"].includes(locale) ? locale : "zh-Hant",
      user_id: identity?.userId ?? null, user_properties: { payer_type: identity?.payerType ?? null } };
  };

  const tracker = {
    start(value: boolean, options: { clientId?: string; landingUrl?: string; onClientId?: (clientId: string) => void } = {}) {
      enabled = value;
      clientId = validClientId(options.clientId) ? options.clientId : undefined;
      landingUrl = options.landingUrl ?? location.href;
      onClientId = options.onClientId;
      referrer = document.referrer;
      initialize();
    },
    identity(value: unknown) {
      identity = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true ? null : analyticsIdentity(value);
    },
    async refreshIdentity(account: number | null, read: () => Promise<unknown>) {
      const generation = ++accountGeneration;
      identity = null;
      if (!account || !allowed()) return;
      try {
        const value = await read();
        if (generation === accountGeneration && allowed()) identity = analyticsIdentity(value);
      } catch { /* Missing analytics permissions do not affect sign-in. */ }
    },
    active: allowed,
    checkoutUrl(href: string): string {
      try {
        const url = new URL(href);
        if (url.origin !== "https://console.harperharbor.com" || url.pathname !== "/me/billing") return href;
        url.searchParams.delete("ga_client_id"); url.searchParams.delete("ga_source_app");
        url.searchParams.delete("ga_session_id");
        if (allowed() && clientId) {
          url.searchParams.set("ga_client_id", clientId);
          url.searchParams.set("ga_source_app", "hearthroom");
          if (sessionId) url.searchParams.set("ga_session_id", sessionId);
        }
        return url.href;
      } catch { return href; }
    },
    pageView() {
      if (!initialize()) return;
      const page = params();
      if (!page || location.href === lastNavigation) return;
      referrer = lastLocation || document.referrer;
      const view = params()!;
      const event = { name: "page_view", params: view, page: true };
      if (linkerPending) pendingEvents.push(event); else emit(event);
      lastLocation = String(page.page_location);
      lastNavigation = location.href;
    },
    track(event: string, data: Data = {}) {
      if (!initialize()) return;
      const page = params();
      if (!page) return;
      const mapped = gaEvent(event, data, String(page.page_type));
      if (mapped) {
        const queued = { name: mapped.name, params: { ...page, ...mapped.params } };
        if (linkerPending) pendingEvents.push(queued); else emit(queued);
      }
    },
    /** Read-only snapshots for deterministic outbound contract tests. */
    commands: () => commands.map(command => Array.from(command)),
  };
  return tracker;
}

const ga4 = createGa4();
// Release enables this only after property auto-collection settings and privacy copy are verified.
let ready: Promise<void> = Promise.resolve();
export function startGa4() { ready = initializeGa4(); return ready; }
async function initializeGa4() {
  const optedOut = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  const landingUrl = location.href;
  captureGa4Source(landingUrl);
  if (!gaPage(landingUrl)) return;
  try {
    const response = await fetch("/v1/analytics/session", { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "X-Hearthroom-Request": "1", ...(optedOut ? { "X-Analytics-Opt-Out": "1" } : {}) }, signal: AbortSignal.timeout(3000) });
    if (optedOut) return;
    if (!response.ok) return;
    const session = await response.json() as { enabled?: boolean; clientId?: string };
    if (session.enabled !== true || !validClientId(session.clientId)) return;
    ga4.start(true, { clientId: session.clientId, landingUrl, onClientId: clientId => {
      if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true) return;
      void fetch("/v1/analytics/session", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "X-Hearthroom-Request": "1", "Content-Type": "application/json" }, body: JSON.stringify({ clientId }), signal: AbortSignal.timeout(3000) }).catch(() => {});
    } });
    ga4.pageView();
  } catch { /* Analytics must never interrupt navigation or login. */ }
}
export const ga4PageView = () => ga4.pageView();
export const trackGa4 = (event: string, data: Data = {}) => ga4.track(event, data);
export const setGa4Identity = (value: unknown) => ga4.identity(value);
export const ga4CheckoutUrl = (href: string) => ga4.checkoutUrl(href);
let identityReady: Promise<void> = Promise.resolve();
export function refreshGa4Account(account: number | null, read: () => Promise<unknown>) {
  identityReady = ready.then(() => ga4.refreshIdentity(account, read));
  return identityReady;
}
export async function recordGa4Login(token: () => Promise<string | null>) {
  await ready;
  await identityReady;
  if (!ga4.active()) return;
  let first = false;
  try {
    const accessToken = await token();
    if (accessToken) {
      const response = await fetch("/v1/analytics/signup", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "X-Hearthroom-Request": "1", Authorization: `Bearer ${accessToken}`, "X-Provider": "harbor" }, signal: AbortSignal.timeout(3000) });
      first = response.ok && (await response.json() as { first?: boolean }).first === true;
    }
  } catch { /* If registration cannot be verified, report a login only. */ }
  ga4.track(first ? "ga_sign_up" : "ga_login", { detail: ga4SignupVia() });
}
/** Decorate on the actual click so async initialization and GPC changes are respected. */
export function decorateGa4Checkout(event: MouseEvent) {
  const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
  if (anchor) anchor.href = ga4.checkoutUrl(anchor.href);
}
