#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function readMessages({ endpoint, token }, limit = 5, fetchImpl = fetch) {
  const origin = new URL(endpoint);
  if (origin.protocol !== 'https:') throw new Error('HTTPS endpoint required');
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('endpoint must be an HTTPS origin');
  if (typeof token !== 'string' || token.length < 32) throw new Error('Read token missing');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('limit must be 1..20');
  const response = await fetchImpl(`${origin.origin}/messages?limit=${limit}`, {
    headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Mail read failed (HTTP ${response.status})`);
  return response.json();
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const args = process.argv.slice(2);
    let file, limit = 5;
    while (args.length) {
      const key = args.shift();
      if (key === '--config') file = args.shift();
      else if (key === '--limit') limit = Number(args.shift());
      else throw new Error('Usage: cli.mjs --config <infra-access/client.json> [--limit 1..20]');
    }
    if (!file) throw new Error('--config is required');
    if ((statSync(file).mode & 0o077) !== 0) throw new Error('Credential file must have mode 600');
    console.log(JSON.stringify(await readMessages(JSON.parse(readFileSync(file, 'utf8')), limit), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
