import { describe, expect, it } from 'vitest';
import { groupWorks, playCopies } from '../src/lib/card-workspace';
import type { MyCard } from '../src/lib/api';
const card = (roleId:string, extra:Partial<MyCard>={}):MyCard => ({roleId,name:'Fixture',summary:'A sample',zone:'en',avatarUrl:null,visibility:'private',talkNum:0,registered:false,game:false,...extra} as MyCard);
describe('card workspace',()=>{
 it('groups mapped copies and keeps the original publication state regardless of provider order',()=>{
  const rows=groupWorks({harbor:[card('copy',{workId:'work',sourceProvider:'lunatalk',sourceRoleId:'original'})],lunatalk:[card('original',{workId:'work',sourceProvider:'lunatalk',sourceRoleId:'original',registered:true,status:'pending'})]});
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({roleId:'original',provider:'lunatalk',registered:true,status:'pending',sourceAvailable:true});
 });
 it('never merges unrelated cards with equal upstream IDs',()=>{
  expect(groupWorks({harbor:[card('1')],lunatalk:[card('1')]})).toHaveLength(2);
 });
 it('marks a copy-only result unavailable for original publication actions',()=>{
  expect(groupWorks({harbor:[card('copy',{sourceProvider:'lunatalk',sourceRoleId:'original',workId:'work'})]})[0].sourceAvailable).toBe(false);
 });
 it('only offers linked accounts with an existing usable copy and preserves private originals',()=>{
  expect(playCopies('original','lunatalk',[
   {provider:'harbor',roleId:'copy',status:'synced'},
  ],['harbor','lunatalk'])).toEqual([{provider:'harbor',roleId:'copy'}]);
  expect(playCopies('original','lunatalk',[{provider:'harbor',roleId:'stale',status:'failed'}],['harbor'])).toEqual([]);
 });
});
