import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGameSpec } from "@/lib/api";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fetchGameSpec", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("fills a sparse stored config with defaults so pages get the full shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { roleId: "r", updatedAt: 1, spec: { version: 2, characters: [{ name: "阿罗娜" }] } })));
    const rec = await fetchGameSpec("r");
    expect(rec?.spec.protocol.fields.name).toBe("名字");
    expect(rec?.spec.hud.meters[0].key).toBe("好感度");
    expect(rec?.spec.characters[0].pos).toEqual([0, 0]);
  });
  it("treats a broken stored config as no config instead of crashing the page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { roleId: "r", updatedAt: 1, spec: { version: 1, npcs: [] } })));
    expect(await fetchGameSpec("r")).toBeNull();
  });
  it("404 means no config", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(404, { error: "no game config" })));
    expect(await fetchGameSpec("r")).toBeNull();
  });
});
