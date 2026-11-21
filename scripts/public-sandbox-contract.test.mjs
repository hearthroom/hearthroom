import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { projectPublicContract, verifyPublicContract } from "./public-sandbox-contract.mjs";

const sha = "a".repeat(40);
const contract = {
  name: "hearthroom-sandbox-contract",
  protocolVersion: 2,
  generatedBy: "src/sandbox/__tests__/contract.spec.ts",
  sources: ["src/sandbox/sdk/events.ts"],
  sdk: { context: { source: 'omitted or "card"' } },
  nativeBlocks: { source: "src/common/native-blocks.ts", blocks: ["status"] },
};

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8" }).trim();

function makeRepoFixture({ checkoutStage = true, snapshotCommitOverride = null, stageContentDrift = false } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hearthroom-contract-"));
  const stageSrc = path.join(dir, "stage-src");
  const repo = path.join(dir, "hearthroom");
  mkdirSync(path.join(stageSrc, "contract"), { recursive: true });
  git(stageSrc, "init", "--initial-branch=main");
  writeFileSync(path.join(stageSrc, "contract/sandbox-contract.json"), JSON.stringify(contract, null, 2) + "\n");
  git(stageSrc, "add", ".");
  git(stageSrc, "commit", "-m", "stage v1");
  const pin = git(stageSrc, "rev-parse", "HEAD");

  mkdirSync(path.join(repo, "web/public/contracts"), { recursive: true });
  git(repo, "init", "--initial-branch=main");
  git(repo, "update-index", "--add", "--cacheinfo", `160000,${pin},stage`);
  const projected = projectPublicContract(contract, snapshotCommitOverride ?? pin);
  writeFileSync(path.join(repo, "web/public/contracts/sandbox-contract.json"), JSON.stringify(projected, null, 2) + "\n");
  git(repo, "add", "web/public/contracts/sandbox-contract.json");
  git(repo, "commit", "-m", "pin stage");

  if (checkoutStage) {
    git(dir, "clone", stageSrc, path.join(repo, "stage"));
    if (stageContentDrift) {
      const altered = { ...contract, protocolVersion: 99 };
      writeFileSync(path.join(repo, "web/public/contracts/sandbox-contract.json"), JSON.stringify(projectPublicContract(altered, pin), null, 2) + "\n");
    }
  } else {
    mkdirSync(path.join(repo, "stage"), { recursive: true });
  }
  return { dir, repo, pin };
}

test("public contract preserves author fields and omits implementation provenance", () => {
  assert.deepEqual(projectPublicContract(contract, sha), {
    stageCommit: sha,
    name: contract.name,
    protocolVersion: contract.protocolVersion,
    sdk: contract.sdk,
    nativeBlocks: { blocks: ["status"] },
  });
});

test("public snapshot matches the pinned Stage gitlink and has no implementation references", () => {
  const published = readFileSync(new URL("../web/public/contracts/sandbox-contract.json", import.meta.url), "utf8");
  const result = JSON.parse(published);
  assert.match(result.stageCommit, /^[a-f0-9]{40}$/);
  assert.ok(result.sdk.capabilities.includes("cache.set"));
  assert.doesNotMatch(published, /src\/sandbox\/|provider\/internal\/|internal\/importer\/|"generatedBy"|"sources"/);
  const verified = verifyPublicContract({ requireStage: false });
  assert.equal(verified.pin, result.stageCommit);
});

test("verifyPublicContract fails closed when snapshot stageCommit lags behind Stage gitlink without Stage checkout", () => {
  const fx = makeRepoFixture({ checkoutStage: false, snapshotCommitOverride: "b".repeat(40) });
  try {
    assert.throws(() => verifyPublicContract({ root: fx.repo, requireStage: false }), /differs from the pinned Stage/);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("verifyPublicContract passes pin-only check without Stage checkout when stageCommit matches", () => {
  const fx = makeRepoFixture({ checkoutStage: false });
  try {
    const res = verifyPublicContract({ root: fx.repo, requireStage: false });
    assert.equal(res.pin, fx.pin);
    assert.equal(res.checkedStage, false);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("verifyPublicContract checks full contract content when Stage checkout is present", () => {
  const fx = makeRepoFixture({ checkoutStage: true, stageContentDrift: true });
  try {
    assert.throws(() => verifyPublicContract({ root: fx.repo, requireStage: false }), /differs from the pinned Stage/);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("verifyPublicContract rejects staged Stage gitlink mismatch against the public snapshot", () => {
  const fx = makeRepoFixture({ checkoutStage: false });
  try {
    git(fx.repo, "update-index", "--cacheinfo", `160000,${"c".repeat(40)},stage`);
    assert.throws(() => verifyPublicContract({ root: fx.repo, requireStage: false }), /differs from the pinned Stage/);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("verifyPublicContract rejects an unmerged Stage gitlink index conflict", () => {
  const fx = makeRepoFixture({ checkoutStage: false });
  try {
    const conflictIndex = [
      `160000 ${fx.pin} 1\tstage`,
      `160000 ${"c".repeat(40)} 2\tstage`,
      `160000 ${"d".repeat(40)} 3\tstage`,
    ].join("\n") + "\n";
    execFileSync("git", ["update-index", "--index-info"], { cwd: fx.repo, env: ENV, input: conflictIndex, encoding: "utf8" });
    assert.throws(() => verifyPublicContract({ root: fx.repo, requireStage: false }), /unmerged index conflict/);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});
