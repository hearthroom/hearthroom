import { afterEach, expect, it, vi } from 'vitest';
import { createApp,h,nextTick,type App } from 'vue';
import { i18n,loadLocale } from '../src/lib/i18n';
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
it('keeps missing-field guidance actionable while public is disabled',async()=>{
 const missing=vi.fn();await mount({missing:'Character setting',onMissing:missing});
 const guidance=root.querySelector<HTMLButtonElement>('.visibility-missing')!;
 expect(guidance.textContent).toBe(i18n.global.t('visibility.missing',{fields:'Character setting'}));
 expect(root.querySelector<HTMLInputElement>('input[value="public"]')!.disabled).toBe(true);
 guidance.click();await nextTick();expect(missing).toHaveBeenCalledOnce();
});
it('unknown revision never claims content was changed or offers a missing restore action',async()=>{
 await mount({value:{...base,everPublic:true,restorable:false,revisionState:'unknown'}});
 expect(root.textContent).toContain(i18n.global.t('visibility.public.unknown'));
 expect(root.textContent).not.toContain(i18n.global.t('visibility.public.changed'));
});

it('offers the original action separately from GET-only status checks after safe retry proof',async()=>{
 const resume=vi.fn(),check=vi.fn();await mount({phase:'retryable',resumeAction:'link',onResume:resume,onCheck:check});
 expect(root.querySelector<HTMLInputElement>('input[value="unlisted"]')!.checked).toBe(true);
 expect(root.querySelector('[data-visibility-resume]')!.textContent).toBe(i18n.global.t('visibility.action.link'));
 expect(root.textContent).toContain(i18n.global.t('visibility.effect.t1',{access:i18n.global.t('visibility.option.private')}));
 root.querySelector<HTMLButtonElement>('[data-visibility-check]')!.click();expect(resume).not.toHaveBeenCalled();expect(check).toHaveBeenCalledOnce();
 root.querySelector<HTMLButtonElement>('[data-visibility-resume]')!.click();expect(resume).toHaveBeenCalledOnce();
});

it('submits saved public edits through the current public option without changing access',async()=>{
 const submit=vi.fn(),apply=vi.fn();await mount({value:{...base,access:'public',effectiveAccess:'public',everPublic:true,revisionState:'changed',draftChanged:true,actions:['set_private','set_unlisted','submit_update']},onSubmit:submit,onApply:apply});
 expect(root.querySelector<HTMLInputElement>('input[value="public"]')!.disabled).toBe(false);
 const button=root.querySelector<HTMLButtonElement>('[data-visibility-apply]');expect(button).not.toBeNull();
 button!.click();await nextTick();expect(submit).toHaveBeenCalledOnce();expect(apply).not.toHaveBeenCalled();
});

it.each(['zh-Hant','zh-Hans','en','ja','ko'] as const)('submits a delisted update without restoring discovery in %s',async locale=>{
 const previous=i18n.global.locale.value;await loadLocale(locale);i18n.global.locale.value=locale;
 try{
  const submit=vi.fn(),apply=vi.fn();
  await mount({value:{...base,access:'public',effectiveAccess:'link',everPublic:true,revisionState:'changed',draftChanged:true,restriction:'delisted',actions:['set_private','set_unlisted','submit_update']},onSubmit:submit,onApply:apply});
  const radio=root.querySelector<HTMLInputElement>('input[value="public"]')!;
  expect(radio.disabled).toBe(false);expect(radio.checked).toBe(true);
  expect(radio.closest('label')!.querySelector('.visibility-option__restriction')?.textContent).toBe(i18n.global.t('visibility.badge.delisted'));
  const button=root.querySelector<HTMLButtonElement>('[data-visibility-apply]')!;
  expect(button.disabled).toBe(false);button.click();await nextTick();
  expect(submit).toHaveBeenCalledOnce();expect(apply).not.toHaveBeenCalled();
 }finally{i18n.global.locale.value=previous;}
});

