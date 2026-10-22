import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const listeners = new Map<string, (event: any) => void>();
  const fetch = vi.fn(async () => new Response("network"));
  const match = vi.fn(async () => new Response("offline"));
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self: { location: { origin: "https://sukisuki.ai" }, addEventListener: (name: string, handler: any) => listeners.set(name, handler) },
    URL, Response, fetch, caches: { match },
  });
  return { fetch, match, request: (url: string, mode = "navigate") => {
    const respondWith = vi.fn();
    listeners.get("fetch")!({ request: { url, mode }, respondWith });
    return respondWith;
  } };
}

describe("route handoff navigation through the service worker", () => {
  it.each(["", "?request=invalid&_hr_app=twa"])("leaves the prepare navigation to the browser (%s)", suffix => {
    const sw = worker();
    expect(sw.request("https://sukisuki.ai/auth/route/prepare" + suffix)).not.toHaveBeenCalled();
    expect(sw.fetch).not.toHaveBeenCalled();
  });

  it("keeps ordinary navigations and the handoff UI on the offline recovery path", async () => {
    const sw = worker();
    sw.fetch.mockRejectedValue(new Error("offline"));
    for (const path of ["/en/", "/auth/route/complete", "/auth/route/prepare-extra"]) {
      const response = sw.request("https://sukisuki.ai" + path);
      expect(await (await response.mock.calls[0][0]).text()).toBe("offline");
    }
    expect(sw.match).toHaveBeenCalledTimes(3);
  });

  it("keeps API requests outside the navigation handler", () => {
    const sw = worker();
    expect(sw.request("https://sukisuki.ai/auth/route/prepare?request=invalid", "cors")).not.toHaveBeenCalled();
    expect(sw.fetch).not.toHaveBeenCalled();
  });
});
