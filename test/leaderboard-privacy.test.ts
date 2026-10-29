import {env} from 'cloudflare:test';
import {beforeEach,expect,it} from 'vitest';
import {resetDb,makeMember} from './helpers';
import {readPrivacy,savePrivacy,readPrivacyOperation,projectPlayer} from '../src/leaderboard-privacy';

beforeEach(resetDb);
it('saves global and stable card overrides atomically, with revision and replay protection',async()=>{
 const member=await makeMember(80001);
 expect(await readPrivacy(env.DB,member,'harbor:source')).toMatchObject({anonymous:false,mode:'inherit',revision:0});
 const request={requestId:crypto.randomUUID(),revision:0,anonymous:true,cardKey:'harbor:source',mode:'public' as const,confirmed:true};
 const saved=await savePrivacy(env.DB,member,request);
 expect(saved).toMatchObject({anonymous:true,mode:'public',revision:1});
 expect(await savePrivacy(env.DB,member,request)).toEqual(saved);
 expect(await readPrivacyOperation(env.DB,member,request.requestId)).toEqual(saved);
 await expect(savePrivacy(env.DB,member,{...request,anonymous:false})).rejects.toThrow('privacy_request_conflict');
 await expect(savePrivacy(env.DB,member,{...request,requestId:crypto.randomUUID(),revision:0})).rejects.toThrow('privacy_conflict');
 expect(await readPrivacy(env.DB,member,'harbor:other')).toMatchObject({anonymous:true,mode:'inherit',revision:1});
 await savePrivacy(env.DB,member,{requestId:crypto.randomUUID(),revision:1,anonymous:false,confirmed:true});
 expect(await readPrivacy(env.DB,member,'harbor:source')).toMatchObject({anonymous:false,mode:'public',revision:2});
});
it('requires confirmation before revealing past identity and returns no identity fields for anonymous rows',async()=>{
 const member=await makeMember(80001);
 await savePrivacy(env.DB,member,{requestId:crypto.randomUUID(),revision:0,anonymous:true});
 await expect(savePrivacy(env.DB,member,{requestId:crypto.randomUUID(),revision:1,anonymous:false})).rejects.toThrow('privacy_confirmation_required');
 expect(await readPrivacy(env.DB,member)).toMatchObject({anonymous:true,revision:1});
 const player={rank:18,credits:'9007199254740993',accountNumId:80001,nickname:'Secret',avatarUrl:'https://example.test/secret',handle:'abcdefgh',isSelf:true};
 expect(projectPlayer(player,true)).toEqual({rank:18,credits:'9007199254740993',anonymous:true,isSelf:true});
 expect(projectPlayer(player,false)).toMatchObject({anonymous:false,nickname:'Secret',accountNumId:80001});
});
