import { expect, it } from 'vitest';
import { makeDraft, missingRequired, requiredKeys } from '../src/lib/role-draft';

it('lists portrait before tags, ignores landscape/share, and accepts a portrait alone',()=>{
 const draft=makeDraft();
 Object.assign(draft,{roleName:'Test',roleTag:['Roleplay'],roleDetailDesc:'Persona',roleWelcome:'Hello',roleBackgroundLandscape:'https://img.test/land.png',roleShareImage:'https://img.test/share.png'});
 expect(requiredKeys()).toEqual(['roleName','roleBackground','presetTag','roleDetailDesc','roleWelcome']);
 expect(missingRequired(draft)).toEqual(['roleBackground']);
 draft.roleBackground='https://img.test/portrait.png';
 draft.roleBackgroundLandscape='';draft.roleShareImage='';
 expect(missingRequired(draft)).toEqual([]);
});

it('accepts any populated opening format and rejects an empty page mode',()=>{
 const draft={...makeDraft(),roleName:'Test',roleBackground:'https://img.test/portrait.png',roleTag:['Roleplay'],roleDetailDesc:'Persona'};
 expect(missingRequired(draft,{openingMode:'page'})).toEqual(['prologue']);
 expect(missingRequired({...draft,prologue:['Enter']},{openingMode:'greeting'})).toEqual([]);
 expect(missingRequired({...draft,alternates:['Welcome']},{openingMode:'greeting'})).toEqual([]);
 expect(missingRequired(draft,{openingMode:'page',openingPage:'<p>Enter</p>'})).toEqual([]);
});
