import { expect, it } from 'vitest';
import { writeBooks, type TransferCall, type TransferProgress } from '../src/card-transfer-resources';

function upstreamFixture(reorderLimit=200) {
 const reorderSizes:number[]=[];
 let entries: Record<string, any>[] = [];
 let nextId = 0, documents = 0, mutations = 0, checkpoints = 0, booksCreated = 0;
 let rejectDocument = 0;
 const call: TransferCall = async (path, body) => {
  const data = body as Record<string, any>;
  if (path === '/worldbook') { booksCreated++; return {worldbookId:'target-book'}; }
  if (path.includes('/entry/list')) return {entries:structuredClone(entries)};
  if (path.endsWith('/document')) {
   documents++;
   if (data.entries.length > 200) throw new Error('invalid_arguments: batch limit');
   if (documents === rejectDocument) throw new Error('temporary upstream failure');
   const createdEntryIds: string[] = [];
   for (const op of data.entries) {
    if (op.op === 'delete') entries = entries.filter(e => e.entryId !== op.entryId);
    else {
     if (!op.category || !op.triggerRegion) throw new Error('invalid_arguments: enums');
     const {op: _, ...entry} = op;
     const entryId = `entry-${++nextId}`;
     entries.push({...entry, entryId});
     createdEntryIds.push(entryId);
    }
   }
   mutations++;
   return {createdEntryIds};
  }
  if (path.endsWith('/entries/reorder')) {
   reorderSizes.push(data.entryIds.length);
   if (data.entryIds.length > reorderLimit) throw new Error('invalid_arguments: reorder limit');
   const selected = new Set(data.entryIds);
   entries = [...data.entryIds.map((id: string) => entries.find(e => e.entryId === id)!), ...entries.filter(e => !selected.has(e.entryId))];
   mutations++;
   return {};
  }
  throw new Error('Unexpected route');
 };
 return {
  call,
  checkpoint: async () => { expect(mutations).toBe(checkpoints + 1); checkpoints = mutations; },
  failDocument: (n: number) => { rejectDocument = n; },
  entries: () => entries,
  booksCreated: () => booksCreated,
  reorderSizes,
 };
}
const book = {
 sourceId:'source-book', metadata:{name:'Synthetic service directory'},
 entries:Array.from({length:475}, (_,i) => ({name:`Service ${i}`,content:`Synthetic description ${i}`,category:'',triggerRegion:'',keywords:[],isEnabled:i % 3 !== 0})),
};

it('copies and replaces a large book within document and reorder limits, retaining every entry in order', async () => {
 const upstream = upstreamFixture();
 const progress: TransferProgress = {books:{}};
 const write = () => writeBooks(upstream.call,'target-role',[book],progress,async()=>{},upstream.checkpoint,'prepend-batches');
 await write();
 expect(upstream.entries().map(e=>e.name)).toEqual(book.entries.map(e=>e.name));
 expect(upstream.entries().map(e=>e.isEnabled)).toEqual(book.entries.map(e=>e.isEnabled));
 await write();
 expect(upstream.booksCreated()).toBe(1);
 expect(upstream.entries().map(e=>e.name)).toEqual(book.entries.map(e=>e.name));
 expect(new Set(upstream.entries().map(e=>e.entryId)).size).toBe(book.entries.length);
});

it('checkpoints successful chunks and retries a partially written book without duplicates', async () => {
 const upstream = upstreamFixture();
 const progress: TransferProgress = {books:{}};
 upstream.failDocument(3);
 const write = () => writeBooks(upstream.call,'target-role',[book],progress,async()=>{},upstream.checkpoint,'prepend-batches');
 await expect(write()).rejects.toThrow('temporary upstream failure');
 expect(upstream.entries()).toHaveLength(200);
 upstream.failDocument(0);
 await write();
 expect(upstream.booksCreated()).toBe(1);
 expect(upstream.entries().map(e=>e.name)).toEqual(book.entries.map(e=>e.name));
});

it('keeps one full reorder for providers that assign absolute positions', async () => {
 const upstream = upstreamFixture(2000);
 await writeBooks(upstream.call,'target-role',[book],{books:{}},async()=>{},upstream.checkpoint,'whole-book');
 expect(upstream.reorderSizes).toEqual([475]);
 expect(upstream.entries().map(e=>e.name)).toEqual(book.entries.map(e=>e.name));
});

it('clears an existing large book without creating or reordering empty entries', async () => {
 const upstream = upstreamFixture();
 const progress: TransferProgress = {books:{}};
 await writeBooks(upstream.call,'target-role',[book],progress,async()=>{},upstream.checkpoint,'prepend-batches');
 const orders = upstream.reorderSizes.length;
 await writeBooks(upstream.call,'target-role',[{...book,entries:[]}],progress,async()=>{},upstream.checkpoint,'prepend-batches');
 expect(upstream.entries()).toEqual([]);
 expect(upstream.reorderSizes).toHaveLength(orders);
 expect(upstream.booksCreated()).toBe(1);
});
