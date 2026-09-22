import { env } from 'cloudflare:test';
import { expect, it, vi } from 'vitest';
import worker from '../src/index';

it('holds HTTP and cron on the legacy schema and resumes after the atomic migration', async () => {
  // Worker modules share the readiness cache across test files, while each file
  // has isolated D1 storage. Give this database a distinct binding identity.
  const gateEnv = {...env, DB: {prepare:env.DB.prepare.bind(env.DB)} as D1Database};
  await env.DB.prepare('ALTER TABLE cards RENAME TO cards_gate_fixture').run();
  await env.DB.prepare('CREATE TABLE cards (id TEXT PRIMARY KEY)').run();
  const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
  try {
    const response = await worker.fetch(new Request('https://c.test/v1/providers'), gateEnv, ctx);
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('30');
    await worker.scheduled({} as ScheduledController, gateEnv, ctx);
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  } finally {
    await env.DB.prepare('DROP TABLE cards').run();
    await env.DB.prepare('ALTER TABLE cards_gate_fixture RENAME TO cards').run();
  }
  expect((await worker.fetch(new Request('https://c.test/v1/providers'), gateEnv, ctx)).status).toBe(200);
});
