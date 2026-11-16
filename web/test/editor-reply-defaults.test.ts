import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { i18n } from '../src/lib/i18n';
import ReplyDefaultsEditor from '../src/components/editor/ReplyDefaultsEditor.vue';
let close: (()=>void)|undefined;
afterEach(()=>{close?.();document.body.innerHTML=''});
async function mount(values:Record<string,string>={}) {
 const update=vi.fn();const host=document.createElement('div');document.body.append(host);
 const app=createApp(ReplyDefaultsEditor,{modelValue:values,'onUpdate:modelValue':update});app.use(i18n);
 const vm=app.mount(host) as any;close=()=>app.unmount();await nextTick();
 return {host,vm,update};
}
async function choose(host:HTMLElement, axis:string, value:string) {
 const input=host.querySelector<HTMLSelectElement>(`[data-reply-axis="${axis}"]`)!;input.value=value;input.dispatchEvent(new Event('change'));await nextTick();
}
it('starts collapsed even for configured cards and exposes all five axes on demand',async()=>{
 const {host}=await mount({pace:'linger',agencyNote:'Keep my choices'});
 const toggle=host.querySelector<HTMLButtonElement>('[data-reply-toggle]')!;
 expect(toggle.getAttribute('aria-expanded')).toBe('false');
 expect(host.textContent).toContain('已設定 2 項');toggle.click();await nextTick();
 expect(toggle.getAttribute('aria-expanded')).toBe('true');expect(host.querySelectorAll('select').length).toBe(5);
});
it('selecting custom and target initializes only their required dependent fields',async()=>{
 const {host,update}=await mount();await choose(host,'length','target');
 expect(update).toHaveBeenLastCalledWith({length:'target',lengthTarget:'800'});
 await choose(host,'style','custom');expect(update).toHaveBeenLastCalledWith({style:'custom',customStyle:''});
});
it('leaving a dependent option removes hidden values but preserves unrelated notes and old agency',async()=>{
 const {host,update}=await mount({agency:'assist',style:'custom',customStyle:'Noir',styleNote:'Quiet',pace:'linger'});
 await choose(host,'style','card');expect(update).toHaveBeenLastCalledWith({agency:'assist',style:'card',styleNote:'Quiet',pace:'linger'});
 expect((host.querySelector('[data-reply-axis="agency"]') as HTMLSelectElement).value).toBe('protect');
});
it('rejects invalid custom text and expands the advanced area to focus its error',async()=>{
 const {host,vm}=await mount({style:'custom',customStyle:''});
 expect(vm.validate()).toBe(false);await nextTick();
 expect(host.querySelector('[data-reply-toggle]')?.getAttribute('aria-expanded')).toBe('true');
 expect(host.querySelector('[aria-invalid="true"]')).not.toBeNull();
});
it('blocks unknown keys without silently deleting them',async()=>{
 const {host,vm,update}=await mount({future:'keep',pace:'linger'});
 expect(vm.validate()).toBe(false);await choose(host,'pace','advance');
 expect(update).toHaveBeenLastCalledWith({future:'keep',pace:'advance'});
});

it('counts Unicode code points and blocks oversized notes even while collapsed',async()=>{
 const {host,vm}=await mount({paceNote:'😀'.repeat(201)});
 expect(vm.validate()).toBe(false);await nextTick();
 expect(host.querySelector('#reply-paceNote')?.getAttribute('aria-invalid')).toBe('true');
 expect(host.textContent).toContain('200');
});
it('clears blank notes without changing unrelated sparse values',async()=>{
 const {host,update}=await mount({pace:'linger',paceNote:'old'});
 const note=host.querySelector<HTMLTextAreaElement>('#reply-paceNote')!;note.value='   ';note.dispatchEvent(new Event('input'));await nextTick();
 expect(update).toHaveBeenLastCalledWith({pace:'linger'});
});

it.each([{length:'target',lengthTarget:'8e2'},{length:'target',lengthTarget:'800.0'},{style:''},{paceNote:'   '},{style:'card',customStyle:''}])('rejects imported wire values the Provider rejects: %j',async values=>{
 const {vm}=await mount(values);expect(vm.validate()).toBe(false);
});
