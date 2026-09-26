import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { BOOKMARK_COOKIE, startsAtPrimary, withD1Session } from '../src/d1-session';

it('starts writes, sign-in callbacks and server-to-server calls at the primary; reads and the two auth reads may use a replica',()=>{
  expect(startsAtPrimary('GET','/v1/cards/100076')).toBe(false);
  expect(startsAtPrimary('HEAD','/')).toBe(false);
  expect(startsAtPrimary('POST','/v1/auth/token')).toBe(false);
  expect(startsAtPrimary('POST','/v1/auth/session')).toBe(false);
  expect(startsAtPrimary('POST','/v1/auth/logout')).toBe(true);
  expect(startsAtPrimary('PUT','/v1/me/conversations')).toBe(true);
  expect(startsAtPrimary('DELETE','/v1/me/cards/x/saves/y')).toBe(true);
  expect(startsAtPrimary('GET','/auth/callback')).toBe(true);
  expect(startsAtPrimary('GET','/internal/community/x')).toBe(true);
});

function recorder(){
  const seen:string[]=[];
  const db={withSession(c:string){seen.push(c);return env.DB.withSession(c as any);}} as unknown as D1Database;
  return {seen,env:{...env,DB:db} as any};
}

it('opens the session from the bookmark the browser brings back, and ignores malformed ones',()=>{
  const r=recorder();
  const bookmark='00000000-0000002d-00000000-00000000000000000000000000000000';
  withD1Session(new Request('https://hearthroom.club/v1/cards/1',{headers:{Cookie:`a=1; ${BOOKMARK_COOKIE}=${bookmark}`}}),r.env);
  withD1Session(new Request('https://hearthroom.club/v1/cards/1',{headers:{Cookie:`${BOOKMARK_COOKIE}=first-primary`}}),r.env);
  withD1Session(new Request('https://hearthroom.club/v1/cards/1'),r.env);
  withD1Session(new Request('https://hearthroom.club/v1/me/conversations',{method:'PUT',headers:{Cookie:`${BOOKMARK_COOKIE}=${bookmark}`}}),r.env);
  expect(r.seen).toEqual([bookmark,'first-unconstrained','first-unconstrained','first-primary']);
});

it('hands the bookmark back after a write so the next read sees it, but not on plain reads',async()=>{
  const write=withD1Session(new Request('https://hearthroom.club/v1/me/conversations',{method:'PUT'}),env as any);
  await write.env.DB.prepare('SELECT 1').first();
  const cookie=write.finish(new Response('ok')).headers.get('Set-Cookie')??'';
  expect(cookie).toMatch(new RegExp(`^${BOOKMARK_COOKIE}=[0-9a-f-]+; Path=/; Max-Age=300; HttpOnly; Secure; SameSite=Lax$`));
  const read=withD1Session(new Request('https://hearthroom.club/v1/cards/1'),env as any);
  await read.env.DB.prepare('SELECT 1').first();
  expect(read.finish(new Response('ok')).headers.get('Set-Cookie')).toBeNull();
});
