import { createApp, nextTick } from 'vue';
import { afterEach, expect, it } from 'vitest';
import ConfirmDialog from '../src/components/ConfirmDialog.vue';
import { confirmForm, settleConfirm } from '../src/lib/confirm';
import { i18n } from '../src/lib/i18n';
let cleanup=()=>{};
afterEach(()=>{settleConfirm(false);cleanup();});
it('requires a nonblank multiline reason before confirming and preserves line breaks',async()=>{
 const host=document.createElement('div');document.body.append(host);
 const app=createApp(ConfirmDialog).use(i18n);app.mount(host);cleanup=()=>{app.unmount();host.remove();};
 const result=confirmForm({message:'Reason',field:{label:'Reason',required:true,multiline:true,maxlength:2000}});
 await nextTick();await nextTick();
 const button=document.querySelector<HTMLButtonElement>('[data-confirm]')!;
 expect(button.disabled).toBe(true);
 const field=document.querySelector<HTMLTextAreaElement>('textarea[data-field]');expect(field).not.toBeNull();
 field!.value='  ';field!.dispatchEvent(new Event('input'));await nextTick();expect(button.disabled).toBe(true);
 field!.value='Line one\nLine two';field!.dispatchEvent(new Event('input'));await nextTick();expect(button.disabled).toBe(false);
 button.click();expect(await result).toEqual({text:'Line one\nLine two'});
});
