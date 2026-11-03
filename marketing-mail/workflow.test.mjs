import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('獨立 CI 只驗證和部署 marketing-mail；不觸發社群主 Worker 部署',()=>{
 const mail=readFileSync(new URL('../.github/workflows/marketing-mail.yml',import.meta.url),'utf8');
 assert.match(mail,/working-directory: marketing-mail/);assert.match(mail,/npm ci/);assert.match(mail,/npm test/);assert.match(mail,/npm run build/);assert.match(mail,/npm run deploy/);
 assert.match(mail,/github.event_name != 'pull_request'/);assert.match(mail,/fetch-depth: 0/);assert.doesNotMatch(mail,/continue-on-error/);
 const main=readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8');assert.match(main,/paths-ignore:[\s\S]*marketing-mail\/\*\*/);
});
test('Worker disables automatic invocation logs to keep envelope metadata out of logs',()=>{
 const config=readFileSync(new URL('./wrangler.toml',import.meta.url),'utf8');
 assert.match(config,/\[observability.logs\][\s\S]*invocation_logs\s*=\s*false/);
});
