import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGa4 } from "../src/lib/ga4";

beforeEach(() => {
  vi.stubGlobal("location", new URL("https://sukisuki.ai/cards/123?ref=PRIVATE&q=SECRET"));
  Object.defineProperty(document, "referrer", { configurable: true, value: "https://example.com/private?q=SECRET" });
  document.title = "PRIVATE CARD TITLE";
  document.head.querySelectorAll("script[data-hearthroom-ga4]").forEach(el => el.remove());
  vi.stubGlobal("navigator", { userAgent: "Test", globalPrivacyControl: false, doNotTrack: "0" });
  const append = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
    // Inspect the loader without executing Google's script during unit tests.
    if (node instanceof HTMLScriptElement) node.type = "text/plain";
    return append(node);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("GA4 runtime", () => {
  it("queues consent and sanitized config before loading, sends one manual view", () => {
    const ga = createGa4();
    ga.start(true);
    ga.pageView();
    ga.pageView();
    const commands = ga.commands();
    expect(commands[0]).toEqual(["consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" }]);
    expect(commands.find(c => c[0] === "config")?.[2]).toMatchObject({ send_page_view: false, page_location: "https://sukisuki.ai/cards/_", page_title: "card", allow_google_signals: false, cookie_expires: 33696000, cookie_update: false, cookie_domain: "none" });
    expect(commands.filter(c => c[1] === "page_view")).toHaveLength(1);
    expect(JSON.stringify(commands)).not.toMatch(/PRIVATE|SECRET|123/);
    const script = document.querySelector<HTMLScriptElement>("script[data-hearthroom-ga4]")!;
    expect(script.src).toContain("https://www.googletagmanager.com/gtag/js?id=G-K82Q2QC7P4");
    expect(script.referrerPolicy).toBe("no-referrer");
  });

  it("does nothing when disabled, on GPC, or on a sandbox host", () => {
    for (const mode of ["disabled", "gpc", "sandbox"]) {
      vi.stubGlobal("navigator", { globalPrivacyControl: mode === "gpc" });
      vi.stubGlobal("location", new URL(mode === "sandbox" ? "https://c123.sukisuki.ai/" : "https://sukisuki.ai/"));
      const ga = createGa4();
      ga.start(mode !== "disabled"); ga.pageView(); ga.track("topup_click");
      expect(ga.commands()).toEqual([]);
      expect(document.querySelector("script[data-hearthroom-ga4]")).toBeNull();
    }
  });

  it("captures sanitized startup snapshots and leaves page_view to router navigation", () => {
    const ga = createGa4(); ga.prepare();
    ga.pageView(); ga.track("share", { detail: "share_clipboard", subject: "PRIVATE" });
    expect(ga.commands()).toEqual([]);
    vi.stubGlobal("location", new URL("https://sukisuki.ai/wallet"));
    ga.start(true, { clientId: "1.2" });
    const events = ga.commands().filter(c => c[0] === "event");
    expect(events.map(c => c[1])).toEqual(["page_view", "share"]);
    expect(events.every(c => (c[2] as {page_type:string}).page_type === "card")).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE|SECRET|123/);
    ga.pageView();
    expect(ga.commands().filter(c => c[1] === "page_view")).toHaveLength(2);
  });
  it("session before router sends no automatic view; query/hash changes add none", () => {
    const ga = createGa4(); ga.prepare(); ga.start(true);
    expect(ga.commands().filter(c => c[1] === "page_view")).toHaveLength(0);
    ga.pageView();
    vi.stubGlobal("location", new URL("https://sukisuki.ai/cards/123?other=1#new")); ga.pageView();
    expect(ga.commands().filter(c => c[1] === "page_view")).toHaveLength(1);
  });
  it("throttles same-account focus refreshes for 60 seconds without losing identity", async () => {
    const ga = createGa4(); ga.start(true);
    const read = vi.fn(async () => ({userId: "ga1_" + "b".repeat(64), payerType: "plan"}));
    await ga.refreshIdentity(123, read); await ga.refreshIdentity(123, read);
    expect(read).toHaveBeenCalledTimes(1);
    ga.track("topup_click"); expect(ga.commands().filter(c=>c[0]==="set").at(-1)?.[1]).toMatchObject({user_id: "ga1_" + "b".repeat(64)});
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60001);
    await ga.refreshIdentity(123, read); expect(read).toHaveBeenCalledTimes(2);
    await ga.refreshIdentity(456, read); expect(read).toHaveBeenCalledTimes(3);
  });
  it("does not enable debug from a production URL", () => {
    vi.stubGlobal("location", new URL("https://sukisuki.ai/?ga_debug=1"));
    const ga=createGa4(); ga.start(true);
    expect(ga.commands().find(c=>c[0] === "config")?.[2]).not.toHaveProperty("debug_mode");
  });

  it("honors GPC even after initialization and ignores arbitrary events", () => {
    const ga = createGa4(); ga.start(true); ga.pageView();
    const before = ga.commands().length;
    ga.track("share", { detail: "share_clipboard", subject: "PRIVATE" });
    expect(ga.commands().at(-1)).toEqual(["event", "share", expect.objectContaining({ content_type: "card", method: "clipboard", page_location: "https://sukisuki.ai/cards/_" })]);
    ga.track("private-event", { detail: "PRIVATE" });
    expect(ga.commands()).toHaveLength(before + 1);
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    ga.track("topup_click"); ga.pageView();
    expect(ga.commands()).toHaveLength(before + 1);
  });

  it("refreshes the sanitized context on SPA navigation and treats DNT independently", () => {
    const ga = createGa4(); ga.start(true); ga.pageView();
    vi.stubGlobal("navigator", { doNotTrack: "1" });
    vi.stubGlobal("location", new URL("https://sukisuki.ai/en/wallet?private=SECRET"));
    ga.pageView(); ga.track("plan_click", { detail: "wallet" });
    expect(ga.commands().at(-1)).toEqual(["event", "begin_checkout", expect.objectContaining({ page_type: "wallet", item_category: "plan", entry: "wallet", page_referrer: "https://sukisuki.ai/cards/_" })]);
    expect(JSON.stringify(ga.commands())).not.toMatch(/PRIVATE|SECRET/);
  });

  it("uses only a validated server pseudonym and clears it when the account logs out", () => {
    const ga = createGa4(); ga.start(true, { clientId: "1234.5678" });
    ga.identity({ userId: "ga1_" + "a".repeat(64), payerType: "plan" });
    ga.track("topup_click");
    expect(ga.commands().find(c => c[0] === "config")?.[2]).toMatchObject({ client_id: "1234.5678" });
    expect(ga.commands().filter(c=>c[0]==="set").at(-1)?.[1]).toMatchObject({ user_id: "ga1_" + "a".repeat(64), user_properties: { payer_type: "plan" } });
    ga.identity(null); ga.track("topup_click");
    expect(ga.commands().at(-1)?.[2]).not.toHaveProperty("user_id");
    expect(ga.commands().at(-1)?.[2]).not.toHaveProperty("user_properties");
    ga.identity({ userId: "raw-account-id", payerType: "topup" }); ga.track("topup_click");
    expect(JSON.stringify(ga.commands())).not.toContain("raw-account-id");
  });

  it("decorates only trusted Console billing links and removes analytics on GPC", () => {
    const ga = createGa4(); ga.start(true, { clientId: "1234.5678" });
    expect(ga.checkoutUrl("https://console.harperharbor.com/me/billing?plan=month"))
      .toBe("https://console.harperharbor.com/me/billing?plan=month&ga_client_id=1234.5678&ga_source_app=hearthroom");
    expect(ga.checkoutUrl("https://attacker.example/me/billing")).toBe("https://attacker.example/me/billing");
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    expect(ga.checkoutUrl("https://console.harperharbor.com/me/billing?ga_client_id=1234.5678&ga_source_app=hearthroom&plan=month"))
      .toBe("https://console.harperharbor.com/me/billing?plan=month");
  });

  it("does not attach a late identity response after logout", async () => {
    const ga = createGa4(); ga.start(true);
    let finish!: (value: unknown) => void;
    const pending = ga.refreshIdentity(123, () => new Promise(resolve => { finish = resolve; }));
    await ga.refreshIdentity(null, async () => null);
    finish({ userId: "ga1_" + "b".repeat(64), payerType: "topup" });
    await pending; ga.track("topup_click");
    expect(ga.commands().at(-1)?.[2]).not.toHaveProperty("user_id");
  });
  it("counts a second card route without disclosing either card number", () => {
    const ga = createGa4(); ga.start(true); ga.pageView();
    vi.stubGlobal("location", new URL("https://sukisuki.ai/cards/456")); ga.pageView();
    expect(ga.commands().filter(c => c[1] === "page_view")).toHaveLength(2);
    expect(ga.commands().filter(c => c[1] === "page_view").map(c => c[2])).toEqual([
      expect.objectContaining({ page_location: "https://sukisuki.ai/cards/_" }),
      expect.objectContaining({ page_location: "https://sukisuki.ai/cards/_" }),
    ]);
  });
  it("lets Google validate linker data and synchronizes only the resulting numeric client ID", () => {
    const ga = createGa4(); const synchronized = vi.fn();
    ga.start(true, { clientId: "1.2", landingUrl: "https://sukisuki.ai/?_gl=1*checksum*_ga*" + btoa("1234.5678"), onClientId: synchronized });
    expect(ga.commands().find(c => c[0] === "config")?.[2]).not.toHaveProperty("client_id");
    const get = ga.commands().find(c => c[0] === "get" && c[2] === "client_id")!;
    (get[3] as (id: unknown) => void)("1234.5678");
    expect(synchronized).toHaveBeenCalledWith("1234.5678");
    expect(ga.checkoutUrl("https://console.harperharbor.com/me/billing")).toContain("ga_client_id=1234.5678");
  });
  it("restores the Worker ID when Google rejects a stale linker and waits before emitting", () => {
    const ga = createGa4(); const synchronized = vi.fn();
    ga.start(true, { clientId: "1.2", landingUrl: "https://sukisuki.ai/?_gl=1*stale*_ga*" + btoa("1234.5678"), onClientId: synchronized });
    ga.pageView();
    expect(ga.commands().filter(c => c[1] === "page_view")).toHaveLength(0);
    const get = ga.commands().find(c => c[0] === "get" && c[2] === "client_id")!;
    (get[3] as (id: unknown) => void)("9999.8888");
    expect(synchronized).not.toHaveBeenCalled();
    expect(ga.commands().filter(c => c[0] === "config").at(-1)?.[2]).toMatchObject({ client_id: "1.2", send_page_view: false, cookie_domain: "none" });
    expect(ga.commands().filter(c => c[1] === "page_view")).toHaveLength(1);
  });
  it("gets session_id for checkout and removes it on GPC", () => {
    const ga = createGa4(); ga.start(true, { clientId: "1234.5678" });
    const get = ga.commands().find(c => c[0] === "get" && c[2] === "session_id")!;
    (get[3] as (id: unknown) => void)(1790000000);
    expect(ga.checkoutUrl("https://console.harperharbor.com/me/billing")).toContain("ga_session_id=1790000000");
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    expect(ga.checkoutUrl("https://console.harperharbor.com/me/billing?ga_session_id=1790000000")).not.toContain("ga_session_id");
  });
  it("preserves every sanitized SPA context while linker validation is pending", () => {
    const ga = createGa4();
    ga.start(true, { clientId: "1.2", landingUrl: "https://sukisuki.ai/?_gl=1*stale*_ga*" + btoa("1234.5678") });
    ga.pageView(); ga.track("share", { detail: "share_clipboard", subject: "PRIVATE" });
    vi.stubGlobal("location", new URL("https://sukisuki.ai/wallet")); ga.pageView();
    const get = ga.commands().find(c => c[0] === "get" && c[2] === "client_id")!;
    (get[3] as (id: unknown) => void)("1234.5678");
    const events=ga.commands().filter(c => c[0] === "event");
    expect(events.map(c=>c[1])).toEqual(["page_view", "share", "page_view"]);
    expect(events.map(c=>(c[2] as {page_type:string}).page_type)).toEqual(["card", "card", "wallet"]);
  });
});

