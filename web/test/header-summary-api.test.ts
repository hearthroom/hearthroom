import { afterEach, expect, it, vi } from "vitest";
import { fetchHeaderSummary } from "../src/lib/api";

afterEach(() => vi.unstubAllGlobals());

it("uses legacy endpoints only for the unregistered-route response from an older Worker", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response("404 Not Found", { status: 404 }))
    .mockResolvedValueOnce(Response.json({ error: "identity not found" }, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ error: "header_summary_unavailable" }, { status: 503 })));
  await expect(fetchHeaderSummary("fixture", "harbor", "en")).resolves.toBeNull();
  await expect(fetchHeaderSummary("fixture", "harbor", "en")).rejects.toMatchObject({ status: 404, code: "identity not found" });
  await expect(fetchHeaderSummary("fixture", "harbor", "en")).rejects.toMatchObject({ status: 503 });
});
