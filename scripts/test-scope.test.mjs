import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveTestScope, planTests, runPlan, verifyStage, discoverExecutionConfigs, verifyAuditedFiles } from './test-scope.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const entry = (path, disposition, reason) => ({ path, sha256: hash(path), disposition, reason });
const inventory = [entry('test/member.test.ts', 'not-run', 'Worker fixture boundary'), entry('scripts/card-identity-migration.test.mjs', 'not-run', 'Inserts members'), entry('scripts/blog-translation-migration.test.mjs', 'not-run', 'Inserts members'), entry('scripts/pure.test.mjs', 'run-node', 'Pure planner'), entry('web/test/style.test.ts', 'run-web', 'Static source inspection')];
const manifest = { sourceCommit: 'a'.repeat(40), tests: inventory, auditedFiles: [], stageCommit: 'b'.repeat(40) };

test('ordinary CI uses the original full npm test entrypoint', () => {
  assert.equal(resolveTestScope({ eventName: 'push', message: 'fix: menu\n\nUpdate: none' }), 'full');
  const plan = planTests({ scope: 'full', inventory: [], manifest, root: '/repo', sourceCommit: 'c'.repeat(40) });
  const calls = [];
  assert.equal(runPlan(plan, { execute: (...args) => { calls.push(args); return { status: 0 }; }, write: () => {} }), 0);
  assert.deepEqual(calls.map(([file, args]) => [file, args]), [['npm', ['test']]]);
});

test('only an explicit unambiguous footer or manual dispatch selects the limited scope', () => {
  const message = 'fix: menu\n\nUpdate: none\nTest-Scope: no-accounts\nSigned-off-by: Hearth Room <contact@hearthroom.club>\n';
  assert.equal(resolveTestScope({ eventName: 'push', message }), 'no-accounts');
  assert.equal(resolveTestScope({ eventName: 'pull_request', message }), 'no-accounts');
  assert.equal(resolveTestScope({ eventName: 'workflow_dispatch', dispatchScope: 'no-accounts', message: '' }), 'no-accounts');
  assert.equal(resolveTestScope({ eventName: 'workflow_dispatch', dispatchScope: 'full', message }), 'full');
  for (const message of ['Test-Scope: no-accounts', 'fix: x\n\nTest-Scope: no-accounts\n\nordinary body', 'fix: x\n\nTest-Scope: typo', 'fix: x\n\nTest-Scope: full\nTest-Scope: no-accounts']) {
    assert.throws(() => resolveTestScope({ eventName: 'push', message }), /Test-Scope/);
  }
  assert.throws(() => resolveTestScope({ eventName: 'workflow_dispatch', dispatchScope: '' }), /scope/);
});

test('malformed scope-looking headers never fall back to the account-creating full suite', () => {
  for (const header of ['Test-Scope : no-accounts', ' Test-Scope: no-accounts', '\tTest-Scope: no-accounts', 'Test Scope: no-accounts', 'Test_Scope: no-accounts', 'Test-Scope：no-accounts', 'TestScope: no-accounts']) {
    assert.throws(() => resolveTestScope({ eventName: 'push', message: `fix: x\n\n${header}` }), /Test-Scope/, header);
  }
});

