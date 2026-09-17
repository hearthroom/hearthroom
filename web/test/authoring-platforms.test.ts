import {expect,it,vi} from 'vitest';
const sync=vi.hoisted(()=>vi.fn());
vi.mock('../src/lib/distribution',()=>({synchronize:sync,connectionMessage:(e:Error)=>e.message}));
import {saveCopies} from '../src/lib/authoring-platforms';
it('saves each selected destination once and retains the source when a target fails',async()=>{
 sync.mockRejectedValueOnce(new Error('sync_permission_denied'));
 expect(await saveCopies('fixture','lunatalk',['lunatalk','harbor','harbor'])).toEqual([{provider:'harbor',status:'failed',error:'sync_permission_denied'}]);
 expect(sync).toHaveBeenCalledTimes(1);
 expect(sync).toHaveBeenCalledWith('fixture','lunatalk','harbor',false,true);
});
