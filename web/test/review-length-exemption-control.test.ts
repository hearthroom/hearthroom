import { createApp, nextTick, reactive } from 'vue';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import Control from '../src/components/ReviewLengthExemptionControl.vue';
import ConfirmDialog from '../src/components/ConfirmDialog.vue';
import { confirmState, settleConfirm } from '../src/lib/confirm';
import { i18n } from '../src/lib/i18n';
const mocks=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../src/lib/moderation',()=>({moderationRequest:mocks.request}));
vi.mock('../src/lib/session',()=>({useSession:()=>({me:{accountNumId:3},accessToken:async()=>'manager'})}));
let cleanup=()=>{},host:HTMLElement;
const state=(extra={})=>({cardNumber:100001,enabled:false,revision:0,actor:null,reason:'',updatedAt:null,history:[],...extra});
beforeEach(()=>{mocks.request.mockReset();});
afterEach(()=>{settleConfirm(false);cleanup();});
async function mount(){
 const props=reactive({cardNumber:'100001'});host=document.createElement('div');document.body.append(host);
 const app=createApp({components:{Control,ConfirmDialog},setup:()=>({props}),template:'<Control :card-number="props.cardNumber"/><ConfirmDialog/>'}).use(i18n);app.mount(host);
 cleanup=()=>{app.unmount();host.remove();};await vi.waitFor(()=>expect(host.querySelector('[data-exemption-switch]')).not.toBeNull());return props;
}
it('opens a required reason, cancels without writing, then persists and reads a multiline audit reason',async()=>{
 mocks.request.mockImplementation(async(_path:string,_token:string,body?:any)=>body?state({enabled:true,revision:1,actor:'managerhandle',reason:body.reason,updatedAt:1000,history:[{action:'enable',reason:body.reason,actor:'managerhandle',at:1000}]}):state());
 await mount();const toggle=host.querySelector<HTMLButtonElement>('[data-exemption-switch]')!;
 toggle.click();await vi.waitFor(()=>expect(confirmState.current).not.toBeNull());settleConfirm(false);await vi.waitFor(()=>expect(toggle.disabled).toBe(false));expect(mocks.request).toHaveBeenCalledTimes(1);
 toggle.click();await vi.waitFor(()=>expect(confirmState.current).not.toBeNull());expect(confirmState.current?.field).toMatchObject({required:true,multiline:true});
 settleConfirm(true,'','Synthetic\nreason');await vi.waitFor(()=>expect(toggle.getAttribute('aria-checked')).toBe('true'));
 expect(mocks.request).toHaveBeenLastCalledWith('/review-length-exemptions/100001','manager',expect.objectContaining({enabled:true,reason:'Synthetic\nreason',revision:0}));
 expect(host.querySelector('[data-exemption-record]')?.textContent).toContain('Synthetic\nreason');
});
it('does not claim success after a failed write and reuses the operation when retrying the same reason',async()=>{
 const writes:any[]=[];mocks.request.mockImplementation(async(_p:string,_t:string,body?:any)=>{if(!body)return state();writes.push(body);if(writes.length===1)throw new Error('Synthetic failure');return state({enabled:true,revision:1});});
 await mount();const toggle=host.querySelector<HTMLButtonElement>('[data-exemption-switch]')!;
 toggle.click();await vi.waitFor(()=>expect(confirmState.current).not.toBeNull());settleConfirm(true,'','reason');await vi.waitFor(()=>expect(host.textContent).toContain('Synthetic failure'));
 expect(toggle.getAttribute('aria-checked')).toBe('false');
 toggle.click();await vi.waitFor(()=>expect(confirmState.current).not.toBeNull());expect(confirmState.current?.field?.initial).toBe('reason');settleConfirm(true,'','reason');
 await vi.waitFor(()=>expect(toggle.getAttribute('aria-checked')).toBe('true'));expect(writes[0].operationId).toBe(writes[1].operationId);
});
it('invalidates a pending confirmation when switching cards and cannot write to the old card',async()=>{
 mocks.request.mockResolvedValue(state());const props=await mount();
 host.querySelector<HTMLButtonElement>('[data-exemption-switch]')!.click();await vi.waitFor(()=>expect(confirmState.current).not.toBeNull());
 props.cardNumber='100002';await nextTick();settleConfirm(true,'','old reason');await nextTick();
 expect(mocks.request.mock.calls.every(call=>call.length===2)).toBe(true);
});
