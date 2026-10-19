// 一次只有一個提示（美術總監最終 r1 M6、r2 M6）：導覽或新手提示卡在畫面上時，安裝提示收起；
// 桌寵說話時先不出現，但出現之後不跟著她每一句話收放。
import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp, nextTick } from "vue";
import { i18n } from "../src/lib/i18n";
import { installPrompt } from "../src/lib/pwa";
import { tourState } from "../src/lib/coach-tour";
import { newcomerTour } from "../src/lib/newcomer-tour";
import { newcomerPrompt } from "../src/lib/newcomer-prompt";
import { petSpeaking } from "../src/pet/events";
import InstallToast from "../src/components/InstallToast.vue";

let root: HTMLElement;
let app: ReturnType<typeof createApp>;
// 收起時有離場動畫：還在離場的不算在畫面上
const shown = () => !!root.querySelector(".install:not([class*=leave])");
beforeEach(() => {
  installPrompt.visible = false; tourState.step = null; newcomerTour.day = 0; newcomerPrompt.showing = false; petSpeaking.value = false;
  root = document.createElement("div"); document.body.append(root);
  app = createApp(InstallToast).use(i18n); app.mount(root);
});
afterEach(() => { app.unmount(); root.remove(); installPrompt.visible = false; });

it("waits while a tour or the newcomer card is on screen", async () => {
  newcomerTour.day = 4; installPrompt.visible = true; await nextTick();
  expect(shown()).toBe(false);
  newcomerTour.day = 0; await nextTick();
  expect(shown()).toBe(true);
  tourState.step = "r18" as typeof tourState.step; await nextTick();
  expect(shown()).toBe(false);
  tourState.step = null; newcomerPrompt.showing = true; await nextTick();
  expect(shown()).toBe(false);
});

it("waits for the pet to finish talking, then stays put", async () => {
  petSpeaking.value = true; installPrompt.visible = true; await nextTick();
  expect(shown()).toBe(false);
  petSpeaking.value = false; await nextTick();
  expect(shown()).toBe(true);
  petSpeaking.value = true; await nextTick();
  expect(shown()).toBe(true);
});
