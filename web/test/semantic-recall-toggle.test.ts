import { afterEach, expect, it } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import { i18n, loadLocale } from "../src/lib/i18n";
import WorldbookEntriesDialog from "../src/components/editor/WorldbookEntriesDialog.vue";
import type { WorldbookEntryDraft } from "../src/lib/role-draft";
let app: App;
afterEach(() => { app?.unmount(); document.body.innerHTML = ""; });
it("defaults on, changes the state explanation, and remains editable for constants", async () => {
  await loadLocale("en");
  i18n.global.locale.value = "en";
  const entries = ref<WorldbookEntryDraft[]>([{ name:"Secret", content:"Reveal later", keywords:["reveal"], secondaryKeywords:[], isEnabled:true, isConstant:false }]);
  app = createApp({ render: () => h(WorldbookEntriesDialog, { modelValue:entries.value, language:"en", "onUpdate:modelValue":v=>entries.value=v }) });
  const root=document.createElement("div");document.body.append(root);app.use(i18n).mount(root);await nextTick();
  const toggle = () => [...document.querySelectorAll<HTMLLabelElement>("label.toggle")].find(e => e.textContent?.includes("Semantic recall"))!.querySelector<HTMLInputElement>("input")!;
  expect(toggle().checked).toBe(true);
  toggle().click();await nextTick();
  expect(entries.value[0].semanticRecall).toBe(false);
  expect(document.querySelector("#wbd-semantic-hint")?.textContent).toContain("only when a keyword or regular expression matches");
  entries.value[0].isConstant=true;await nextTick();
  expect(toggle().disabled).toBe(false);
  expect(document.querySelector("#wbd-semantic-hint")?.textContent).toContain("Always-on entries are sent every turn");
  toggle().click();await nextTick();expect(entries.value[0].semanticRecall).toBe(true);
});

it("shows observed activation counts and hides the Harbor zero placeholder", async () => {
  await loadLocale("en");
  i18n.global.locale.value = "en";
  const entry: WorldbookEntryDraft = { name: "Archive", content: "Check the index.", keywords: ["archive"], isEnabled: true, isConstant: true };
  const entries = ref<WorldbookEntryDraft[]>([{ ...entry, activationCount: 0 }]);
  app = createApp({ render: () => h(WorldbookEntriesDialog, { modelValue: entries.value, language: "en" }) });
  const root = document.createElement("div");
  document.body.append(root);
  app.use(i18n).mount(root);
  await nextTick();

  const nameField = document.querySelector("#wbd-name")?.closest(".field");
  expect(nameField).not.toBeNull();
  expect(nameField?.textContent).not.toContain(i18n.global.t("wb.entry.activations", { n: 0 }));

  entries.value = [{ ...entry, activationCount: 7 }];
  await nextTick();
  expect(nameField?.textContent).toContain(i18n.global.t("wb.entry.activations", { n: 7 }));

  entries.value = [entry];
  await nextTick();
  expect(nameField?.querySelector(".subtle")).toBeNull();
});

it("keeps the always-on badge without a keyword placeholder for a keyless constant", async () => {
  await loadLocale("en");
  i18n.global.locale.value = "en";
  const entry: WorldbookEntryDraft = { name: "Archive", content: "Check the index.", keywords: [], isEnabled: true, isConstant: true };
  const entries = ref<WorldbookEntryDraft[]>([entry]);
  app = createApp({ render: () => h(WorldbookEntriesDialog, { modelValue: entries.value, language: "en" }) });
  const root = document.createElement("div");
  document.body.append(root);
  app.use(i18n).mount(root);
  await nextTick();

  const row = document.querySelector(".wbd__row-name");
  expect(row?.querySelector(".wbd__row-title")?.textContent).toContain("Always");
  expect(row?.querySelector(".wbd__row-keys")).toBeNull();

  entries.value = [{ ...entry, keywords: ["archive"] }];
  await nextTick();
  expect(row?.querySelector(".wbd__row-keys")?.textContent).toBe("archive");
});
