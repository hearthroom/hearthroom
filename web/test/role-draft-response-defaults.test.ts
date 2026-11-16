import { describe, expect, it } from 'vitest';
import { cloneDraft, documentPatch, draftFromRoleDetail, makeDraft } from '../src/lib/role-draft';

describe('card author response defaults in the editor draft', () => {
  it('loads all CLI fields without filling omitted axes and clones independently', () => {
    const values = {agency:'protect',style:'custom',customStyle:'Quiet noir',perspective:'third_limited',length:'target',lengthTarget:'1200',pace:'linger',agencyNote:'Let me decide',styleNote:'Sparse images',perspectiveNote:'One focal character',lengthNote:'No padding',paceNote:'Stay here'};
    const draft = draftFromRoleDetail({responseDefaults:values}, 'en');
    expect(draft.responseDefaults).toEqual(values);
    expect(documentPatch(draft, cloneDraft(draft))).not.toHaveProperty('responseDefaults');
    const copy = cloneDraft(draft);
    copy.responseDefaults.pace = 'advance';
    expect(draft.responseDefaults.pace).toBe('linger');
    expect(draftFromRoleDetail({responseDefaults:{pace:'linger'}}, 'en').responseDefaults).toEqual({pace:'linger'});
  });
  it('sends the entire sparse object when changed and explicit null when cleared', () => {
    const original = draftFromRoleDetail({responseDefaults:{agency:'protect',pace:'linger'}}, 'en');
    const changed = cloneDraft(original);
    changed.responseDefaults.pace = 'advance';
    expect(documentPatch(changed, original).responseDefaults).toEqual({agency:'protect',pace:'advance'});
    changed.responseDefaults = {};
    expect(documentPatch(changed, original).responseDefaults).toBeNull();
  });
  it('keeps new cards unconfigured unless the author sets a value', () => {
    const draft = makeDraft('en');
    expect(draft.responseDefaults).toEqual({});
    expect(documentPatch(draft, null)).not.toHaveProperty('responseDefaults');
    draft.responseDefaults = {style:'vivid'};
    expect(documentPatch(draft, null).responseDefaults).toEqual({style:'vivid'});
  });
  it('compares values independently of JSON property order', () => {
    const original = draftFromRoleDetail({responseDefaults:{agency:'protect',pace:'linger'}}, 'en');
    const same = cloneDraft(original);
    same.responseDefaults = {pace:'linger',agency:'protect'};
    expect(documentPatch(same, original)).not.toHaveProperty('responseDefaults');
  });
});
