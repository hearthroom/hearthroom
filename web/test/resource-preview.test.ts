import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { i18n } from "../src/lib/i18n";
import ResourcePreview from "../src/components/ResourcePreview.vue";

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};
function show(item: Record<string, unknown>) {
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp(ResourcePreview, {
    item: { id: 1, byteSize: 20, ...item },
    provider: "HarperHarbor",
    previous: false,
    next: false,
    busy: false,
    error: "",
  }).use(i18n);
  app.mount(root);
}

it("shows the opening lines of a JSON file as text", async () => {
  const lines = Array.from({ length: 100 }, (_, i) => `  "k${i}": ${i},`).join("\n");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(`{\n${lines}\n}`)));
  show({ imageUrl: "https://cdn.test/save.json", fileName: "save.json", kind: "data", mimeType: "application/json" });
  await flush();
  const pre = document.querySelector(".text-sample")!;
  expect(pre.textContent).toContain('"k0": 0');
  expect(pre.textContent!.split("\n").length).toBeLessThanOrEqual(60);
});

it("shows script source as text without running it", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("window.__ran = true;")));
  show({ imageUrl: "https://cdn.test/card.js", fileName: "card.js", kind: "code" });
  await flush();
  expect(document.querySelector(".text-sample")?.textContent).toBe("window.__ran = true;");
  expect(document.querySelector("script")).toBeNull();
  expect((window as unknown as { __ran?: boolean }).__ran).toBeUndefined();
});

it("gives a WASM file a plain file card", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  show({ imageUrl: "https://cdn.test/engine.wasm", fileName: "engine.wasm", kind: "code", mimeType: "application/wasm" });
  await flush();
  expect(fetcher).not.toHaveBeenCalled();
  expect(document.querySelector(".file-sample")?.textContent).toContain("WASM");
  expect(document.body.textContent).toContain(i18n.global.t("resource.noPreview"));
});

it("draws an SVG through an image element", async () => {
  show({ imageUrl: "https://cdn.test/icon.svg", fileName: "icon.svg", kind: "image", mimeType: "image/svg+xml" });
  await flush();
  expect(document.querySelector(".preview-stage img")?.getAttribute("src")).toBe("https://cdn.test/icon.svg");
});
