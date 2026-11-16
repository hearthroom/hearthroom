import {env} from 'cloudflare:test';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {resetDb,makeMember} from './helpers';
import {restoreLegacyPolicyFixture} from './work-policy-fixture';
import {runWorkPolicyOperation,workPolicyGateway,type WorkPolicyCommand} from '../src/work-policy';

beforeEach(async()=>{await resetDb();restoreLegacyPolicyFixture();vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({error:'cover_required'},{status:422}));});
afterEach(()=>vi.restoreAllMocks());
const candidate={...env,HOSTING_SERVICE_KEY:'local-cover-fixture'};
const command=():WorkPolicyCommand=>({workId:crypto.randomUUID(),operationId:crypto.randomUUID(),expectedEpoch:1,action:'restore'});

it('preserves the Provider cover refusal through the policy gateway',async()=>{
 await expect(workPolicyGateway.change(candidate,'harbor','cover-source',command(),'author')).rejects.toMatchObject({status:422,message:'cover_required'});
});

it('records the definitive cover refusal as terminal instead of leaving a pending operation',async()=>{
 const member=await makeMember(10001),input=command();
 await env.DB.prepare('INSERT INTO works VALUES(?,?,?,?,?)').bind(input.workId,member,'harbor','cover-source',Date.now()).run();
 await expect(runWorkPolicyOperation(candidate,'harbor','cover-source',input,'author')).rejects.toMatchObject({status:422,message:'cover_required'});
 expect(await env.DB.prepare('SELECT state FROM visibility_operations WHERE operation_id=?').bind(input.operationId).first('state')).toBe('conflict');
});
