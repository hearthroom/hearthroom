import { afterEach, expect, it, vi } from 'vitest';
import { createApp,h,nextTick,type App } from 'vue';
import { i18n } from '../src/lib/i18n';
import VisibilityPicker from '../src/components/VisibilityPicker.vue';
const base={access:'private',effectiveAccess:'owner',review:'none',update:'none',everPublic:false,revisionState:'unknown',restorable:false,restoreReason:'no_approval',draftChanged:false,restriction:'none',policyRevision:'1',approvalRevision:'0',actions:['set_private','set_unlisted','submit_review'],syncState:'complete'} as any;
let app:App,root:HTMLElement;afterEach(()=>{app?.unmount();root?.remove();});
async function mount(extra:any={}){root=document.createElement('div');document.body.append(root);app=createApp({render:()=>h(VisibilityPicker,{value:base,phase:'ready',...extra})}).use(i18n);app.mount(root);await nextTick();}
it('allows link sharing despite unsaved edits, explains saved content, and only applies after explicit confirmation',async()=>{
 const apply=vi.fn();await mount({dirty:true,onApply:apply});
 const link=root.querySelector<HTMLInputElement>('input[value="unlisted"]')!;link.click();await nextTick();
 expect(apply).not.toHaveBeenCalled();expect(root.textContent).toContain(i18n.global.t('visibility.link.savedContent'));
 expect(root.textContent).toContain(i18n.global.t('visibility.change.unsaved'));
 root.querySelector<HTMLButtonElement>('[data-visibility-apply]')!.click();await nextTick();expect(apply).toHaveBeenCalledWith('unlisted');
 expect(root.querySelector<HTMLInputElement>('input[value="public"]')!.disabled).toBe(true);
});
it('unknown result disables mutation and check status only emits a readback request',async()=>{
 const check=vi.fn(),apply=vi.fn();await mount({phase:'unknown',onCheck:check,onApply:apply});
 expect([...root.querySelectorAll<HTMLInputElement>('input[type=radio]')].every(i=>i.disabled)).toBe(true);
 root.querySelector<HTMLButtonElement>('[data-visibility-check]')!.click();await nextTick();expect(check).toHaveBeenCalledOnce();expect(apply).not.toHaveBeenCalled();
});
it('unknown revision never claims content was changed or offers a missing restore action',async()=>{
 await mount({value:{...base,everPublic:true,restorable:false,revisionState:'unknown'}});
 expect(root.textContent).toContain(i18n.global.t('visibility.public.unknown'));
 expect(root.textContent).not.toContain(i18n.global.t('visibility.public.changed'));
});
