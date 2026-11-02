import {ADULT_CONSENT_VERSION} from '../shared/adult-consent';
import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ownedHistory } from '../src/owned-history';
import { approveFixtureResponse } from './hosted-fixture';
import { bearer, identities, makeMember, ratingBody, resetDb, restoreUpstream, rolesOnMainSite } from './helpers';

const originalHistory = ownedHistory.read;
let cardId: string;
let fanId: string;
const request = (path: string, method = 'GET', body?: unknown) => SELF.fetch(`https://c.test/v1/${path}`, {
  method, headers: { ...bearer('fan'), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const data = async (response: Response) => await response.json() as any;

beforeEach(async () => {
  await resetDb();
  identities({ author: 10001, fan: 20001 });
  rolesOnMainSite({ roleId: 'region-chat-role', authorNumId: 10001 });
  const registered = await approveFixtureResponse(await SELF.fetch('https://c.test/v1/cards', {
    method: 'POST', headers: { ...bearer('author'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId: crypto.randomUUID(), roleId: 'region-chat-role', ...ratingBody(false) }),
  }));
  cardId = (await data(registered)).id;
  fanId = await makeMember(20001);
  await env.DB.prepare("UPDATE members SET country_region='CN',show_nsfw=1,age_verified_at=1,adult_consent_version=1 WHERE id=?").bind(fanId).run();
  await request('me/conversations', 'PUT', { roleId: 'region-chat-role', conversationId: 'region-saved-chat' });
  ownedHistory.read = async (_env, _token, id) => ({ conversationId: id, roleId: 'region-chat-role', title: 'Synthetic saved title', canGenerate: true });
});
afterEach(() => { ownedHistory.read = originalHistory; restoreUpstream(); });

it('hides CN adult conversation rows and restores them on region change without deleting pointers', async () => {
  expect((await request(`me/favorites/${cardId}`,'PUT')).status).toBe(200);
  await env.DB.prepare("UPDATE cards SET rating='R' WHERE id=?").bind(cardId).run();
  expect((await data(await request('me/conversations'))).conversations).toEqual([]);
  expect((await data(await request('me/favorites'))).items).toEqual([]);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM member_conversations WHERE member_id=?').bind(fanId).first<{n:number}>())?.n).toBe(1);
  await env.DB.prepare("UPDATE members SET country_region='TW',show_nsfw=0 WHERE id=?").bind(fanId).run();
  expect((await data(await request('me/conversations'))).conversations).toHaveLength(1);
  expect((await data(await request('me/favorites'))).items).toHaveLength(1);
});

it('keeps safe CN conversation admission and hides a historical R snapshot even when the current card is safe', async () => {
  expect((await data(await request('me/conversations'))).conversations).toHaveLength(1);
  expect((await request('me/conversations/region-saved-chat?provider=harbor')).status).toBe(200);
  const version=await env.DB.prepare('SELECT work_id,member_id,source_role_id FROM hosting_versions WHERE card_id=? LIMIT 1').bind(cardId).first<{work_id:string;member_id:string;source_role_id:string}>();
  expect(version).not.toBeNull();
  await env.DB.prepare(`INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,rating,hosted_revision_id,card_id,state,created_at)
    VALUES('region-old-version',?,?,?,?, 'harbor','R','region-old-replica',?,'approved',1)`)
    .bind(version!.work_id,version!.member_id,'region-old-operation',version!.source_role_id,cardId).run();
  ownedHistory.read=async(_env,_token,id)=>({conversationId:id,roleId:'region-old-replica',canGenerate:true});
  // Provider may migrate a saved pointer to another revision in the same work.
  // That canonical R revision must be fenced before returning its title or IDs.
  expect((await data(await request('me/conversations'))).conversations).toEqual([]);
  expect((await request('me/conversations/region-saved-chat?provider=harbor')).status).toBe(403);
  await env.DB.prepare("UPDATE member_conversations SET role_id='region-old-replica' WHERE member_id=?").bind(fanId).run();
  expect((await data(await request('me/conversations'))).conversations).toEqual([]);
  const denied=await request('me/conversations/region-saved-chat?provider=harbor');
  expect(denied.status).toBe(403);
  expect(await data(denied)).toMatchObject({error:'region_unavailable'});
  await env.DB.prepare("UPDATE members SET country_region='JP' WHERE id=?").bind(fanId).run();
  expect((await data(await request('me/conversations'))).conversations).toHaveLength(1);
  expect((await request('me/conversations/region-saved-chat?provider=harbor')).status).toBe(200);
});

it('rejects a CN old adult conversation link with region_unavailable while retaining ownership checks', async () => {
  await env.DB.prepare("UPDATE cards SET rating='R' WHERE id=?").bind(cardId).run();
  const denied = await request('me/conversations/region-saved-chat?provider=harbor');
  expect(denied.status).toBe(403);
  expect(await data(denied)).toMatchObject({ error: 'region_unavailable' });
  expect((await request('me/conversations/not-owned?provider=harbor')).status).toBe(404);
});


it('does not exempt an author resuming their own public R conversation in CN',async()=>{
 const ownerRequest=(path:string,method='GET',body?:unknown)=>SELF.fetch(`https://c.test/v1/${path}`,{method,headers:{...bearer('author'),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 expect((await ownerRequest('me/settings','POST',{countryRegion:'TW',showNsfw:true,birthdate:'1990-01-01',consentVersion:ADULT_CONSENT_VERSION})).status).toBe(200);
 expect((await ownerRequest('me/conversations','PUT',{roleId:'region-chat-role',conversationId:'owner-region-chat'})).status).toBe(200);
 await env.DB.prepare("UPDATE cards SET rating='R' WHERE id=?").bind(cardId).run();
 expect((await ownerRequest('me/conversations/owner-region-chat?provider=harbor')).status).toBe(200);
 expect((await ownerRequest('me/settings','POST',{countryRegion:'CN'})).status).toBe(200);
 const blocked=await ownerRequest('me/conversations/owner-region-chat?provider=harbor');
 expect(blocked.status).toBe(403);expect(blocked.headers.get('Cache-Control')).toBe('private, no-store');
 expect(await blocked.json()).toMatchObject({error:'region_unavailable'});
 expect((await data(await ownerRequest('me/conversations'))).conversations).toEqual([]);
 expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM member_conversations WHERE conversation_id='owner-region-chat'").first<{n:number}>())?.n).toBe(1);
 expect((await ownerRequest('me/settings','POST',{countryRegion:'TW'})).status).toBe(200);
 expect((await ownerRequest('me/conversations/owner-region-chat?provider=harbor')).status).toBe(200);
});
