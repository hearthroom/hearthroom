#!/usr/bin/env node
// An explicit, audited subset. It never discovers executable tests through Vitest.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPES = new Set(['full', 'no-accounts']);
const DISPOSITIONS = new Set(['not-run', 'run-node', 'run-web']);
const MEMBER_FIXTURES = new Set(['scripts/card-identity-migration.test.mjs', 'scripts/blog-translation-migration.test.mjs']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

export function resolveTestScope({ eventName, dispatchScope, message = '' }) {
  if (eventName === 'workflow_dispatch') {
    if (!SCOPES.has(dispatchScope)) throw Error('Invalid manual test scope');
    return dispatchScope;
  }
  if (!['push', 'pull_request'].includes(eventName)) throw Error('Unsupported test scope event');
  const lines = message.trimEnd().split(/\r?\n/);
  const suspected = lines.filter(line => /^\s*test[\s_-]*scope\b/i.test(line));
  const declared = lines.filter(line => /^Test-Scope:/i.test(line));
  if (suspected.some(line => !/^Test-Scope:/i.test(line))) throw Error('Malformed Test-Scope header; refusing to choose full tests');
  if (!declared.length) return 'full';
  // A footer is the final paragraph containing trailers only; body mentions are errors.
  const boundary = lines.lastIndexOf('');
  const footer = lines.slice(boundary + 1);
  if (boundary < 1 || declared.length !== 1 || !footer.every(line => /^[A-Za-z][A-Za-z-]*:[ \t]*\S.*$/.test(line)) || !footer.includes(declared[0])) {
    throw Error('Test-Scope must occur once in the final trailer block');
  }
  const value = declared[0].slice(declared[0].indexOf(':') + 1).trim();
  if (!SCOPES.has(value)) throw Error('Invalid Test-Scope value');
  return value;
}

export function discoverTests(root) {
  const files = [];
  const walk = relative => {
    for (const item of readdirSync(join(root, relative), { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(item.name)) continue;
      const path = `${relative}/${item.name}`;
      if (item.isSymbolicLink()) throw Error(`Unreviewed symlink in test inventory: ${path}`);
      if (item.isDirectory()) walk(path);
      else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(item.name)) files.push({ path, sha256: sha256(readFileSync(join(root, path))) });
    }
  };
  for (const dir of ['scripts', 'test', 'web/test']) walk(dir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function readAudit(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'scripts/no-accounts-audit.json'), 'utf8'));
}

