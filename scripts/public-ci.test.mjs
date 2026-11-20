import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = new URL("../.github/workflows/public-site.yml", import.meta.url);
test("public PRs verify the website and Worker without Stage or deployment credentials", () => {
  const spec = readFileSync(workflow, "utf8");
  assert.match(spec, /^  pull_request:/m);
  assert.match(spec, /permissions:\n  contents: read/);
  for (const command of ["npm run typecheck", "npm run test:public", "npm run test:api", "npm run build:public"]) {
    assert.ok(spec.includes(command), command);
  }
  assert.doesNotMatch(spec, /submodules: (true|recursive)|secrets\.|pull_request_target|wrangler deploy|migrate:remote|archive:assets/);
});