it("bootstrap completing before router does not send an extra initial view", async () => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(async () => ({ok:true, json:async()=>({enabled:true,clientId:"1.2"})})));
  const api = await import("../src/lib/ga4");
  await api.startGa4();
  expect(window.hearthroomGaData?.filter(c=>c[1] === "page_view")).toHaveLength(0);
  api.ga4PageView();
  expect(window.hearthroomGaData?.filter(c=>c[1] === "page_view")).toHaveLength(1);
});
it("redirect readiness returns after at most three seconds even with a stalled session", async () => {
  vi.useFakeTimers(); vi.resetModules();
  let finish!: (value: unknown) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise(r=>{finish=r;})));
  try {
    const api = await import("../src/lib/ga4");
    const bootstrap = api.startGa4();
    let done = false; const waiting=api.waitForGa4().then(()=>{done=true;});
    await vi.advanceTimersByTimeAsync(2999); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await waiting; expect(done).toBe(true);
    finish({ok:false}); await bootstrap;
  } finally { vi.useRealTimers(); }
});

it("waits for Google readiness before redirecting a queued checkout", async () => {
 const ga=createGa4(); ga.start(true,{clientId:"1.2"});
 let done=false; const waiting=ga.whenReady().then(()=>{done=true;});
 await Promise.resolve(); expect(done).toBe(false);
 const get=ga.commands().find(c=>c[0]==="get"&&c[2]==="session_id")!;
 (get[3] as (value:unknown)=>void)(1790000000);
 await waiting; expect(done).toBe(true);
});
it("records the real router's initial Traditional Chinese home navigation", async () => {
  vi.resetModules();
  vi.stubGlobal("location", new URL("https://sukisuki.ai/"));
  vi.stubGlobal("navigator", {userAgent:"Test",language:"zh-TW",languages:["zh-TW"],globalPrivacyControl:false});
  vi.stubGlobal("fetch", vi.fn(async () => ({ok:true,json:async()=>({enabled:true,clientId:"1.2"})})));
  const api=await import("../src/lib/ga4");
  await api.startGa4();
  vi.doMock("vue-router", async (orig) => {
    const actual=await orig<typeof import("vue-router")>();
    return {...actual,createWebHistory:actual.createMemoryHistory};
  });
  const {router}=await import("../src/router");
  vi.doUnmock("vue-router");
  await router.push("/"); await router.isReady();
  expect(router.currentRoute.value.path).toBe("/");
  expect(window.hearthroomGaData?.filter(c=>c[1]==="page_view")).toHaveLength(1);
  await router.push("/?utm_source=discord#footer");
  expect(window.hearthroomGaData?.filter(c=>c[1]==="page_view")).toHaveLength(1);
});

