// CI 部署要把這一版的 hash 檔歸檔（ASSET_ARCHIVE），下一次部署之後還開著的舊分頁才拿得到自己那一版的區塊。
// 歸檔原本只寫在 `npm run deploy` 裡，CI 直接跑 `npx wrangler deploy`，於是 2026-09-07 之後一次都沒歸檔：
// 14 天 819 次 /assets/* 404，歸檔只命中一次。這裡釘住 CI 的步驟，而不是只信 package.json 的腳本。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const job = workflow.slice(workflow.indexOf('  build-and-deploy:'), workflow.indexOf('\n  update-notes:'));
const steps = job.split(/\n      - /).slice(1).map((text) => ({
  text,
  name: /^name: (.+)$/m.exec(text)?.[1] ?? '',
  run: /run: (.+)$/m.exec(text)?.[1] ?? '',
}));
const index = (predicate) => steps.findIndex(predicate);

test('deployed heat cron runs every ten minutes separately from existing maintenance', () => {
  const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const crons = /^crons\s*=\s*(\[[^\n]+\])/m.exec(config)?.[1];
  assert.deepEqual(JSON.parse(crons ?? '[]'), ['17 * * * *', '2-59/10 * * * *', '*/5 * * * *', '23 16 * * *', '* * * * *']);
});