// These are the current npm/Vite/PostCSS/TypeScript/Wrangler automatic entry
// locations. An added alternative config must be reviewed before npm ci.
export function discoverExecutionConfigs(root) {
  const paths = [];
  const automatic = /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|\.npmrc|(?:vite|vitest|postcss|tailwind|babel|rollup|webpack|wrangler)\.config(?:\..+)?|wrangler\.(?:toml|jsonc?)|\.(?:postcss|babel)rc(?:\..+)?|tsconfig(?:\..+)?\.json)$/;
  for (const dir of ['', 'web']) {
    for (const name of readdirSync(join(root, dir))) {
      if (!automatic.test(name)) continue;
      const path = dir ? `${dir}/${name}` : name;
      if (!lstatSync(join(root, path)).isFile()) throw Error(`Unreviewed execution config type: ${path}`);
      paths.push(path);
    }
  }
  const walk = dir => {
    if (!existsSync(join(root, dir))) return;
    for (const item of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${item.name}`;
      if (item.isSymbolicLink()) throw Error(`Unreviewed execution config symlink: ${path}`);
      if (item.isDirectory()) walk(path);
      else paths.push(path);
    }
  };
  for (const dir of ['web/build', '.githooks']) walk(dir);
  return paths.sort();
}

export function verifyAuditedFiles(root, manifest) {
  if (!Array.isArray(manifest.auditedFiles)) throw Error('Missing audited support files');
  for (const row of manifest.auditedFiles) {
    if (!row.path || row.path.startsWith('/') || row.path.split('/').includes('..') || lstatSync(join(root, row.path)).isSymbolicLink()) throw Error('Invalid audited support path');
    if (sha256(readFileSync(join(root, row.path))) !== row.sha256) throw Error(`Support audit changed: ${row.path}; review before using no-accounts`);
  }
  const configs = discoverExecutionConfigs(root);
  if (JSON.stringify(configs) !== JSON.stringify(manifest.executionConfigInventory)) throw Error('Execution config inventory changed; review before npm ci');
  const audited = new Set(manifest.auditedFiles.map(row => row.path));
  for (const path of configs) if (!audited.has(path)) throw Error(`Missing execution config audit: ${path}`);
}

export function planTests({ scope, inventory, manifest, root, sourceCommit }) {
  if (!SCOPES.has(scope)) throw Error('Invalid test scope');
  if (scope === 'full') return { scope, sourceCommit, rows: [], commands: [{ executable: 'npm', args: ['test'], cwd: root }] };
  if (!/^[a-f0-9]{40}$/.test(sourceCommit) || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit)) throw Error('Missing source SHA');
  const reviewed = new Map();
  for (const row of manifest.tests) {
    if (reviewed.has(row.path)) throw Error(`duplicate audit entry: ${row.path}`);
    if (!DISPOSITIONS.has(row.disposition) || !row.reason?.trim()) throw Error(`Invalid audit entry: ${row.path}`);
    if (row.path.startsWith('test/') && row.disposition !== 'not-run') throw Error('Worker tests must be excluded before collection');
    if (MEMBER_FIXTURES.has(row.path) && row.disposition !== 'not-run') throw Error('Member fixtures must be excluded before collection');
    if (row.disposition === 'run-node' && !/^scripts\/.+\.test\.mjs$/.test(row.path)) throw Error(`Invalid Node test: ${row.path}`);
    if (row.disposition === 'run-web' && !/^web\/test\/.+\.test\.ts$/.test(row.path)) throw Error(`Invalid web test: ${row.path}`);
    reviewed.set(row.path, row);
  }
  const actual = new Map();
  for (const row of inventory) {
    if (actual.has(row.path)) throw Error(`duplicate discovered test: ${row.path}`);
    actual.set(row.path, row);
    const audit = reviewed.get(row.path);
    if (!audit) throw Error(`unclassified test: ${row.path}; no tests executed`);
    if (audit.disposition !== 'not-run' && audit.sha256 !== row.sha256) throw Error(`Test audit changed: ${row.path}; no tests executed`);
  }
  for (const path of reviewed.keys()) if (!actual.has(path)) throw Error(`missing audited test: ${path}`);
  const rows = inventory.map(row => ({ ...reviewed.get(row.path), sha256: row.sha256 }));
  const node = rows.filter(row => row.disposition === 'run-node').map(row => row.path);
  const web = rows.filter(row => row.disposition === 'run-web');
  if (!node.length || !web.length) throw Error('Audited Node and web tests are both required');
  return { scope, sourceCommit, rows, commands: [
    { executable: process.execPath, args: ['scripts/updates/build.mjs'], cwd: root },
    { executable: process.execPath, args: ['--test', ...node], cwd: root },
    { executable: process.execPath, args: ['scripts/i18n-check.mjs'], cwd: join(root, 'web') },
    { executable: process.execPath, args: ['../node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.no-accounts.config.ts'], cwd: join(root, 'web') },
  ] };
}

export function runPlan(plan, { execute = spawnSync, write = console.log } = {}) {
  write(`TEST SCOPE ${plan.scope}; source SHA ${plan.sourceCommit}`);
  for (const row of plan.rows) write(`${row.disposition === 'not-run' ? 'NOT RUN' : 'RUN'} ${row.path}; source SHA ${plan.sourceCommit}; sha256 ${row.sha256}; ${row.reason}`);
  if (plan.scope === 'no-accounts') write(`LIMITED COVERAGE: ${plan.rows.filter(row => row.disposition === 'not-run').length} test files NOT RUN; this is not a full-suite pass.`);
  for (const command of plan.commands) {
    let result;
    try { result = execute(command.executable, command.args, { cwd: command.cwd, stdio: 'inherit' }); }
    catch (error) { write(`FAILED: ${error.message}`); return 1; }
    if (result.error || result.status !== 0) {
      write(`FAILED: ${command.args.join(' ')} (${result.error?.message ?? result.signal ?? result.status ?? 'unknown exit'})`);
      return Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
    }
  }
  return 0;
}

export function verifyStage(manifest, gitlink, checkout) {
  if (!/^[a-f0-9]{40}$/.test(manifest.stageCommit ?? '') || manifest.stageCommit !== gitlink || gitlink !== checkout) {
    throw Error('No matching audited stage SHA: review the exact pinned stage before no-accounts CI');
  }
  return true;
}

function main(args) {
  if (args.length === 1 && args[0] === '--check-no-accounts') {
    const manifest = readAudit();
    verifyAuditedFiles(ROOT, manifest);
    const plan = planTests({ scope: 'no-accounts', inventory: discoverTests(ROOT), manifest, root: ROOT, sourceCommit: git(ROOT, ['rev-parse', 'HEAD']) });
    console.log(`No-account inventory validated: ${plan.rows.length} files; no tests collected or executed.`);
    return 0;
  }
  if (args.length === 1 && args[0] === '--resolve-event') {
    const eventName = process.env.SCOPE_EVENT_NAME;
    const commit = process.env.SCOPE_COMMIT;
    if (eventName !== 'workflow_dispatch' && !/^[a-f0-9]{40}$/.test(commit ?? '')) throw Error('Missing scope commit SHA');
    const scope = resolveTestScope({ eventName, dispatchScope: process.env.SCOPE_DISPATCH_INPUT, message: eventName === 'workflow_dispatch' ? '' : git(ROOT, ['show', '-s', '--format=%B', commit]) });
    if (!process.env.GITHUB_OUTPUT) throw Error('GITHUB_OUTPUT is required for CI scope selection');
    appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\n`);
    console.log(`Selected test scope: ${scope}${scope === 'no-accounts' ? ' (limited coverage, explicit exclusions)' : ''}`);
    return 0;
  }
  if (args.length === 1 && args[0] === '--verify-stage') {
    if (git(join(ROOT, 'stage'), ['status', '--porcelain'])) throw Error('The audited stage checkout must be clean');
    verifyStage(readAudit(), git(ROOT, ['rev-parse', 'HEAD:stage']), git(join(ROOT, 'stage'), ['rev-parse', 'HEAD']));
    console.log('Pinned stage matches the audited no-account test source SHA');
    return 0;
  }
  if (args.length !== 2 || args[0] !== '--scope' || !SCOPES.has(args[1])) throw Error('Usage: test-scope.mjs --scope full|no-accounts | --resolve-event | --verify-stage | --check-no-accounts');
  const scope = args[1];
  const manifest = scope === 'no-accounts' ? readAudit() : null;
  const inventory = scope === 'no-accounts' ? discoverTests(ROOT) : [];
  if (manifest) verifyAuditedFiles(ROOT, manifest);
  return runPlan(planTests({ scope, inventory, manifest, root: ROOT, sourceCommit: git(ROOT, ['rev-parse', 'HEAD']) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