it.each(['zh-Hant','zh-Hans','en','ja','ko'] as const)('does not promise discovery after a delisted update in %s',async locale=>{
 const previous=i18n.global.locale.value;await loadLocale(locale);i18n.global.locale.value=locale;
 try{
  await mount({value:{...base,access:'public',effectiveAccess:'link',everPublic:true,restriction:'delisted',actions:['submit_update']}});
  const row=root.querySelector<HTMLInputElement>('input[value="public"]')!.closest('label')!;
  expect(row.querySelector('.visibility-option__description')!.textContent).not.toBe(i18n.global.t('visibility.description.public'));
  expect(root.querySelector('.visibility-effect')!.textContent).not.toContain(i18n.global.t('visibility.effect.t3',{access:i18n.global.t('visibility.option.public')}));
  expect(i18n.global.te('visibility.description.delisted',locale)).toBe(true);
  expect(i18n.global.te('visibility.effect.delistedUpdate',locale)).toBe(true);
  expect(row.querySelector('.visibility-option__description')!.textContent).toBe(i18n.global.t('visibility.description.delisted'));
  expect(root.querySelector('.visibility-effect p')!.textContent).toBe(i18n.global.t('visibility.effect.delistedUpdate'));
 }finally{i18n.global.locale.value=previous;}
});

it.each(['private','unlisted'])('allows a fresh delisted review from %s only when the server offers submission',async access=>{
 const submit=vi.fn(),apply=vi.fn();
 await mount({value:{...base,access,effectiveAccess:access==='private'?'owner':'link',restriction:'delisted',actions:['set_private','set_unlisted','submit_review']},onSubmit:submit,onApply:apply});
 const radio=root.querySelector<HTMLInputElement>('input[value="public"]')!;expect(radio.disabled).toBe(false);
 radio.click();await nextTick();root.querySelector<HTMLButtonElement>('[data-visibility-apply]')!.click();await nextTick();
 expect(submit).toHaveBeenCalledOnce();expect(apply).not.toHaveBeenCalled();
});

it.each(['suspended','takedown','delisted-restore'])('keeps %s blocked even if a public action is offered',async mode=>{
 const submit=vi.fn(),apply=vi.fn();
 await mount({value:{...base,access:'public',effectiveAccess:'link',restriction:mode==='delisted-restore'?'delisted':mode,actions:mode==='delisted-restore'?['restore_public']:['submit_update']},onSubmit:submit,onApply:apply});
 expect(root.querySelector<HTMLInputElement>('input[value="public"]')!.disabled).toBe(true);
 root.querySelector<HTMLButtonElement>('[data-visibility-apply]')?.click();await nextTick();
 expect(submit).not.toHaveBeenCalled();expect(apply).not.toHaveBeenCalled();
});

it.each(['pending','dirty','missing','quota','sync'])('keeps a delisted update blocked for %s',async mode=>{
 const submit=vi.fn();
 await mount({value:{...base,access:'public',effectiveAccess:'link',restriction:'delisted',update:mode==='pending'?'pending':'none',syncState:mode==='sync'?'changing':'complete',actions:['submit_update']},dirty:mode==='dirty',missing:mode==='missing'?'Character setting':'',quotaFull:mode==='quota',onSubmit:submit});
 expect(root.querySelector<HTMLInputElement>('input[value="public"]')!.disabled).toBe(true);
 root.querySelector<HTMLButtonElement>('[data-visibility-apply]')?.click();await nextTick();expect(submit).not.toHaveBeenCalled();
});

it.each(['delisted','suspended','takedown'])('keeps the current access neutral and gives %s a separate restriction badge',async restriction=>{
 const note='Synthetic restriction reason';await mount({value:{...base,access:'public',effectiveAccess:'denied',restriction,restrictionNote:note,actions:['set_private','set_unlisted']}});
 const row=root.querySelector<HTMLInputElement>('input[value="public"]')!.closest('label')!;
 const title=row.querySelector('.visibility-option__title')!;
 const badge=title.querySelector('.visibility-option__restriction');
 expect(badge?.textContent).toBe(i18n.global.t(`visibility.badge.${restriction}`));
 expect([...title.querySelectorAll('.chip')].some(e=>e.textContent===i18n.global.t('visibility.current')&&!e.classList.contains('visibility-option__restriction'))).toBe(true);
 expect(row.classList.contains('visibility-option--selected')).toBe(false);
 expect(row.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
 expect(row.querySelector('.visibility-option__reason')?.textContent).toContain(note);
});

it('shows the retained reward deadline and disables both narrower access options',async()=>{
 await mount({value:{...base,access:'public',effectiveAccess:'public',actions:['submit_update'],rewardRetention:{publicUntil:'2030-01-02T12:00:00Z',days:30,recoveryCredits:10000}}});
 expect(root.querySelector<HTMLInputElement>('input[value="private"]')!.disabled).toBe(true);
 expect(root.querySelector<HTMLInputElement>('input[value="unlisted"]')!.disabled).toBe(true);
 expect(root.querySelector('[data-reward-retention]')).not.toBeNull();
 expect(root.textContent).toContain('2030');
});
