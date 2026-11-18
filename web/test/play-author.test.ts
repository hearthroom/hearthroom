/**
 * 舞台的 ?sdkDebug=1 除錯面板只給作者本人試玩（J QA O2）：
 * 擁有權由 resolvePlayCard 的 source 路徑（copies）驗過才算，網址上的 mode=source 本身不算。
 */
import {beforeEach, expect, it, vi} from 'vitest';
const {card, platforms, copies, review, pointer, owned} = vi.hoisted(() => ({card:vi.fn(),platforms:vi.fn(),copies:vi.fn(),review:vi.fn(),pointer:vi.fn(),owned:vi.fn()}));
vi.mock('../src/lib/api',()=>({fetchCard:card,fetchCardPlatforms:platforms,fetchReviewDetail:review}));
vi.mock('../src/lib/distribution',()=>({copies}));
vi.mock('../src/lib/library',()=>({libraryRequest:pointer}));
vi.mock('../src/lib/owned-history',()=>({fetchOwnedHistory:owned}));
import {resolvePlayCard} from '../src/lib/play-card';
import {isAuthorPlaytest, setAuthorPlaytest} from '../src/lib/play-author';
beforeEach(()=>{
 vi.clearAllMocks();
 setAuthorPlaytest(null);
 card.mockResolvedValue({id:'100076',num:100076,provider:'harbor',roleId:'approved',sourceRoleId:'source-role'});
 platforms.mockResolvedValue([{provider:'harbor',roleId:'approved',playable:true}]);
 copies.mockResolvedValue([{provider:'harbor',roleId:'source-role',status:'source'}]);
});
it('作者試玩：擁有權檢查走過才標 authorSource',async()=>{
 const result=await resolvePlayCard('100076','harbor','zh',true);
 expect(copies).toHaveBeenCalledWith('source-role','harbor');
 expect(result).toMatchObject({roleId:'source-role',authorSource:true});
});
it('一般遊玩不標',async()=>{
 const result=await resolvePlayCard('100076','harbor','zh');
 expect(result.authorSource).toBeUndefined();
});
it('mode=source 加 review：不經擁有權檢查，也不標',async()=>{
 review.mockResolvedValue({card:{id:'100076',roleId:'approved'}});
 const result=await resolvePlayCard('100076','harbor','zh',true,{id:'r1',token:'t'});
 expect(copies).not.toHaveBeenCalled();
 expect(result.authorSource).toBeUndefined();
});
it('mode=source 加 resume：走紀錄那條，不標',async()=>{
 pointer.mockResolvedValue({cardNumber:100076,provider:'harbor',roleId:'old'});
 owned.mockResolvedValue({conversationId:'conv',roleId:'old',canGenerate:true});
 const result=await resolvePlayCard('100076','harbor','zh',true,undefined,{id:'conv',token:'t'});
 expect(copies).not.toHaveBeenCalled();
 expect(result.authorSource).toBeUndefined();
});
it('作者旗標綁卡：別張卡、清掉之後都不算',()=>{
 setAuthorPlaytest('source-role');
 expect(isAuthorPlaytest('source-role')).toBe(true);
 expect(isAuthorPlaytest('other')).toBe(false);
 setAuthorPlaytest(null);
 expect(isAuthorPlaytest('source-role')).toBe(false);
 expect(isAuthorPlaytest('')).toBe(false);
});
