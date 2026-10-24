import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { upstream } from '../src/upstream';
import { requireMember } from '../src/members';
import { resetDb } from './helpers';
import type { Env } from '../src/types';

let replies:unknown[]=[];
beforeEach(async()=>{
 await resetDb();replies=[];
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(url!=='https://api.harperharbor.com/open/v1/me'||!replies.length)throw new Error('unexpected fixture request');
  return new Response(JSON.stringify(replies.shift()),{status:200,headers:{'Content-Type':'application/json'}});
 });
});
afterEach(()=>{expect(replies).toHaveLength(0);vi.restoreAllMocks();});
const body=(extra:Record<string,unknown>={})=>({accountNumId:80001,nickName:'fixture',...extra});
const identity=(value:unknown)=>replies.push(value);
const configured=()=>({...env,HARBOR_TEST_ACCOUNTS_ENABLED:'1'} as Env);

it('preserves a trusted test classification instead of dropping it at fetchMe',async()=>{
 identity(body({accountClass:'test',testState:'active',testGeneration:1}));
 const me=await upstream.fetchMe(configured(),'fixture-access','harbor');
 expect(me).toMatchObject({accountClass:'test',testState:'active',testGeneration:1});
});

it('fails closed for missing or inactive Harbor classification once the deployment gate is enabled',async()=>{
 for(const data of [body(),body({accountClass:'test',testState:'paused',testGeneration:1}),body({accountClass:'test',testState:'active',testGeneration:0})]){
  identity(data);
  await expect(upstream.fetchMe(configured(),'fixture-access','harbor')).rejects.toThrow();
 }
});

it('creates the member with its class before profile initialization and rejects normal/test identity merging',async()=>{
 const app=new Hono<{Bindings:Env}>();app.get('/member',async c=>c.json(await requireMember(c)));
 identity(body({accountClass:'test',testState:'active',testGeneration:1}));
 const first=await app.request('https://sukisuki.ai/member',{headers:{Authorization:'Bearer fixture-access'}},configured());
 expect(first.status).toBe(200);
 const stored=await env.DB.prepare('SELECT account_class,test_generation FROM members').first();
 expect(stored).toMatchObject({account_class:'test',test_generation:1});
 identity(body({accountClass:'normal'}));
 const merge=await app.request('https://sukisuki.ai/member',{headers:{Authorization:'Bearer fixture-access'}},configured());
 expect(merge.status).not.toBe(200);
 expect((await env.DB.prepare('SELECT account_class FROM members').first())?.account_class).toBe('test');
});
