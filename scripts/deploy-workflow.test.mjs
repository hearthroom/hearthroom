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
