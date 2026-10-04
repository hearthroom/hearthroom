import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { needsUpdateNote, updateTrailers, checkCommit, checkRange } from "./check-commits.mjs";

test("which commits must say whether users will notice them", () => {
  for (const subject of ["feat: x", "feat(web): x", "fix(community)!: x", "perf: x", "copy(guide): x", "revert: x", 'Revert "feat: x"', "pin the stage", "Feat: x"])
    assert.equal(needsUpdateNote({ subject, stageChanged: false }), true, subject);
  for (const subject of ["docs: x", "test: x", "chore: x", "ci: x", "build: x", "refactor(src): x", "style: x", "chore(deps): x"])
    assert.equal(needsUpdateNote({ subject, stageChanged: false }), false, subject);
  assert.equal(needsUpdateNote({ subject: "chore: pin stage 1234567", stageChanged: true }), true);
  assert.equal(needsUpdateNote({ subject: "docs: x", stageChanged: true }), true);
});

test("Update trailers are read from the message footer, one or many", () => {
  assert.deepEqual(updateTrailers("feat: x\n\nbody\n\nUpdate: 2026-10-04-a\nUpdate: none\nCo-Authored-By: x"), ["2026-10-04-a", "none"]);
  assert.deepEqual(updateTrailers("feat: x\n\nUpdate:2026-10-04-a"), ["2026-10-04-a"]);
  assert.deepEqual(updateTrailers("feat: x\n\nupdate: 2026-10-04-a"), ["2026-10-04-a"]);
  assert.deepEqual(updateTrailers("feat: x"), []);
});

test("a commit passes by touching updates/, pointing at a known entry, or saying none", () => {
  const known = new Set(["2026-10-04-a"]);
  const base = { subject: "feat: x", stageChanged: false, files: ["web/src/App.vue"], known };
  assert.match(checkCommit({ ...base, message: "feat: x" }), /Update:/);
  assert.equal(checkCommit({ ...base, message: "feat: x\n\nUpdate: none" }), null);
  assert.equal(checkCommit({ ...base, message: "feat: x\n\nUpdate: 2026-10-04-a" }), null);
  assert.match(checkCommit({ ...base, message: "feat: x\n\nUpdate: 2026-10-04-missing" }), /2026-10-04-missing/);
  assert.match(checkCommit({ ...base, message: "feat: x\n\nUpdate: 2026-10-04-a\nUpdate: nope" }), /nope/);
  assert.equal(checkCommit({ ...base, files: ["web/src/App.vue", "updates/2026-10-05-b.json"], message: "feat: x" }), null);
  assert.equal(checkCommit({ ...base, subject: "docs: x", message: "docs: x" }), null);
  assert.match(checkCommit({ ...base, subject: "chore: bump", stageChanged: true, files: ["stage"], message: "chore: bump" }), /Update:/);
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "update-notes-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "updates"));
  writeFileSync(join(dir, "README.md"), "x");
  git("add", "."); git("commit", "-q", "-m", "chore: init");
  const commit = (files, message) => {
    for (const [path, content] of Object.entries(files)) { mkdirSync(join(dir, path, ".."), { recursive: true }); writeFileSync(join(dir, path), content); }
    git("add", "."); git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  return { dir, git, commit };
}

test("a pushed range is checked commit by commit against the entries at its head", () => {
  const r = repo();
  const start = r.git("rev-parse", "HEAD");
  r.commit({ "web/a.ts": "1" }, "feat: first part\n\nUpdate: 2026-10-05-thing");
  r.commit({ "updates/2026-10-05-thing.json": "{}" }, "docs: describe the thing");
  r.commit({ "web/a.ts": "2" }, "fix: polish\n\nUpdate: 2026-10-05-thing");
  r.commit({ "src/b.ts": "1" }, "test: more coverage");
  const head = r.git("rev-parse", "HEAD");
  assert.deepEqual(checkRange(r.dir, `${start}..${head}`), []);
  r.commit({ "web/a.ts": "3" }, "feat: forgot to say");
  const problems = checkRange(r.dir, `${head}..HEAD`);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /feat: forgot to say/);
});

test("a range with an unknown start checks only the head commit", () => {
  const r = repo();
  r.commit({ "web/a.ts": "1" }, "feat: old and unchecked");
  r.commit({ "web/a.ts": "2" }, "fix: new\n\nUpdate: none");
  assert.deepEqual(checkRange(r.dir, "0000000000000000000000000000000000000000..HEAD"), []);
});

test("merge commits are skipped", () => {
  const r = repo();
  const start = r.git("rev-parse", "HEAD");
  r.git("checkout", "-q", "-b", "side");
  r.commit({ "web/a.ts": "1" }, "fix: on the side\n\nUpdate: none");
  r.git("checkout", "-q", "main");
  r.commit({ "web/b.ts": "1" }, "docs: main moves");
  r.git("merge", "-q", "--no-ff", "side", "-m", "Merge branch side");
  assert.deepEqual(checkRange(r.dir, `${start}..HEAD`), []);
});

test("the commit-msg hook reads the staged change and ignores comment lines", () => {
  const r = repo();
  const cli = fileURLToPath(new URL("./check-commits.mjs", import.meta.url));
  const run = (msg) => {
    writeFileSync(join(r.dir, "MSG"), msg);
    try { execFileSync(process.execPath, [cli, "--commit-msg", join(r.dir, "MSG")], { cwd: r.dir, stdio: "pipe" }); return 0; } catch (e) { return e.status; }
  };
  writeFileSync(join(r.dir, "a.ts"), "1"); r.git("add", "a.ts");
  assert.equal(run("feat: x\n# Update: none is only a comment"), 1);
  assert.equal(run("feat: x\n\nUpdate: none\n"), 0);
  assert.equal(run("docs: x\n"), 0);
  assert.equal(run("fixup! feat: x\n"), 0);
  writeFileSync(join(r.dir, "updates/2026-10-05-x.json"), "{}"); r.git("add", "updates");
  assert.equal(run("feat: x\n"), 0);
  assert.equal(run("fix: x\n\nUpdate: 2026-10-05-x\n"), 0);
});
