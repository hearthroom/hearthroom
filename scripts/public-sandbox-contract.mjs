import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const snapshotRelativePath = "web/public/contracts/sandbox-contract.json";

// These fields describe implementation provenance. Other "source" fields,
// including sdk.context.source and openingPage.source, are author API details.
const privateFields = [
  ["generatedBy"],
  ["sources"],
  ["nativeBlocks", "source"],
  ["functionBar", "source"],
  ["cssDialect", "source"],
  ["sanitizer", "hostPath", "source"],
  ["scripts", "source"],
  ["provider", "source"],
  ["import", "source"],
];
const implementationReference = /(?:\bsrc\/|\bdocs\/|\binternal\/|\b__tests__\/|\bgitHub\.com\/hearthroom\/moonstage\b)/i;

export function projectPublicContract(contract, stageCommit) {
  if (contract.name !== "hearthroom-sandbox-contract" || !/^[a-f0-9]{40}$/.test(stageCommit)) {
    throw new Error("Expected a Hearthroom sandbox contract and an exact Stage SHA");
  }
  const publicContract = structuredClone(contract);
  for (const path of privateFields) {
    const owner = path.slice(0, -1).reduce((value, segment) => value?.[segment], publicContract);
    if (owner) delete owner[path.at(-1)];
  }
  if (implementationReference.test(JSON.stringify(publicContract))) {
    throw new Error("Public sandbox contract contains an implementation reference");
  }
  return { ...publicContract, stageCommit };
}

function git(cwd, ...command) {
  return execFileSync("git", command, { cwd, encoding: "utf8" }).trim();
}

function resolveStagePin(root) {
  const indexEntry = git(root, "ls-files", "--stage", "--", "stage");
  if (indexEntry) {
    const lines = indexEntry.split(/\r?\n/).filter(Boolean);
    if (lines.length !== 1) throw new Error("Stage gitlink has an unmerged index conflict");
    const [fileMode, pin, stageSlot, path] = lines[0].split(/\s+/);
    if (stageSlot !== "0") throw new Error("Stage gitlink has an unmerged index conflict");
    if (fileMode === "160000" && /^[a-f0-9]{40}$/.test(pin) && path === "stage") return pin;
  }
  const headEntry = git(root, "ls-tree", "HEAD", "--", "stage");
  const [fileMode, type, pin, path] = headEntry.split(/\s+/);
  if (fileMode !== "160000" || type !== "commit" || !/^[a-f0-9]{40}$/.test(pin) || path !== "stage") {
    throw new Error("Hearthroom does not pin a Stage gitlink");
  }
  return pin;
}

export function verifyPublicContract({ root = defaultRoot, stageDirectory = resolve(root, "stage"), requireStage = true } = {}) {
  const pin = resolveStagePin(root);
  const snapshotPath = resolve(root, snapshotRelativePath);
  const raw = readFileSync(snapshotPath, "utf8");
  const published = JSON.parse(raw);
  if (published.name !== "hearthroom-sandbox-contract" || published.stageCommit !== pin) {
    throw new Error("Public sandbox contract differs from the pinned Stage; regenerate and review the public snapshot");
  }
  if (implementationReference.test(raw)) {
    throw new Error("Public sandbox contract contains an implementation reference");
  }
  const hasStageCheckout = existsSync(resolve(stageDirectory, ".git"));
  if (!hasStageCheckout) {
    if (requireStage) throw new Error("Stage checkout does not match the Hearthroom gitlink");
    return { pin, checkedStage: false };
  }
  if (git(stageDirectory, "rev-parse", "HEAD") !== pin) {
    throw new Error("Stage checkout does not match the Hearthroom gitlink");
  }
  const source = git(stageDirectory, "show", "HEAD:contract/sandbox-contract.json");
  const expected = JSON.stringify(projectPublicContract(JSON.parse(source), pin), null, 2) + "\n";
  if (raw !== expected) {
    throw new Error("Public sandbox contract differs from the pinned Stage; regenerate and review the public snapshot");
  }
  return { pin, checkedStage: true };
}

function main(args) {
  const [mode, stageDirectory = resolve(defaultRoot, "stage")] = args;
  if (!["--check", "--check-pin", "--write"].includes(mode) || args.length > 2) {
    throw new Error("Usage: public-sandbox-contract.mjs --check|--check-pin|--write [Stage checkout]");
  }
  if (mode === "--check" || mode === "--check-pin") {
    const { pin, checkedStage } = verifyPublicContract({ root: defaultRoot, stageDirectory, requireStage: mode === "--check" });
    console.log(`Public sandbox contract matches pinned Stage ${pin}${checkedStage ? "" : " (pin check without Stage checkout)"}`);
    return;
  }
  const pin = resolveStagePin(defaultRoot);
  if (!existsSync(resolve(stageDirectory, ".git")) || git(stageDirectory, "rev-parse", "HEAD") !== pin) {
    throw new Error("Stage checkout does not match the Hearthroom gitlink");
  }
  const source = git(stageDirectory, "show", "HEAD:contract/sandbox-contract.json");
  const data = JSON.stringify(projectPublicContract(JSON.parse(source), pin), null, 2) + "\n";
  writeFileSync(resolve(defaultRoot, snapshotRelativePath), data);
  console.log(`Public sandbox contract matches pinned Stage ${pin}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
