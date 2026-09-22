import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createApp,nextTick,type App} from 'vue';
import {i18n} from '../src/lib/i18n';
const fixture=vi.hoisted(()=>({save:vi.fn(),session:{displayName:'Author',avatarUrl:'',profile:{displayName:'Author',bio:'Existing bio',avatarUrl:''},accessToken:async()=> 'test'}}));
vi.mock('../src/lib/session',()=>({useSession:()=>fixture.session}));
vi.mock('../src/lib/api',()=>({updateSiteProfile:fixture.save}));
import CommunityProfile from '../src/components/CommunityProfile.vue';
let app:App,el:HTMLDivElement;
const settle=async()=>{await nextTick();await new Promise(r=>setTimeout(r,0));};
beforeEach(async()=>{vi.clearAllMocks();el=document.createElement('div');document.body.append(el);app=createApp(CommunityProfile).use(i18n);app.mount(el);el.querySelector('button')!.click();await settle()});
afterEach(()=>{app.unmount();el.remove();vi.restoreAllMocks()});
it('edits a bio and offers a file picker instead of an avatar URL',()=>{
 expect(el.querySelector('input[type=url]')).toBeNull();expect(el.querySelector('input[type=file]')).not.toBeNull();expect(el.querySelector('textarea')?.value).toBe('Existing bio');
});
it('cancel does not upload or save a profile',async()=>{
 el.querySelector<HTMLButtonElement>('button[type=button]:last-child')!.click();await settle();expect(fixture.save).not.toHaveBeenCalled();
});
it('keeps edits visible after a failed save',async()=>{
 fixture.save.mockRejectedValue(new Error('unavailable'));
 el.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));await settle();
 expect(el.querySelector('[role=alert]')).not.toBeNull();expect(el.querySelector('textarea')?.value).toBe('Existing bio');
});

it.each(['image/gif','image/apng','image/png','image/webp'])('previews and submits %s without converting the selected file',async(type)=>{
 const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:avatar-test');
 const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 fixture.save.mockResolvedValue(fixture.session.profile);
 const input=el.querySelector<HTMLInputElement>('input[type=file]')!;
 expect(input.accept.split(',')).toContain(type);
 const selected=new File(['animated fixture'],'avatar.'+(type==='image/apng'?'apng':type.split('/')[1]),{type});
 Object.defineProperty(input,'files',{value:[selected],configurable:true});
 input.dispatchEvent(new Event('change'));await settle();
 expect(el.querySelector('[role=alert]')).toBeNull();
 expect(el.querySelector('img')?.getAttribute('src')).toBe('blob:avatar-test');
 el.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));await settle();
 expect(fixture.save).toHaveBeenCalledWith('test',expect.objectContaining({avatar:selected}));
 expect(revoke).toHaveBeenCalledWith('blob:avatar-test');create.mockRestore();revoke.mockRestore();
});

it.each([
 ['image/gif',2*1024*1024+1],
 ['image/svg+xml',32],
])('rejects invalid avatar %s (%i bytes) without submitting it',async(type,size)=>{
 const input=el.querySelector<HTMLInputElement>('input[type=file]')!;
 const selected=new File([new Uint8Array(size)],'avatar',{type});
 Object.defineProperty(input,'files',{value:[selected]});input.dispatchEvent(new Event('change'));await settle();
 expect(el.querySelector('[role=alert]')?.textContent).toContain('2 MB');
 expect(el.querySelector('img')).toBeNull();expect(fixture.save).not.toHaveBeenCalled();
});
