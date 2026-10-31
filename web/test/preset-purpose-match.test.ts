import { afterEach, expect, it, vi } from "vitest";
import { fetchModelCatalog } from "../src/lib/presets";
import { presetModelMatches } from "../src/components/preset/preset-share";

afterEach(() => vi.unstubAllGlobals());

it("matches old lane bookmarks to the same model evidence and series as the public model filter", async () => {
 vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{group:"Claude",families:[{family:"Opus",variants:[{value:"opus-ripple"}]},{family:"Sonnet",variants:[{value:"sonnet-ripple"}]}]}]),{headers:{"Content-Type":"application/json"}})));
 const groups = await fetchModelCatalog("fixture");
 expect(presetModelMatches(["model:Opus"], "opus-ripple", groups)).toBe(true);
 expect(presetModelMatches(["series:Claude"], "opus-ripple", groups)).toBe(true);
 expect(presetModelMatches(["model:Opus"], "sonnet-ripple", groups)).toBe(false);
});
