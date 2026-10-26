import { describe, expect, it } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { i18n } from "../src/lib/i18n";
import WorldbookEntriesDialog from "../src/components/editor/WorldbookEntriesDialog.vue";
import { parseWorldbookFile } from "../src/lib/tavern";
import type { WorldbookEntryDraft } from "../src/lib/role-draft";
import cases from "./fixtures/lorebook-regex-cases.json";

describe("Lorebook regex warnings", () => {
 it.each(cases)("$key: warning=$warn in both fields", async ({key, warn}) => {
  const entries = ref<WorldbookEntryDraft[]>([{name:"Harbor gate", content:"An original setting.", keywords:[key], secondaryKeywords:[key], isEnabled:true, isConstant:false}]);
  const before = JSON.stringify(entries.value);
  const host = document.createElement("div"); document.body.append(host);
  let closed = false;
  const app = createApp({render:() => h(WorldbookEntriesDialog, {modelValue:entries.value, language:"en", "onUpdate:modelValue":v=>entries.value=v, onClose:()=>{closed=true;}})});
  app.use(i18n); app.mount(host);
  try {
   await nextTick();
   expect(document.querySelectorAll(".wbd__regex-hint")).toHaveLength(warn ? 2 : 0);
   expect(JSON.stringify(entries.value)).toBe(before);
   const done = document.querySelector<HTMLButtonElement>(".wbd__head-acts button")!;
   expect(done.disabled).toBe(false); done.click(); expect(closed).toBe(true);
   const primary = document.querySelector<HTMLInputElement>("#wbd-kw")!;
   primary.value="dock"; primary.dispatchEvent(new Event("input", {bubbles:true})); await nextTick();
   expect(document.querySelector("#wbd-kw-hint")).toBeNull();
  } finally { app.unmount(); host.remove(); }
 });
 it("respects use_regex on import without changing the importer", async () => {
  const file = new File([JSON.stringify({entries:{0:{key:["20[6-7][0-9]"], keysecondary:["^dock$"], content:"An original setting.", use_regex:true}}})], "harbor.json", {type:"application/json"});
  const parsed = await parseWorldbookFile(file, "en");
  expect(parsed.entries[0].keywords).toEqual(["/20[6-7][0-9]/i"]);
  expect(parsed.entries[0].secondaryKeywords).toEqual(["/^dock$/i"]);
 });
});