it("uses global identity settings and explicitly clears them on logout, without identity event params", () => {
 const ga=createGa4(); ga.start(true); ga.pageView();
 expect(ga.commands().filter(c=>c[0]==="set").some(c=>JSON.stringify(c).includes("user_id"))).toBe(false);
 ga.identity({userId:"ga1_"+"a".repeat(64),payerType:"plan"});
 vi.stubGlobal("location",new URL("https://sukisuki.ai/wallet")); ga.pageView();
 ga.identity(null);
 expect(ga.commands().at(-1)).toEqual(["set",{user_id:null,user_properties:{payer_type:null}}]);
 vi.stubGlobal("location",new URL("https://sukisuki.ai/checkin")); ga.pageView(); ga.track("topup_click");
 expect(ga.commands().filter(c=>c[0]==="set" && (c[1] as {user_id?:unknown})?.user_id===null)).toHaveLength(1);
 for(const command of ga.commands().filter(c=>c[0]==="event")) {
  expect(command[2]).not.toHaveProperty("user_id"); expect(command[2]).not.toHaveProperty("user_properties");
 }
});
it("does not discard a validated linker while Google's script takes over three seconds to load", async () => {
 vi.useFakeTimers();
 try {
  const ga=createGa4(); const sync=vi.fn();
  ga.start(true,{clientId:"1.2",landingUrl:"https://sukisuki.chat/?_gl=1*valid*_ga*"+btoa("1234.5678"),onClientId:sync});
  ga.pageView();
  await vi.advanceTimersByTimeAsync(6000);
  expect(ga.commands().filter(c=>c[0]==="config")).toHaveLength(1);
  const get=ga.commands().find(c=>c[0]==="get"&&c[2]==="client_id")!;
  (get[3] as (value:unknown)=>void)("1234.5678");
  expect(sync).toHaveBeenCalledExactlyOnceWith("1234.5678");
  expect(ga.checkoutUrl("https://console.harperharbor.com/me/billing")).toContain("ga_client_id=1234.5678");
 } finally {vi.useRealTimers();}
});
it("accepts a late Google-validated client after the post-load deadline and synchronizes only once", async () => {
 vi.useFakeTimers();
 try {
  const ga=createGa4(); const sync=vi.fn();
  ga.start(true,{clientId:"1.2",landingUrl:"https://sukisuki.chat/?_gl=1*valid*_ga*"+btoa("1234.5678"),onClientId:sync});
  document.querySelector('script[data-hearthroom-ga4]')!.dispatchEvent(new Event('load'));
  await vi.advanceTimersByTimeAsync(3001);
  expect(ga.commands().filter(c=>c[0]==="config").at(-1)?.[2]).toMatchObject({client_id:"1.2"});
  const get=ga.commands().find(c=>c[0]==="get"&&c[2]==="client_id")!;
  (get[3] as (value:unknown)=>void)("1234.5678"); (get[3] as (value:unknown)=>void)("1234.5678");
  expect(sync).toHaveBeenCalledExactlyOnceWith("1234.5678");
  expect(ga.commands().filter(c=>c[0]==="config").at(-1)?.[2]).toMatchObject({client_id:"1234.5678",cookie_domain:"none",send_page_view:false});
 } finally {vi.useRealTimers();}
});
it("does not persist a mismatched or GPC-blocked late linker result", async () => {
 vi.useFakeTimers();
 try {
  for(const gpc of [false,true]) {
   const ga=createGa4(); const sync=vi.fn();
   vi.stubGlobal("navigator",{globalPrivacyControl:false});
   ga.start(true,{clientId:"1.2",landingUrl:"https://sukisuki.chat/?_gl=1*valid*_ga*"+btoa("1234.5678"),onClientId:sync});
   document.querySelectorAll('script[data-hearthroom-ga4]').item(document.querySelectorAll('script[data-hearthroom-ga4]').length-1)!.dispatchEvent(new Event('load'));
   await vi.advanceTimersByTimeAsync(3001);
   vi.stubGlobal("navigator",{globalPrivacyControl:gpc});
   const get=ga.commands().find(c=>c[0]==="get"&&c[2]==="client_id")!;
   (get[3] as (value:unknown)=>void)(gpc?"1234.5678":"9999.8888");
   expect(sync).not.toHaveBeenCalled();
  }
 } finally {vi.useRealTimers();}
});
it("persists a delayed validated linker through a same-origin keepalive POST", async () => {
 vi.useFakeTimers(); vi.resetModules();
 try {
  vi.stubGlobal("location",new URL("https://sukisuki.chat/guide?_gl=1*valid*_ga*"+btoa("1234.5678")));
  const fetcher=vi.fn(async()=>({ok:true,json:async()=>({enabled:true,clientId:"1.2"})}));
  vi.stubGlobal("fetch",fetcher);
  const api=await import("../src/lib/ga4"); await api.startGa4();
  await vi.advanceTimersByTimeAsync(6000);
  const get=window.hearthroomGaData?.map(c=>Array.from(c)).find(c=>c[0]==="get"&&c[2]==="client_id")!;
  (get[3] as (value:unknown)=>void)("1234.5678");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenLastCalledWith("/v1/analytics/session",expect.objectContaining({method:"POST",credentials:"same-origin",keepalive:true,body:JSON.stringify({clientId:"1234.5678"})}));
 } finally {vi.useRealTimers();}
});
