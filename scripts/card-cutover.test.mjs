import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsCardCutover } from './card-cutover.mjs';
test('only an identified legacy primary key enables the cutover deployment',()=>{
  assert.equal(needsCardCutover([{success:true,results:[{type:'TEXT'}]}]),true);
  assert.equal(needsCardCutover([{success:true,results:[{type:'INTEGER'}]}]),false);
  for(const value of [[],[{success:false,results:[]}],[{success:true,results:[]}],[{success:true,results:[{type:'BLOB'}]}]])
    assert.throws(()=>needsCardCutover(value),/schema/);
});
