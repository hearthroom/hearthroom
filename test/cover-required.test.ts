import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hostGateway, submitHosted } from '../src/hosting';
import { upstream } from '../src/upstream';
import {opsMetrics} from '../src/ops-metrics';
import { GENERAL_RATING, makeMember, resetDb, role, restoreUpstream } from './helpers';

beforeEach(resetDb);
afterEach(()=>{vi.restoreAllMocks();restoreUpstream();});

it.each(['draft','sealed'] as const)('blocks a missing portrait at %s with no review submission',async phase=>{
 const memberId=await makeMember(10001);
 const covered=role({roleId:'cover-check',authorNumId:10001});
 const missing={...covered,avatarUrl:'',backgroundUrl:'',backgroundLandscapeUrl:'https://assets.test/landscape.png',shareImageUrl:'https://assets.test/share.png'};
 vi.spyOn(upstream,'readForReview').mockResolvedValue({document:{roleName:"Fixture",roleTag:["Roleplay"],roleDetailDesc:'字'.repeat(3001)},greetings:{welcome:"Welcome",alternates:[],prologue:[]},hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
 const seal=vi.spyOn(hostGateway,'seal').mockImplementation(async(_e,_t,_id,workId,versionId)=>({workId,versionId,hostedRevisionId:'sealed-cover'}));
 vi.spyOn(hostGateway,'read').mockResolvedValue({...missing,roleId:'sealed-cover'});
 await expect(submitHosted(env,{memberId,account:10001,role:phase==='draft'?missing:covered,token:'author',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()})).rejects.toMatchObject({message:'cover_required'});
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM review_submissions').first('n')).toBe(0);
 expect(await opsMetrics(env.DB)).toContain(`hearthroom_publication_cover_checks_total{phase="${phase}",outcome="missing"} 1`);
 if(phase==='draft'){
  expect(seal).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM hosting_versions').first('n')).toBe(0);
 }
});

it('accepts a portrait with no landscape or share image and replays a completed operation',async()=>{
 const memberId=await makeMember(10001);
 const covered={...role({roleId:'portrait-only',authorNumId:10001}),backgroundLandscapeUrl:'',shareImageUrl:''};
 vi.spyOn(upstream,'readForReview').mockResolvedValue({document:{roleName:"Fixture",roleTag:["Roleplay"],roleDetailDesc:'字'.repeat(3001)},greetings:{welcome:"Welcome",alternates:[],prologue:[]},hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
 const seal=vi.spyOn(hostGateway,'seal').mockImplementation(async(_e,_t,_id,workId,versionId)=>({workId,versionId,hostedRevisionId:'sealed-covered'}));
 vi.spyOn(hostGateway,'read').mockResolvedValue({...covered,roleId:'sealed-covered'});
 const input={memberId,account:10001,role:covered,token:'author',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()};
 const receipt=await submitHosted(env,input);
 expect(await submitHosted(env,{...input,role:{...covered,avatarUrl:'',backgroundUrl:''}})).toEqual(receipt);
 expect(seal).toHaveBeenCalledTimes(1);
});

it.each(['draft','sealed'] as const)('rejects a missing opening at %s before review creation',async phase=>{
 const memberId=await makeMember(10001);
 const card=role({roleId:'opening-check',authorNumId:10001});
 const valid={document:{roleName:'Opening',roleTag:['Roleplay'],roleDetailDesc:'字'.repeat(3001)},greetings:{welcome:'Hello',alternates:[],prologue:[]},hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}};
 vi.spyOn(upstream,'readForReview').mockImplementation(async(_e,_t,id)=>({...valid,greetings:phase==='draft'||id==='sealed-opening'?{welcome:' ',alternates:[],prologue:[' ']}:valid.greetings,authorAsset:{openingMode:'page',openingPage:' '}}));
 const seal=vi.spyOn(hostGateway,'seal').mockImplementation(async(_e,_t,_id,workId,versionId)=>({workId,versionId,hostedRevisionId:'sealed-opening'}));
 vi.spyOn(hostGateway,'read').mockResolvedValue({...card,roleId:'sealed-opening'});
 await expect(submitHosted(env,{memberId,account:10001,role:card,token:'author',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()})).rejects.toMatchObject({status:422,message:'publication_fields_required',extra:{detail:{missing:['opening']}}});
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM review_submissions').first('n')).toBe(0);
 if(phase==='draft')expect(seal).not.toHaveBeenCalled();
});
