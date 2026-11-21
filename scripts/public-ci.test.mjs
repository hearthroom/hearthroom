import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = new URL("../.github/workflows/public-site.yml", import.meta.url);
test("public PRs verify the website and Worker without Stage or deployment credentials", () => {
  const spec = readFileSync(workflow, "utf8");
  assert.match(spec, /^  pull_request:/m);
  assert.match(spec, /permissions:\n  contents: read/);
  for (const command of ["npm run typecheck", "node scripts/public-sandbox-contract.mjs --check-pin", "npm run test:public", "npm run test:api", "npm run build:public"]) {
    assert.ok(spec.includes(command), command);
  }
  const build = spec.indexOf("npm run build:public");
  const assets = spec.indexOf("ln -s dist-public web/dist");
  const workerTests = spec.indexOf("npm run test:api");
  assert.ok(build >= 0 && build < assets && assets < workerTests, "Worker tests must use the built public assets");
  assert.doesNotMatch(spec, /submodules: (true|recursive)|secrets\.|pull_request_target|wrangler deploy|migrate:remote|archive:assets/);
});