test('CI defaults to full tests and permits only an explicit audited no-accounts scope', () => {
  assert.match(workflow, /test_scope:[\s\S]*?default: full[\s\S]*?options:\s*\[full, no-accounts\]/);
  const select = index(s => s.name === 'Select explicit test scope');
  const audit = index(s => s.name === 'Verify restricted stage audit');
  const inventory = index(s => s.name === 'Validate restricted inventory before collecting tests');
  const planner = index(s => s.name === 'Verify test scope planner');
  const full = index(s => s.run === 'npm test');
  const limited = index(s => s.run === 'npm run test:no-accounts');
  const build = index(s => s.run === 'npm run build');
  const install = index(s => s.run === 'npm ci');
  const lifecycle = index(s => s.name === 'Restrict automatic npm lifecycles');
  const prepare = index(s => s.name === 'Preserve audited project hooks');
  assert.ok(select >= 0 && audit > select && audit < build);
  assert.ok(inventory > select && inventory < planner && planner < build);
  assert.ok(inventory < lifecycle && lifecycle < install && install < prepare && prepare < build);
  assert.match(steps[lifecycle].text, /if: steps\.test-scope\.outputs\.scope == 'no-accounts'/);
  assert.match(steps[lifecycle].text, /npm_config_ignore_scripts=true/);
  assert.match(steps[prepare].text, /if: steps\.test-scope\.outputs\.scope == 'no-accounts'/);
  assert.equal(steps[prepare].run, 'npm run prepare');
  assert.ok(full > build && limited > build);
  assert.match(steps[select].text, /SCOPE_COMMIT: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(steps[audit].text, /if: steps\.test-scope\.outputs\.scope == 'no-accounts'/);
  assert.match(steps[audit].text, /node scripts\/test-scope\.mjs --verify-stage/);
  assert.match(steps[full].text, /if: steps\.test-scope\.outputs\.scope == 'full'/);
  assert.match(steps[limited].text, /if: steps\.test-scope\.outputs\.scope == 'no-accounts'/);
  assert.doesNotMatch(steps[limited].text, /continue-on-error/);
  const playground = steps[index(s => s.name === 'Verify and build the pinned playground')].text;
  for (const command of ['npm test', 'npm run i18n:check', 'npm run build:h5:prod', 'node scripts/copy-playground-sandbox.mjs', 'bash scripts/check-build-output.sh']) assert.ok(playground.includes(command));
});

test('the deployed web build receives explicit proxy rollout and rollback controls', () => {
  assert.match(job, /VITE_HARBOR_API_TRANSPORT: \$\{\{ vars\.HARBOR_API_TRANSPORT \|\| 'direct' \}\}/);
  assert.match(job, /VITE_HARBOR_PROXY_HOSTS: \$\{\{ vars\.HARBOR_PROXY_HOSTS \}\}/);
  assert.doesNotMatch(job, /HARBOR_HEARTHROOM_PROXY_SECRET/);
});

test('Harbor proxy requests reach the Worker instead of the static SPA', () => {
  const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const routes = /run_worker_first\s*=\s*\[([\s\S]*?)\]/.exec(config)?.[1] ?? '';
  const patterns = [...routes.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  for (const path of ['/hh-api', '/hh-api/open/v1/me', '/hh-api/open/v1/conversation/ws']) {
    assert.ok(patterns.some(pattern => pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern));
  }
});

test('numeric card-app entrypoints reach current work permission and noindex handling',()=>{
 const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
 const routes=/run_worker_first\s*=\s*\[([\s\S]*?)\]/.exec(config)?.[1]??'';
 const patterns=[...routes.matchAll(/"([^"]+)"/g)].map(match=>match[1]);
 for(const card of ['100001','200001','999999999999'])for(const suffix of ['','/']){
  const path=`/${card}${suffix}`;
  assert.ok(patterns.some(pattern=>pattern.endsWith('*')?path.startsWith(pattern.slice(0,-1)):path===pattern),`${path} bypasses work permission and noindex handling`);
 }
});

test('CI archives the built assets on every deploy, after the Worker is live', () => {
  const archive = index((s) => s.run.includes('npm run archive:assets'));
  assert.notEqual(archive, -1, 'no CI step runs npm run archive:assets');
  const deploy = index((s) => s.name === 'Deploy');
  const playground = index((s) => s.name === 'Deploy Moonstage playground');
  assert.ok(archive > deploy && archive > playground, 'archiving must not be able to block either deploy');
  const step = steps[archive].text;
  assert.match(step, /if: env\.CAN_DEPLOY == 'true'/);
  assert.match(step, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(step, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  // 失敗要看得見：歸檔沒寫進去，下一次部署時開著的分頁就會壞，不能默默變綠。
  assert.doesNotMatch(step, /continue-on-error/);
});


test('guide HTML reaches the Worker before the static SPA shell in every locale', () => {
  const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const routes = /run_worker_first\s*=\s*\[([\s\S]*?)\]/.exec(config)?.[1] ?? '';
  const patterns = [...routes.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  for (const prefix of ['', '/zh-Hans', '/en', '/ja', '/ko']) {
    for (const suffix of ['', '/']) {
      const path = `${prefix}/guide${suffix}`;
      assert.ok(patterns.some(pattern => pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern), `${path} bypasses the Worker metadata handler`);
    }
  }
});

test('all site page entrypoints reach the Worker for the initial localized manifest', () => {
  const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const routes = /run_worker_first\s*=\s*\[([\s\S]*?)\]/.exec(config)?.[1] ?? '';
  const patterns = [...routes.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const router = readFileSync(new URL('../web/src/router.ts', import.meta.url), 'utf8');
  const pages = router.slice(router.indexOf('const pages:'), router.indexOf('const playAppPages'));
  const paths = new Set(['/', ...[...pages.matchAll(/^  \{ path: "([a-z][^"]*)"/gm)].map(match => `/${match[1].replace(/:[^/]+/g, "example")}`)]);
  for (const path of paths) {
    assert.ok(patterns.some(pattern => pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern), `${path} bypasses manifest localization`);
  }
});

test('review playback authority callback reaches the Worker instead of the SPA fallback',()=>{
 const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
 const routes=/run_worker_first\s*=\s*\[([\s\S]*?)\]/.exec(config)?.[1]??'';
 const patterns=[...routes.matchAll(/"([^"]+)"/g)].map(match=>match[1]);
 const path='/internal/review/11111111-1111-4111-8111-111111111111/play-access';
 assert.ok(patterns.some(p=>p.endsWith('*')?path.startsWith(p.slice(0,-1)):path===p),'review callback bypasses authority handler');
});

test('Harbor account notice callback reaches the Worker instead of the asset layer',()=>{
 const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
 const routes=/run_worker_first\s*=\s*\[([\s\S]*?)\]/.exec(config)?.[1]??'';
 const patterns=[...routes.matchAll(/"([^"]+)"/g)].map(match=>match[1]);
 const path='/internal/enforcement/notices';
 assert.ok(patterns.some(p=>p.endsWith('*')?path.startsWith(p.slice(0,-1)):path===p),'enforcement notice POST is swallowed by static assets (405)');
});

test('Workshop internal sync callbacks and public detail entrypoints reach the Worker instead of static assets',()=>{
 const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
 const routes=/run_worker_first\s*=\s*\[([\s\S]*?)\]/.exec(config)?.[1]??'';
 const patterns=[...routes.matchAll(/"([^"]+)"/g)].map(match=>match[1]);
 for (const path of ['/internal/workshop/events', '/internal/workshop/sync', '/workshops/ws-example']) {
  assert.ok(patterns.some(p=>p.endsWith('*')?path.startsWith(p.slice(0,-1)):path===p),`${path} bypasses Worker`);
 }
});
