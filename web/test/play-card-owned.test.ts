import {beforeEach, expect, it, vi} from 'vitest';
const {pointer, owned, card, platforms} = vi.hoisted(() => ({pointer:vi.fn(),owned:vi.fn(),card:vi.fn(),platforms:vi.fn()}));
vi.mock('../src/lib/library',()=>({libraryRequest:pointer}));
vi.mock('../src/lib/owned-history',()=>({fetchOwnedHistory:owned}));
vi.mock('../src/lib/api',()=>({fetchCard:card,fetchCardPlatforms:platforms,fetchReviewDetail:vi.fn()}));
vi.mock('../src/lib/distribution',()=>({copies:vi.fn()}));
import {resolvePlayCard} from '../src/lib/play-card';
beforeEach(()=>{
 vi.clearAllMocks();
 pointer.mockResolvedValue({cardNumber:100076,provider:'harbor',roleId:'old'});
 owned.mockResolvedValue({conversationId:'conv',roleId:'old',title:'Saved title',canGenerate:false,reason:'author_private'});
 card.mockRejectedValue(new Error('private detail'));
});
it('opens owned private history before public card/platform reads and keeps its original version',async()=>{
 const result=await resolvePlayCard('100076','harbor','zh',false,undefined,{id:'conv',token:'t'});
 expect(result).toMatchObject({number:'100076',roleId:'old',readOnly:true,conversationId:'conv',reason:'author_private'});
 expect(card).not.toHaveBeenCalled();expect(platforms).not.toHaveBeenCalled();
});
it('rejects a different card binding before inspecting provider history',async()=>{
 await expect(resolvePlayCard('100077','harbor','zh',false,undefined,{id:'conv',token:'t'})).rejects.toThrow('conversation_card_mismatch');
 expect(owned).not.toHaveBeenCalled();
});
it('does not infer private from an unknown capability failure',async()=>{
 owned.mockRejectedValue(new Error('network'));
 await expect(resolvePlayCard('100076','harbor','zh',false,undefined,{id:'conv',token:'t'})).rejects.toThrow('network');
 expect(card).not.toHaveBeenCalled();
});
it('validates the provider conversation and revision binding',async()=>{
 owned.mockResolvedValue({conversationId:'other',roleId:'new',canGenerate:false,reason:'author_private'});
 await expect(resolvePlayCard('100076','harbor','zh',false,undefined,{id:'conv',token:'t'})).rejects.toThrow('conversation_card_mismatch');
});
it('keeps a qualified private player on the full playable bootstrap instead of read-only history',async()=>{
 owned.mockResolvedValue({conversationId:'conv',roleId:'old',title:'Saved title',canGenerate:true});
 card.mockResolvedValue({id:'100076',num:100076,provider:'harbor',roleId:'retained-approved',status:'private',canInteract:false,listed:false});
 platforms.mockResolvedValue([{provider:'harbor',roleId:'retained-approved',playable:true}]);
 const result=await resolvePlayCard('100076','harbor','zh-Hant',false,undefined,{id:'conv',token:'t'});
 expect(result).toMatchObject({number:'100076',roleId:'retained-approved',card:{status:'private',canInteract:false,listed:false}});
 expect(result.readOnly).toBeUndefined();expect(result.conversationId).toBeUndefined();
});
it('opens the qualified private target for a new conversation from its card link',async()=>{
 card.mockResolvedValue({id:'100076',num:100076,provider:'harbor',roleId:'played-source',status:'private',canInteract:false,listed:false});
 platforms.mockResolvedValue([{provider:'harbor',roleId:'played-source',playable:true}]);
 const result=await resolvePlayCard('100076','harbor','zh-Hant');
 expect(result.roleId).toBe('played-source');expect(result.readOnly).toBeUndefined();expect(owned).not.toHaveBeenCalled();
});
