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
