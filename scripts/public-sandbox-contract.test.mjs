import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectPublicContract } from "./public-sandbox-contract.mjs";

const sha = "a".repeat(40);
const contract = {
  name: "hearthroom-sandbox-contract",
  protocolVersion: 2,
  generatedBy: "src/sandbox/__tests__/contract.spec.ts",
  sources: ["src/sandbox/sdk/events.ts"],
  sdk: { context: { source: 'omitted or "card"' } },
  nativeBlocks: { source: "src/common/native-blocks.ts", blocks: ["status"] },
};

test("public contract preserves author fields and omits implementation provenance", () => {
  assert.deepEqual(projectPublicContract(contract, sha), {
    stageCommit: sha,
    name: contract.name,
    protocolVersion: contract.protocolVersion,
    sdk: contract.sdk,
    nativeBlocks: { blocks: ["status"] },
  });
});

test("public snapshot has a fixed Stage version and no implementation references", () => {
  const published = readFileSync(new URL("../web/public/contracts/sandbox-contract.json", import.meta.url), "utf8");
  const result = JSON.parse(published);
  assert.match(result.stageCommit, /^[a-f0-9]{40}$/);
  assert.ok(result.sdk.capabilities.includes("cache.set"));
  assert.doesNotMatch(published, /src\/sandbox\/|provider\/internal\/|internal\/importer\/|"generatedBy"|"sources"/);
});

test("editor opening limits match the public contract without a Stage checkout", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../web/public/contracts/sandbox-contract.json", import.meta.url), "utf8"));
  const editor = JSON.parse(readFileSync(new URL("../web/src/lib/opening-page-limits.json", import.meta.url), "utf8"));
  assert.deepEqual(editor, {
    openingPageMaxBytes: snapshot.provider.openingPageMaxBytes,
    workshopOpeningPageMaxBytes: snapshot.provider.workshopOpeningPageMaxBytes,
  });
});
