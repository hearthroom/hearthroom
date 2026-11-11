import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({card:vi.fn(),copies:vi.fn()}));
vi.mock('../src/lib/api',()=>({fetchCard:mocks.card}));
vi.mock('../src/lib/distribution',()=>({copies:mocks.copies}));
import { authorPlaytest } from '../src/lib/play-recovery';
beforeEach(()=>{
 mocks.card.mockReset().mockResolvedValue({id:'490001',num:490001,roleId:'fixture-source',provider:'harbor'});
 mocks.copies.mockReset().mockResolvedValue([{provider:'harbor',roleId:'fixture-source',status:'source'}]);
});
afterEach(()=>vi.useRealTimers());
it('requires the authenticated source ownership API, including for a publicly readable card',async()=>{
 mocks.copies.mockRejectedValue({status:403});expect(await authorPlaytest('490001','harbor','en')).toBeNull();
 expect(mocks.card).toHaveBeenCalledWith('490001','en',{quiet:true});expect(mocks.copies).toHaveBeenCalledWith('fixture-source','harbor');
});
it('does not send selected-service credentials to a card from a different service',async()=>{
 mocks.card.mockResolvedValue({id:'490001',roleId:'other-source',provider:'other'});
 expect(await authorPlaytest('490001','harbor','en')).toBeNull();expect(mocks.copies).not.toHaveBeenCalled();
});
it('offers only a playable source copy on the selected service',async()=>{
 mocks.copies.mockResolvedValue([{provider:'harbor',roleId:'fixture-source',status:'failed'}]);
 expect(await authorPlaytest('490001','harbor','en')).toBeNull();
 mocks.copies.mockResolvedValue([{provider:'harbor',roleId:'fixture-source',status:'source'}]);
 expect(await authorPlaytest('490001','harbor','en')).toBe('490001');
});
it('stops holding the error page at three seconds and cannot turn a late response into a draft entrance',async()=>{
 vi.useFakeTimers();let finish!:(value:unknown)=>void;mocks.copies.mockImplementation(()=>new Promise(r=>{finish=r}));
 const result=authorPlaytest('490001','harbor','en');let settled=false;void result.then(()=>{settled=true;});
 await vi.advanceTimersByTimeAsync(2999);expect(settled).toBe(false);
 await vi.advanceTimersByTimeAsync(1);expect(await result).toBeNull();
 finish([{provider:'harbor',roleId:'fixture-source',status:'source'}]);await vi.advanceTimersByTimeAsync(0);expect(await result).toBeNull();
});
