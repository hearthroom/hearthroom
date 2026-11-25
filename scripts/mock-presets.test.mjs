import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handlePresets } from "./mock-presets.mjs";

async function request(route, m = "GET", body = {}) {
  const url = new URL(route, "http://mock.test");
  let response;
  await handlePresets({ m, path: url.pathname, url, body, req: { headers: {} }, res: {}, json: (_, status, body) => { response = { status, body }; } });
  return response;
}

test("synthetic lane filters use the fixture catalog and match their model and series", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preset-catalog-test-"));
  const before = process.env.FIXTURES_DIR;
  process.env.FIXTURES_DIR = dir;
  t.after(() => { if (before === undefined) delete process.env.FIXTURES_DIR; else process.env.FIXTURES_DIR = before; fs.rmSync(dir, { recursive: true }); });
  fs.writeFileSync(path.join(dir, "models.json"), JSON.stringify([{group:"Gemini",families:[{family:"Gemini 4",variants:[{value:"qa-gemini-ripple"}]}]}]));
  await request("/__presets/reset");
  const model = await request("/open/v1/preset-library?model=model%3AGemini%204");
  assert.ok(model.body.items.length > 0);
  const lane = await request("/open/v1/preset-library?model=qa-gemini-ripple");
  assert.deepEqual(lane, model);
  assert.deepEqual(await request("/open/v1/preset-library/hot?model=qa-gemini-ripple"), await request("/open/v1/preset-library/hot?model=model%3AGemini%204"));
  assert.equal((await request("/open/v1/preset-library?model=missing-lane")).body.items.length, 0);
});


test("current content remains editable after publishing and enforces specific models on revise", async () => {
  await request("/__presets/reset");
  const list = await request("/open/v1/presets");
  const id = list.body.items[0].id;
  const detail = await request(`/open/v1/presets/${id}`);
  const published = await request(`/open/v1/presets/${id}/publish`, "POST", {expectedVersion:detail.body.version,declaration:"preset-publish-2026-10-30",purpose:"specific",recommendedModels:["model:Gemini 4"]});
  assert.equal(published.status,200);
  const current = await request(`/open/v1/presets/${id}/content`);
  assert.equal(current?.status,200);
  assert.deepEqual(current.body.revision.recommendedModels,["model:Gemini 4"]);
  const rejected = await request(`/open/v1/presets/${id}/revisions`, "POST", {expectedVersion:published.body.version,title:"specific",document:current.body.revision.document,recommendedModels:[]});
  assert.equal(rejected.status,422);
});


test("editor purpose persists for private and public assets, retaining model evidence", async () => {
  await request("/__presets/reset");
  const document = {schemaVersion:"hearthroom.st-preset.v1",st:{prompts:[]},selection:{profileId:1}};
  const made = await request("/open/v1/presets","POST",{title:"Editor",document,purpose:"general",recommendedModels:["Opus"]});
  const id=made.body.presetId;
  assert.equal((await request(`/open/v1/presets/${id}`)).body.purpose,"general");
  const pub = await request(`/open/v1/presets/${id}/publish`,"POST",{expectedVersion:1,purpose:"general",declaration:"preset-publish-2026-10-30"});
  const saved = await request(`/open/v1/presets/${id}/revisions`,"POST",{expectedVersion:pub.body.version,title:"Editor",document,purpose:"specific",recommendedModels:["Opus"]});
  assert.equal(saved.status,201);
  assert.equal((await request(`/open/v1/presets/${id}`)).body.purpose,"specific");
  assert.ok(!(await request("/open/v1/preset-library?model=general")).body.items.some(p=>p.presetId===id));
  const general = await request(`/open/v1/presets/${id}/revisions`,"POST",{expectedVersion:saved.body.version,title:"Editor",document,purpose:"general",recommendedModels:[]});
  assert.equal(general.status,201);
  assert.ok((await request("/open/v1/preset-library?model=general")).body.items.some(p=>p.presetId===id));
});

