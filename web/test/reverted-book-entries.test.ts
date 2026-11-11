import { expect, it } from 'vitest';
import { revertedBookEntries } from '../src/lib/reverted-book-entries';
import type { WorldbookEntryDraft } from '../src/lib/role-draft';
const entry=(entryId:string,content:string):WorldbookEntryDraft=>({entryId,name:entryId,content,keywords:[],secondaryKeywords:[],isEnabled:true,isConstant:false});

it('keeps library entry identities when another tab reorders the same book',()=>{
 const before=[entry('a','A'),entry('b','B')];
 const current=[entry('b','B'),entry('a','A')];
 const edited=[entry('a','Edited A'),entry('b','B')];
 const result=revertedBookEntries('library','library',before,current,edited);
 expect(result.map(e=>[e.entryId,e.content])).toEqual([['a','Edited A'],['b','B']]);
});
it('maps immutable entry identities only when the server cloned the book',()=>{
 const result=revertedBookEntries('sealed','copy',[entry('sealed-a','A')],[entry('copy-a','A')],[entry('sealed-a','Edited A'),entry('','New')]);
 expect(result.map(e=>[e.entryId,e.content])).toEqual([['copy-a','Edited A'],[undefined,'New']]);
});

import { useWorldbookDraft } from '../src/lib/worldbook-draft';
import { bookSnapshot, mergeRevertedBookEdits } from '../src/lib/reverted-book-entries';
it('keeps the preview diff baseline for library edits so concurrent new/changed entries are not overwritten',()=>{
 const book=useWorldbookDraft({untitled:()=>'',fallbackName:()=>'',language:()=> 'en'});
 book.id='library';book.entries=[entry('a','A'),entry('b','New B'),entry('c','New C')];book.original=JSON.parse(JSON.stringify(book.entries));
 const original=[entry('a','A'),entry('b','B')];
 const before={...bookSnapshot(book),entries:original,original};
 const edited={...before,entries:[entry('a','Edited A'),entry('b','B')]};
 mergeRevertedBookEdits(book,before,edited);
 const ops=book.ops().map(item=>item.op);
 expect(ops).toHaveLength(1);expect(ops[0]).toMatchObject({op:'update',entryId:'a',content:'Edited A'});
 expect(book.orderChanged()).toBe(false);
});
