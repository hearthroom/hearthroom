import {expect,it,vi} from 'vitest';
const sync=vi.hoisted(()=>vi.fn());
const copyList=vi.hoisted(()=>vi.fn());
const token=vi.hoisted(()=>vi.fn());
vi.mock('../src/lib/connections',()=>({accountToken:token}));
vi.mock('../src/lib/distribution',()=>({synchronize:sync,copies:copyList,connectionMessage:(e:Error)=>e.message}));
import {saveCopies,savedDistributionTargets} from '../src/lib/authoring-platforms';
it('saves each selected destination once and retains the source when a target fails',async()=>{
 sync.mockRejectedValueOnce(new Error('sync_permission_denied'));
 expect(await saveCopies('fixture','lunatalk',['lunatalk','harbor','harbor'])).toEqual([{provider:'harbor',status:'failed',error:'sync_permission_denied'}]);
 expect(sync).toHaveBeenCalledTimes(1);
 expect(sync).toHaveBeenCalledWith('fixture','lunatalk','harbor',false,true);
});

it('reuses only destinations already saved for this work when submitting a version',async()=>{
 copyList.mockResolvedValue([{provider:'lunatalk',roleId:'source',status:'source'},{provider:'harbor',roleId:'copy',status:'synced'}]);
 token.mockResolvedValue('target-proof');
 expect(await savedDistributionTargets('source','lunatalk')).toEqual([{provider:'harbor',token:'target-proof'}]);
 expect(token).toHaveBeenCalledWith('harbor');
 copyList.mockResolvedValue([{provider:'lunatalk',roleId:'source',status:'source'}]);
 expect(await savedDistributionTargets('source','lunatalk')).toEqual([]);
});