test('support auditing rejects changed workspace lifecycle and newly discovered build config before loading either', () => {
  const root = mkdtempSync(join(tmpdir(), 'scope-config-'));
  try {
    mkdirSync(join(root, 'web'));
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(join(root, 'web/package.json'), '{}');
    const auditedFiles = ['package.json', 'web/package.json'].map(path => ({ path, sha256: hash('{}') }));
    const audit = { auditedFiles, executionConfigInventory: discoverExecutionConfigs(root) };
    verifyAuditedFiles(root, audit);
    writeFileSync(join(root, 'web/package.json'), '{"scripts":{"prebuild":"throw"}}');
    assert.throws(() => verifyAuditedFiles(root, audit), /Support audit changed/);
    writeFileSync(join(root, 'web/package.json'), '{}');
    writeFileSync(join(root, 'web/postcss.config.cjs'), 'throw Error("must never execute")');
    assert.throws(() => verifyAuditedFiles(root, audit), /Execution config inventory changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('limited planning excludes Worker and member fixtures before any subprocess runs', () => {
  const plan = planTests({ scope: 'no-accounts', inventory, manifest, root: '/repo', sourceCommit: 'c'.repeat(40) });
  const calls = [], lines = [];
  assert.equal(runPlan(plan, { execute: (...args) => { calls.push(args); return { status: 0 }; }, write: line => lines.push(line) }), 0);
  const args = calls.flatMap(([, args]) => args).join(' ');
  assert.doesNotMatch(args, /card-identity|blog-translation|test\/member|npm test|vitest run$/);
  assert.match(args, /scripts\/pure\.test\.mjs/);
  assert.match(args, /vitest\.no-accounts\.config\.ts/);
  assert.equal(calls.at(-1)[2].cwd, '/repo/web', 'web suites use the same cwd as npm -w web');
  for (const file of inventory.filter(row => row.disposition === 'not-run')) {
    assert.ok(lines.some(line => line.includes(`NOT RUN ${file.path}`) && line.includes(file.reason) && line.includes(file.sha256) && line.includes('c'.repeat(40))));
  }
});

test('unknown, missing, duplicate or changed audited tests fail closed before execution', () => {
  const make = (actual, selected = manifest) => () => planTests({ scope: 'no-accounts', inventory: actual, manifest: selected, root: '/repo', sourceCommit: 'c'.repeat(40) });
  assert.throws(make([...inventory, entry('web/test/new.test.ts', 'run-web', 'new')]), /unclassified/);
  assert.throws(make(inventory.slice(1)), /missing/);
  assert.throws(make(inventory.map(row => row.path === 'scripts/pure.test.mjs' ? { ...row, sha256: hash('changed') } : row)), /audit changed/);
  assert.throws(make(inventory, { ...manifest, tests: [...inventory, inventory[0]] }), /duplicate/);
  assert.throws(make(inventory, { ...manifest, tests: inventory.map(row => row.path.startsWith('test/') ? { ...row, disposition: 'run-node' } : row) }), /Worker/);
});

test('subcommand errors, signals and nonzero statuses remain failures and stop later commands', () => {
  const plan = planTests({ scope: 'no-accounts', inventory, manifest, root: '/repo', sourceCommit: 'c'.repeat(40) });
  for (const result of [{ status: 7 }, { status: null, signal: 'SIGTERM' }, { error: new Error('launch failed') }]) {
    let count = 0;
    assert.equal(runPlan(plan, { execute: () => { count++; return result; }, write: () => {} }), result.status ?? 1);
    assert.equal(count, 1);
  }
});

test('no-accounts stage test execution requires the exact audited checkout and gitlink', () => {
  assert.equal(verifyStage(manifest, 'b'.repeat(40), 'b'.repeat(40)), true);
  for (const args of [[{ ...manifest, stageCommit: null }, 'b'.repeat(40), 'b'.repeat(40)], [manifest, 'd'.repeat(40), 'd'.repeat(40)], [manifest, 'b'.repeat(40), 'd'.repeat(40)]]) {
    assert.throws(() => verifyStage(...args), /audited stage/);
  }
});

test('the existing full test command remains byte-for-byte unchanged', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  // New maintained suites extend this reviewed snapshot; existing suites remain required.
  assert.equal(pkg.scripts.test, 'npm run updates:build && node --test scripts/blog-publisher-identity.test.mjs scripts/blog-publisher.test.mjs scripts/maintenance-mode.test.mjs scripts/card-identity-migration.test.mjs scripts/blog-translation-migration.test.mjs scripts/card-cutover.test.mjs scripts/deploy-workflow.test.mjs scripts/updates/entries.test.mjs scripts/updates/check-commits.test.mjs scripts/mock-presets.test.mjs && vitest run && npm run test -w web');
});
