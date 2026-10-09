import { describe, expect, it } from "vitest";
import { acceptFor, canonicalType, formatLabel, kindOf } from "../src/lib/media-type";

const f = (name: string, type = "") => new File(["x"], name, { type });

describe("canonical upload type", () => {
  it.each([
    ["card.js", "text/javascript", "text/javascript"],
    ["card.js", "application/x-javascript", "text/javascript"],
    ["card.js", "application/javascript", "text/javascript"],
    ["module.mjs", "", "text/javascript"],
    ["engine.wasm", "", "application/wasm"],
    ["engine.wasm", "application/octet-stream", "application/wasm"],
    ["save.json", "application/json", "application/json"],
    ["save.json", "", "application/json"],
    ["icon.svg", "image/svg+xml", "image/svg+xml"],
    ["icon.svg", "", "image/svg+xml"],
    ["clip.m4v", "video/x-m4v", "video/mp4"],
    ["font.woff2", "", "font/woff2"],
    ["photo.png", "image/png", "image/png"],
    ["sound.wav", "audio/x-wav", "audio/wav"],
    ["clip.mov", "video/quicktime", "video/quicktime"],
    ["clip.MOV", "", "video/quicktime"],
    ["noext", "", "application/octet-stream"],
  ])("%s (%s) → %s", (name, type, want) => {
    expect(canonicalType(f(name, type))).toBe(want);
  });

  it("sorts each format into the library's kinds", () => {
    expect(kindOf("image/svg+xml")).toBe("image");
    expect(kindOf("text/javascript")).toBe("code");
    expect(kindOf("application/wasm")).toBe("code");
    expect(kindOf("application/json")).toBe("data");
    expect(kindOf("font/woff2")).toBe("font");
    expect(kindOf("application/octet-stream")).toBe("");
  });

  it("labels formats the way authors know them", () => {
    expect(["image/svg+xml", "text/javascript", "application/wasm", "application/json", "image/jpeg"].map(formatLabel)).toEqual([
      "SVG", "JS", "WASM", "JSON", "JPG",
    ]);
  });
});

describe("file picker accept list", () => {
  const formats = ["image/png", "image/svg+xml", "video/mp4", "text/javascript", "application/wasm", "application/json"];

  it("lists extensions next to MIME types so pickers don't grey out code and data files", () => {
    const all = acceptFor(formats, "all").split(",");
    for (const ext of [".js", ".mjs", ".wasm", ".json", ".svg"]) expect(all).toContain(ext);
    expect(all).toContain("text/javascript");
    expect(all).not.toContain(".mov");
  });

  it("narrows to the selected kind", () => {
    expect(acceptFor(formats, "code").split(",").sort()).toEqual([".js", ".mjs", ".wasm", "application/wasm", "text/javascript"]);
    expect(acceptFor(formats, "data").split(",").sort()).toEqual([".json", "application/json"]);
    expect(acceptFor(formats, "image").split(",")).toContain(".svg");
  });

  it("falls back by kind when the provider reports no formats", () => {
    expect(acceptFor([], "all")).toBe("");
    expect(acceptFor([], "code")).toBe(".js,.mjs,.wasm");
    expect(acceptFor([], "data")).toBe(".json");
    expect(acceptFor([], "font")).toBe(".woff,.woff2,.ttf,.otf");
    expect(acceptFor([], "image")).toBe("image/*");
  });
});
