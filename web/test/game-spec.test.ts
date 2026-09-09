import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_SPEC, validateGameSpec } from "../../shared/game-spec";
import { canPlayAsGame, defaultSpecFor, presetFor, specTemplateFor, worldFromSpec } from "@/game/specs";
import tavern from "@/game/samples/tavern.json";
import starship from "@/game/samples/starship.json";
import millennium from "@/game/samples/millennium.json";

describe("validateGameSpec (v2)", () => {
  it("fills every omitted section with the campus defaults", () => {
    const v = validateGameSpec({ version: 2, characters: [{ name: "阿罗娜", accessory: "halo-arc", pos: [0, -3] }] });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.spec.protocol).toEqual(DEFAULT_GAME_SPEC.protocol);
    expect(v.spec.environment.kit).toBe("campus");
    expect(v.spec.lighting.presets.map((p) => p.id)).toEqual(["day", "dusk", "night"]);
    expect(v.spec.characters[0]).toMatchObject({ name: "阿罗娜", accessory: "halo-arc", pos: [0, -3], wander: 2.5 });
    expect(v.spec.characters[0].look.hairStyle).toBe("short");
  });

  it("rejects v1 and reports every problem with a path the author can find", () => {
    expect(validateGameSpec({ version: 1, npcs: [] }).ok).toBe(false);
    const v = validateGameSpec(JSON.stringify({
      version: 2,
      protocol: { actions: { full: "选项", short: "选项{n}短" }, gate: "x" },
      hud: { meters: [{ key: "hp", min: 10, max: 1 }], questRule: { mode: "field-truthy" } },
      lighting: { presets: [{ id: "a", match: "(" }], default: "zzz" },
      environment: { kit: "space", props: [{ shape: "model", pos: [0, 0], size: [1, 1, 1] }], places: [{ match: "(", pos: [0, 0], label: "x" }] },
      characters: [{ name: "a", pos: [1], color: "blue" }, { name: "a" }],
      camera: { minDistance: 30, maxDistance: 10 },
      audio: { sources: { boom: "javascript:alert(1)" }, events: { travel: "nope" }, ambience: { day: "boom" } },
      extra: 1,
    }));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const all = v.errors.join("\n");
    for (const needle of ["protocol.actions", "protocol.gate", "hud.meters[0]", "hud.questRule.field", "lighting.presets[0].match", "lighting.default", "environment.kit", "environment.props[0].url", "environment.places[0].match", "characters[0].pos", "characters[0].color", "characters[1].name duplicated", "camera.minDistance", "audio.sources.boom", "audio.events.travel", "audio.ambience.day", "extra"]) {
      expect(all).toContain(needle);
    }
  });

  it("rejects things that are not JSON objects", () => {
    expect(validateGameSpec("{ not json").ok).toBe(false);
    expect(validateGameSpec([]).ok).toBe(false);
    expect(validateGameSpec(null).ok).toBe(false);
  });

  it("round-trips the template", () => {
    const tpl = specTemplateFor(["阿罗娜", "早濑优香"]);
    const v = validateGameSpec(JSON.parse(JSON.stringify(tpl)));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.spec).toEqual(tpl);
  });
});

describe("genre samples prove the config is data-driven (no code per genre)", () => {
  const samples = { tavern, starship, millennium } as Record<string, unknown>;
  for (const [name, json] of Object.entries(samples)) {
    it(`${name} validates and builds a world`, () => {
      const v = validateGameSpec(json);
      expect(v.errors).toEqual([]);
      if (!v.ok) return;
      const w = worldFromSpec(v.spec, []);
      expect(w.npcs.length).toBe(v.spec.characters.length);
      expect(w.lighting.presets.find((p) => p.id === w.lighting.default)).toBeTruthy();
    });
  }
  it("tavern: interior, no campus kit, its own protocol, two meters, quest by field", () => {
    const v = validateGameSpec(tavern); if (!v.ok) throw new Error(v.errors.join());
    expect(v.spec.environment.kit).toBe("none");
    expect(v.spec.environment.props.length).toBeGreaterThan(5);
    expect(v.spec.protocol.blocks.roles).toBe("tfolk");
    expect(v.spec.hud.meters.map((m) => m.key)).toEqual(["信任", "醉意"]);
    expect(v.spec.hud.questRule).toEqual({ mode: "field-truthy", field: "有事相求" });
    expect(presetFor("深夜的烛光", v.spec.lighting)).toBe("candle");
    expect(presetFor("清晨", v.spec.lighting)).toBe("dawn");
    expect(canPlayAsGame(v.spec.protocol, "<tfolk>[x]\n姓名=a</tfolk>")).toBe(true);
    expect(canPlayAsGame(v.spec.protocol, "<zzroles></zzroles>")).toBe(false);
  });
  it("starship: gate on the hud block, alert lighting, follow camera, HP meter range", () => {
    const v = validateGameSpec(starship); if (!v.ok) throw new Error(v.errors.join());
    expect(canPlayAsGame(v.spec.protocol, "<panel>[舰况]\n舰时=x</panel>")).toBe(true);
    expect(presetFor("红色警报", v.spec.lighting)).toBe("alert");
    expect(v.spec.camera.dialogue).toBe("follow");
    expect(v.spec.hud.meters[0]).toMatchObject({ key: "HP", min: 0, max: 200 });
  });
  it("millennium (the demo card) keeps its models, halos and audio mapping", () => {
    const v = validateGameSpec(millennium); if (!v.ok) throw new Error(v.errors.join());
    expect(v.spec.characters.map((c) => c.accessory)).toEqual(["halo-arc", "halo-hex", "halo-ring"]);
    expect(v.spec.characters[0].model?.url).toContain("/game/models/arona/character.glb");
    expect(v.spec.audio.ambience).toEqual({ day: "ambience-day", dusk: "ambience-dusk", night: "ambience-night" });
    expect(v.spec.audio.events.meterUp).toBe("affection-up");
  });
});

describe("worldFromSpec", () => {
  it("puts characters the spec forgot on stage with a stable generated look", () => {
    const spec = defaultSpecFor([]);
    const w = worldFromSpec({ ...spec, characters: [{ name: "阿罗娜", color: "#5ec2f5", look: { hair: "#8fd3ff", hairStyle: "bob" }, accessory: "halo-arc", pos: [0, -3], face: 3.14, wander: 1, model: { url: "https://cdn.example/arona.glb" } }] }, ["阿罗娜", "早濑优香"]);
    expect(w.npcs.map((n) => n.name)).toEqual(["阿罗娜", "早濑优香"]);
    expect(w.npcs[0].model?.url).toBe("https://cdn.example/arona.glb");
    expect(w.npcs[1].accessory).not.toBe("none");
    expect(worldFromSpec({ ...spec, environment: { ...spec.environment, kit: "none" } }, ["x"]).npcs[0].accessory).toBe("none");
  });
  it("turns place matchers into regular expressions", () => {
    const spec = defaultSpecFor([]);
    const w = worldFromSpec({ ...spec, environment: { ...spec.environment, places: [{ match: "研讨会|会计", pos: [-12, 3], label: "研讨会大楼" }] } }, ["x"]);
    expect(w.places[0].match.test("千年研讨会办公室")).toBe(true);
    expect(w.places[0].match.test("商业街")).toBe(false);
  });
});
