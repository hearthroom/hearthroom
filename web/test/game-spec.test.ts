import { describe, expect, it } from "vitest";
import { validateGameSpec } from "../../shared/game-spec";
import { WORLD_SPECS, defaultWorldFor, specTemplateFor, worldFromSpec } from "@/game/specs";

const DEMO = "a7a2b00b-d8aa-4bbe-8292-5df001dfe65a";

describe("validateGameSpec", () => {
  it("accepts a minimal spec and normalizes it", () => {
    const v = validateGameSpec({ version: 1, npcs: [{ name: "阿罗娜", halo: "arc", pos: [0, -3] }] });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.spec).toEqual({ version: 1, npcs: [{ name: "阿罗娜", halo: "arc", pos: [0, -3] }] });
  });

  it("reports every problem with a path the author can find", () => {
    const v = validateGameSpec(JSON.stringify({
      version: 2,
      npcs: [{ name: "a", pos: [1], color: "blue", model: { url: "ftp://x" } }, { name: "a" }],
      places: [{ match: "(", pos: [0, 0], label: "x" }],
      buildings: [{ pos: [0, 0], size: [1, 1] }],
      audio: { boom: "/x.mp3", footstep: "javascript:alert(1)" },
      sky: "http://insecure/x.png",
    }));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const all = v.errors.join("\n");
      for (const needle of ["version", "npcs[0].pos", "npcs[0].color", "npcs[0].model.url", "npcs[1].name duplicated", "places[0].match", "buildings[0]", "audio.boom", "audio.footstep", "sky"]) {
        expect(all).toContain(needle);
      }
    }
  });

  it("rejects things that are not JSON objects", () => {
    expect(validateGameSpec("{ not json").ok).toBe(false);
    expect(validateGameSpec([]).ok).toBe(false);
    expect(validateGameSpec(null).ok).toBe(false);
  });

  it("round-trips the bundled demo template", () => {
    const tpl = specTemplateFor(DEMO, []);
    const v = validateGameSpec(JSON.parse(JSON.stringify(tpl)));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.spec.npcs.map((n) => n.name)).toEqual(WORLD_SPECS[DEMO].npcs.map((n) => n.name));
      expect(v.spec.player?.url).toContain("/game/models/sensei/");
      expect(v.spec.audio?.footstep).toBe("/game/audio/footstep.mp3");
    }
  });
});

describe("worldFromSpec", () => {
  it("fills what the author left out from the generic campus and keeps characters the spec forgot", () => {
    const w = worldFromSpec({ version: 1, npcs: [{ name: "阿罗娜", model: { url: "https://cdn.example/arona.glb" } }] }, ["阿罗娜", "早濑优香"]);
    expect(w.npcs.map((n) => n.name)).toEqual(["阿罗娜", "早濑优香"]);
    expect(w.npcs[0].model?.url).toBe("https://cdn.example/arona.glb");
    expect(w.npcs[0].pos).toEqual(defaultWorldFor(["阿罗娜"]).npcs[0].pos);
    expect(w.buildings.length).toBeGreaterThan(0);
    expect(w.places.length).toBeGreaterThan(0);
    expect(w.sky).toBeUndefined();
  });

  it("turns place matchers into regular expressions", () => {
    const w = worldFromSpec({ version: 1, npcs: [], places: [{ match: "研讨会|会计", pos: [-12, 3], label: "研讨会大楼" }] }, ["x"]);
    expect(w.places[0].match.test("千年研讨会办公室")).toBe(true);
    expect(w.places[0].match.test("商业街")).toBe(false);
  });
});
