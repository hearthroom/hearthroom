import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const snapshot = new URL("../web/public/contracts/sandbox-contract.json", import.meta.url);

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

function main(args) {
  const [mode, stageDirectory = resolve(root, "stage")] = args;
  if (!["--check", "--write"].includes(mode) || args.length > 2) {
    throw new Error("Usage: public-sandbox-contract.mjs --check|--write [Stage checkout]");
  }
  const git = (cwd, ...command) => execFileSync("git", command, { cwd, encoding: "utf8" }).trim();
  const [fileMode, type, pin, path] = git(root, "ls-tree", "HEAD", "--", "stage").split(/\s+/);
  if (fileMode !== "160000" || type !== "commit" || path !== "stage") {
    throw new Error("Hearthroom does not pin a Stage gitlink");
  }
  if (git(stageDirectory, "rev-parse", "HEAD") !== pin) {
    throw new Error("Stage checkout does not match the Hearthroom gitlink");
  }

  const source = git(stageDirectory, "show", "HEAD:contract/sandbox-contract.json");
  const data = JSON.stringify(projectPublicContract(JSON.parse(source), pin), null, 2) + "\n";
  if (mode === "--write") writeFileSync(snapshot, data);
  else if (readFileSync(snapshot, "utf8") !== data) {
    throw new Error("Public sandbox contract differs from the pinned Stage; regenerate and review the public snapshot");
  }
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
