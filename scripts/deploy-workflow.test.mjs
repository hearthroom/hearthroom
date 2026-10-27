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
