import { beforeEach, expect, it, vi } from 'vitest';
import { createVisibilityController } from '../src/lib/visibility-controller';
import type { WorkVisibility } from '../src/lib/work-visibility';
import { VisibilityError } from '../src/lib/work-visibility';
const mocks=vi.hoisted(()=>({read:vi.fn(),change:vi.fn(),operation:vi.fn()}));
vi.mock('../src/lib/work-visibility',async original=>({...await original<typeof import('../src/lib/work-visibility')>(),fetchWorkVisibility:mocks.read,changeWorkVisibility:mocks.change,fetchVisibilityOperation:mocks.operation}));
export const policy=(extra:Partial<WorkVisibility>={}):WorkVisibility=>({access:'private',effectiveAccess:'owner',review:'none',update:'none',everPublic:false,revisionState:'unknown',restorable:false,restoreReason:'no_approval',draftChanged:false,restriction:'none',policyRevision:'1',approvalRevision:'0',actions:['set_private','set_unlisted','submit_review'],syncState:'complete',...extra});
const setup=()=>createVisibilityController({id:'source',provider:'harbor',actor:'22',token:async()=> 'token'});
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();mocks.read.mockResolvedValue({workVisibility:policy()});});
it('keeps a pending operation across remount and only reads the original key until durable completion',async()=>{
 mocks.change.mockImplementation(async(_id,_token,_provider,command)=>({operation:{operationId:command.operationId,state:'pending'}}));
 mocks.operation.mockImplementation(async(_id,key)=>({operation:{operationId:key,state:'pending'}}));
 const first=setup();await first.load();await first.apply('unlisted');
 expect(first.phase.value).toBe('pending');expect(first.value.value?.access).toBe('private');
 const key=mocks.change.mock.calls[0][3].operationId;
 const second=setup();await second.load();await second.apply('public');
 expect(mocks.change).toHaveBeenCalledTimes(1);expect(mocks.operation.mock.calls.every(c=>c[1]===key)).toBe(true);
 mocks.operation.mockResolvedValue({operation:{operationId:key,state:'complete'}});
 mocks.read.mockResolvedValue({workVisibility:policy({access:'unlisted',effectiveAccess:'link',policyRevision:'2'})});
 await second.check();expect(second.phase.value).toBe('ready');expect(second.value.value?.access).toBe('unlisted');
 expect(mocks.change).toHaveBeenCalledTimes(1);
});
it('does not invent a restore permission or claim unknown means changed',async()=>{
 mocks.read.mockResolvedValue({workVisibility:policy({everPublic:true,restorable:true,actions:['set_private']})});
 const c=setup();await c.load();await c.apply('public');expect(mocks.change).not.toHaveBeenCalled();
});
it('cancel review preserves access and never sends targetAccess',async()=>{
 mocks.read.mockResolvedValue({workVisibility:policy({access:'public',actions:['cancel_review'],update:'pending'})});
 mocks.change.mockImplementation(async(_id,_token,_provider,command)=>({operation:{operationId:command.operationId,state:'complete'},workVisibility:policy({access:'public'})}));
 const c=setup();await c.load();await c.cancelReview();
 expect(mocks.change.mock.calls[0][3]).toMatchObject({action:'cancel_review',expectedPolicyRevision:'1',expectedApprovalRevision:'0'});
 expect(mocks.change.mock.calls[0][3]).not.toHaveProperty('targetAccess');
});
it('lost response and failed readback remain unknown and cannot issue another mutation',async()=>{
 mocks.change.mockRejectedValue(new Error('network'));mocks.operation.mockRejectedValue(new Error('network'));
 const c=setup();await c.load();await c.apply('unlisted');await c.apply('private');
 expect(c.phase.value).toBe('unknown');expect(mocks.change).toHaveBeenCalledTimes(1);
});
it('reads the latest projection after a conflict without applying it under fresh revisions',async()=>{
 const c=setup();await c.load();
 mocks.change.mockImplementation(async(_id,_token,_provider,command)=>{throw new VisibilityError(409,{error:'visibility_operation_conflict',operation:{operationId:command.operationId,state:'conflict'}});});
 mocks.operation.mockImplementation(async(_id,key)=>{throw new VisibilityError(409,{operation:{operationId:key,state:'conflict'}});});
 mocks.read.mockResolvedValue({workVisibility:policy({access:'public',policyRevision:'newer'})});
 await c.apply('unlisted');expect(c.value.value?.access).toBe('public');expect(c.message.value).toBe('conflict');
 expect(mocks.change).toHaveBeenCalledTimes(1);expect(c.phase.value).toBe('ready');
});
it('a changing projection has an actionable unknown state even without a locally saved command',async()=>{
 mocks.read.mockResolvedValue({workVisibility:policy({syncState:'changing'})});
 const c=setup();await c.load();expect(c.phase.value).toBe('unknown');
 await c.apply('unlisted');expect(mocks.change).not.toHaveBeenCalled();
 mocks.read.mockResolvedValue({workVisibility:policy()});await c.check();expect(c.phase.value).toBe('ready');
});
