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
