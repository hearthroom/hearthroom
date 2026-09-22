import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function needsCardCutover(value) {
  const type = Array.isArray(value) && value.length === 1 && value[0].success === true
    && value[0].results?.length === 1 && value[0].results[0].type;
  if (type !== 'TEXT' && type !== 'INTEGER') throw new Error('Cannot identify the card primary-key schema');
  return type === 'TEXT';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = execFileSync('npx', ['wrangler','d1','execute','DB','--remote','--json','--command',
    "SELECT type FROM pragma_table_info('cards') WHERE name='id'"], {encoding:'utf8'});
  const cutover = needsCardCutover(JSON.parse(result));
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  appendFileSync(process.env.GITHUB_OUTPUT, `cutover=${cutover}\n`);
}
