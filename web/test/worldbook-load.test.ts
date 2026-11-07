import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({entries:vi.fn(), bindings:vi.fn(), mine:vi.fn(), write:vi.fn()}));
vi.mock('../src/lib/api', async original => ({...await original<typeof import('../src/lib/api')>(),fetchWorldbookEntries:api.entries,fetchRoleWorldbooks:api.bindings,fetchMyWorldbooks:api.mine,patchWorldbookDocument:api.write}));
import { useWorldbookDraft } from '../src/lib/worldbook-draft';
const entry = {entryId:'entry',name:'Secret',content:'Reveal later.',keywords:['reveal'],secondaryKeywords:[],isEnabled:true,isConstant:false,semanticRecall:false};
beforeEach(() => {
  vi.resetAllMocks();
  api.entries.mockImplementation(async()=>structuredClone([entry]));api.bindings.mockResolvedValue([{worldbookId:'book',name:'Book'}]);api.mine.mockResolvedValue([]);
});
it('retains the last known entries and baseline on failure, forbids saves, and recovers on retry', async () => {
  const book=useWorldbookDraft({untitled:()=>'',fallbackName:()=>'',language:()=>'en'});
  await book.load('tok','book','Book');
  api.entries.mockRejectedValueOnce(new Error('unavailable'));
  await book.load('tok','book','Book');
  expect(book.entries).toEqual([entry]);expect(book.original).toEqual([entry]);
  await expect(book.save('tok')).rejects.toThrow();expect(api.write).not.toHaveBeenCalled();
  await book.retryLoad('tok');
  expect(book.loadFailed).toBe(false);expect(book.entries[0].semanticRecall).toBe(false);
  book.entries[0].semanticRecall=true;await book.save('tok');
  expect(api.write).toHaveBeenCalledWith('book',expect.objectContaining({entries:[expect.objectContaining({semanticRecall:true})]}),'tok');
});
it('blocks saving while a retry is still loading', async () => {
  const book=useWorldbookDraft({untitled:()=>'',fallbackName:()=>'',language:()=>'en'});
  let resolve!:(value:typeof entry[])=>void;
  api.entries.mockReturnValueOnce(new Promise(r=>{resolve=r}));
  const pending=book.load('tok','book','Book');
  await expect(book.save('tok')).rejects.toThrow();
  expect(api.write).not.toHaveBeenCalled();resolve([entry]);await pending;
  expect(book.loadFailed).toBe(false);
});
it('keeps all bound books in review inputs across edit, replace, release and reset, without saving extra books', async () => {
  const book=useWorldbookDraft({untitled:()=>'',fallbackName:()=>'',language:()=>'en'});
  api.bindings.mockResolvedValue([{worldbookId:'older',name:'Older'},{worldbookId:'latest',name:'Latest'}]);
  api.entries.mockImplementation(async(id:string)=>[{...entry,entryId:id,content:id,isConstant:true}]);
  await book.loadBound('tok','role');
  expect(book.reviewEntries().map(e=>e.content)).toEqual(['older','latest']);
  expect(book.dirty()).toBe(false);
  book.entries[0].content='edited';
  expect(book.reviewEntries().map(e=>e.content)).toEqual(['older','edited']);
  expect(book.ops().map(o=>o.op)).toEqual([expect.objectContaining({op:'update',entryId:'latest',content:'edited'})]);
  book.release();
  expect(book.reviewEntries().map(e=>e.content)).toEqual(['older']);
  await book.pick({worldbookId:'older',name:'Older',description:'',entryCount:1,iconUrl:'',visibility:'private',tags:''},'tok');
  expect(book.reviewEntries().map(e=>e.content)).toEqual(['older']);
  book.entries[0].content='older edited';
  expect(book.reviewEntries().map(e=>e.content)).toEqual(['older edited']);
  book.reset();expect(book.reviewEntries()).toEqual([]);
});
it('does not present partial counts when an additional bound book fails, and retries the complete set', async () => {
  const book=useWorldbookDraft({untitled:()=>'',fallbackName:()=>'',language:()=>'en'});
  api.bindings.mockResolvedValue([{worldbookId:'older',name:'Older'},{worldbookId:'latest',name:'Latest'}]);
  api.entries.mockRejectedValueOnce(new Error('unavailable'));
  await book.loadBound('tok','role');
  expect(book.loadFailed).toBe(true);
  await expect(book.save('tok',{bindRoleId:'role'})).rejects.toThrow('worldbook_not_loaded');
  expect(api.write).not.toHaveBeenCalled();
  await book.retryLoad('tok');
  expect(book.loadFailed).toBe(false);expect(book.reviewEntries()).toHaveLength(2);
});
