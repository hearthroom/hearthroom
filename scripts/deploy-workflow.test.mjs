import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('deployed heat cron runs every ten minutes separately from existing maintenance', () => {
  const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const crons = /^crons\s*=\s*(\[[^\n]+\])/m.exec(config)?.[1];
  assert.deepEqual(JSON.parse(crons ?? '[]'), ['17 * * * *', '2-59/10 * * * *', '*/5 * * * *', '23 16 * * *', '* * * * *']);
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
  const paths = new Set(['/', ...[...pages.matchAll(/^  (?:\.\.\.\(stageSite \? \[)?\{ path: "([a-z][^"]*)"/gm)].map(match => `/${match[1].replace(/:[^/]+/g, "example")}`)]);
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