test("deleted owned publications disappear from the mock library", async () => {
 await request("/__presets/reset");
 const document={schemaVersion:"hearthroom.st-preset.v1",st:{prompts:[]},selection:{profileId:1}};
 const made=await request("/open/v1/presets","POST",{title:"Delete",document,purpose:"general"});
 const id=made.body.presetId;
 const pub=await request(`/open/v1/presets/${id}/publish`,"POST",{expectedVersion:1,purpose:"general",declaration:"preset-publish-2026-10-30"});
 assert.ok((await request("/open/v1/preset-library")).body.items.some(p=>p.presetId===id));
 assert.equal((await request(`/open/v1/presets/${id}/delete`,"POST",{expectedVersion:pub.body.version})).status,200);
 assert.ok(!(await request("/open/v1/preset-library")).body.items.some(p=>p.presetId===id));
});

test("use-only publishing: imported and overlapping presets are refused, others read an empty detail", async () => {
  await request("/__presets/reset");
  const declaration = "preset-publish-2026-10-30";
  const imported = (await request("/open/v1/presets")).body.items[0];
  assert.equal(imported.sourceKind, "imported");
  assert.equal(imported.contentVisibility, "open");
  const refused = await request(`/open/v1/presets/${imported.id}/publish`, "POST", { expectedVersion: imported.version, declaration, purpose: "general", contentVisibility: "hidden" });
  assert.deepEqual(refused, { status: 422, body: { error: "preset_invalid", reason: "preset_hidden_imported" } });
  const document = { schemaVersion: "hearthroom.st-preset.v1", st: { prompts: [] }, selection: { profileId: 1 } };
  const copied = await request("/open/v1/presets", "POST", { title: "撞到的預設", document, purpose: "general", recommendedModels: [] });
  const overlap = await request(`/open/v1/presets/${copied.body.presetId}/publish`, "POST", { expectedVersion: 1, declaration, purpose: "general", contentVisibility: "hidden" });
  assert.equal(overlap.body.reason, "preset_hidden_overlap");
  const own = await request("/open/v1/presets", "POST", { title: "自己寫的", document, purpose: "general", recommendedModels: [] });
  const ok = await request(`/open/v1/presets/${own.body.presetId}/publish`, "POST", { expectedVersion: 1, declaration, purpose: "general", contentVisibility: "hidden" });
  assert.equal(ok.status, 200);
  assert.equal((await request(`/open/v1/presets/${own.body.presetId}`)).body.contentVisibility, "hidden");
  const mine = await request(`/open/v1/preset-library/${own.body.presetId}`);
  assert.equal(mine.body.contentHidden, false);
  assert.equal(mine.body.item.contentVisibility, "hidden");
  const back = await request(`/open/v1/presets/${own.body.presetId}/publish`, "POST", { expectedVersion: ok.body.version, declaration, purpose: "general", contentVisibility: "open" });
  assert.equal(back.status, 200);
  assert.equal((await request(`/open/v1/presets/${own.body.presetId}`)).body.contentVisibility, "open");
  const other = (await request("/open/v1/preset-library")).body.items.find((x) => x.title === "夜讀筆記");
  assert.equal(other.contentVisibility, "hidden");
  const hidden = await request(`/open/v1/preset-library/${other.presetId}`);
  assert.equal(hidden.body.contentHidden, true);
  assert.deepEqual(hidden.body.revision.document.st.prompts, []);
  assert.deepEqual(hidden.body.parameters, {});
  assert.ok(hidden.body.item.enabledEntryCount > 0);
});

test("use-only availability follows the switch and the source", async (t) => {
  await request("/__presets/reset");
  t.after(() => request("/__presets?scenario="));
  const on = await request("/open/v1/presets");
  assert.equal(on.body.contentHiddenEnabled, true);
  assert.equal(on.body.items[0].contentHiddenAvailable, false); // 匯入的
  const document = { schemaVersion: "hearthroom.st-preset.v1", st: { prompts: [] }, selection: { profileId: 1 } };
  const own = await request("/open/v1/presets", "POST", { title: "自己寫的", document, purpose: "general", recommendedModels: [] });
  assert.equal((await request(`/open/v1/presets/${own.body.presetId}`)).body.contentHiddenAvailable, true);
  await request("/__presets?scenario=hiddenOff");
  const off = await request("/open/v1/presets");
  assert.equal(off.body.contentHiddenEnabled, false);
  assert.ok(off.body.items.every((p) => p.contentHiddenAvailable === false));
  const refused = await request(`/open/v1/presets/${own.body.presetId}/publish`, "POST", { expectedVersion: 1, declaration: "preset-publish-2026-10-30", purpose: "general", contentVisibility: "hidden" });
  assert.equal(refused.body.reason, "preset_hidden_disabled");
});
