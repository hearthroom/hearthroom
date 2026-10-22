import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "vue";
import { backgroundCheckAllowed, openRoutesDialog, routesAvailable, routesState } from "@/lib/routes";
import { confirmState, settleConfirm } from "@/lib/confirm";
import { useRouteSwitch } from "@/components/routes/use-route-switch";
import { lineByNumber } from "@/lib/route-lines";

const session = vi.hoisted(() => ({ me: null }));
vi.mock("@/lib/session", () => ({ useSession: () => session }));
vi.mock("@/lib/track", () => ({ track: () => {} }));
vi.mock("@/lib/pwa", () => ({ isStandalone: () => true }));

const ua = "Mozilla/5.0 HearthroomApp/1.0.13";
function official(host = "sukisuki.ai") {
  vi.stubGlobal("location", { hostname: host, host, origin: `https://${host}`, pathname: "/en/search", search: "?q=cat", hash: "#a", assign: vi.fn() });
}
function native() {
  official();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  const postMessage = vi.fn();
  vi.stubGlobal("HearthroomRoutes", { postMessage });
  return postMessage;
}
beforeEach(() => { sessionStorage.clear(); routesState.dialogOpen = false; });
afterEach(() => { if (confirmState.current) settleConfirm(false); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });

it("keeps TWA entries available even with the launch marker", () => {
  official(); sessionStorage.setItem("hearthroom.androidApp", "1");
  expect(routesAvailable({ hostname: "sukisuki.ai", ua: "Mozilla/5.0 Chrome/124" })).toBe(true);
});
it("shows new WebView native entries but keeps old WebViews without a bridge compatible", () => {
  native();
  expect(routesAvailable()).toBe(true);
  vi.stubGlobal("HearthroomRoutes", undefined);
  expect(routesAvailable()).toBe(false);
});
it("opens the native picker without opening a web picker or probing", async () => {
  const postMessage = native();
  expect(backgroundCheckAllowed({ immersive: false })).toBe(false);
  await openRoutesDialog();
  expect(postMessage).toHaveBeenCalledExactlyOnceWith("open");
  expect(routesState.dialogOpen).toBe(false);
});
it("never exposes the native picker on a card host or nonstandard origin", () => {
  native(); official("play.sukisuki.ai");
  expect(routesAvailable()).toBe(false);
  official(); Object.assign(location, { origin: "https://sukisuki.ai:8443" });
  expect(routesAvailable()).toBe(false);
});
it("asks before opening native routes with unsaved work and respects cancellation", async () => {
  const postMessage = native();
  const protect = (e: Event) => e.preventDefault();
  window.addEventListener("beforeunload", protect);
  try {
    const result = openRoutesDialog();
    expect(confirmState.current).not.toBeNull();
    expect(postMessage).not.toHaveBeenCalled();
    settleConfirm(false);
    await result;
    expect(postMessage).not.toHaveBeenCalled();
    const accepted = openRoutesDialog();
    settleConfirm(true);
    await accepted;
    expect(postMessage).toHaveBeenCalledExactlyOnceWith("open");
  } finally { window.removeEventListener("beforeunload", protect); }
});
it("keeps TWA switching in the same window while a standalone PWA still opens a browser", async () => {
  official();
  const open = vi.fn(); vi.stubGlobal("open", open);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null)));
  sessionStorage.setItem("hearthroom.androidApp", "1");
  const instances: ReturnType<typeof createApp>[] = [];
  try {
    let twa!: ReturnType<typeof useRouteSwitch>;
    const app = createApp({ setup() { twa = useRouteSwitch("routes_dialog"); return () => null; } });
    app.mount(document.createElement("div")); instances.push(app);
    expect(twa.standalone).toBe(false);
    await twa.start(lineByNumber(3)!);
    expect(location.assign).toHaveBeenCalledWith("https://sukisuki.chat/en/search?q=cat&_hr_app=twa#a");
    expect(open).not.toHaveBeenCalled();
    sessionStorage.clear();
    let pwa!: ReturnType<typeof useRouteSwitch>;
    const other = createApp({ setup() { pwa = useRouteSwitch("routes_dialog"); return () => null; } });
    other.mount(document.createElement("div")); instances.push(other);
    expect(pwa.standalone).toBe(true);
    await pwa.start(lineByNumber(3)!);
    expect(open).toHaveBeenCalledWith("https://sukisuki.chat/en/search?q=cat#a", "_blank", "noopener");
  } finally { instances.forEach(app => app.unmount()); }
});
