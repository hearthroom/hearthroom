import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createApp,nextTick,toRaw,type App} from 'vue';
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
 const selected=new File([new Uint8Array(10*1024*1024)],'avatar.'+(type==='image/apng'?'apng':type.split('/')[1]),{type});
 Object.defineProperty(input,'files',{value:[selected],configurable:true});
 input.dispatchEvent(new Event('change'));await settle();
 expect(el.querySelector('[role=alert]')).toBeNull();
 expect(el.querySelector('.profile-avatar img')?.getAttribute('src')).toBe('blob:avatar-test');
 el.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));await settle();
 expect(fixture.save).toHaveBeenCalledTimes(1);
 expect(fixture.save.mock.calls[0][0]).toBe('test');
 // happy-dom's File is reactive in Vue; compare the underlying selected object.
 expect(toRaw(fixture.save.mock.calls[0][1].avatar)===selected).toBe(true);
 expect(revoke).toHaveBeenCalledWith('blob:avatar-test');create.mockRestore();revoke.mockRestore();
});

it.each([
 ['image/gif',10*1024*1024+1],
 ['image/svg+xml',32],
])('rejects invalid avatar %s (%i bytes) without submitting it',async(type,size)=>{
 const input=el.querySelector<HTMLInputElement>('input[type=file]')!;
 const selected=new File([new Uint8Array(size)],'avatar',{type});
 Object.defineProperty(input,'files',{value:[selected]});input.dispatchEvent(new Event('change'));await settle();
 expect(el.querySelector('[role=alert]')?.textContent).toContain('10 MB');
 expect(el.querySelector('.profile-avatar img')).toBeNull();expect(fixture.save).not.toHaveBeenCalled();
});

// 打賞連結：先選平台再填；只打帳號名也行，送出前組成那個平台的個人頁網址
const tipInputs=()=>[...el.querySelectorAll<HTMLInputElement>('input[id^=tip-link-]')];
const type=async(input:HTMLInputElement,value:string)=>{input.value=value;input.dispatchEvent(new Event('input'));await settle();};
const pickPlatform=async(name:string)=>{[...el.querySelectorAll<HTMLButtonElement>('.tips-pick__item')].find(b=>b.textContent!.includes(name))!.click();await settle();};
it('lists the platforms with what each is for, then guides filling the chosen one',async()=>{
 fixture.save.mockResolvedValue(fixture.session.profile);
 const items=[...el.querySelectorAll('.tips-pick__item')];
 expect(items).toHaveLength(7);
 expect(items[0].textContent).toContain('pixiv FANBOX');
 await pickPlatform('Ko-fi');
 expect(el.querySelector('.tips-row__caution')).not.toBeNull();
 expect(el.querySelector<HTMLAnchorElement>('.tips-row__signup')?.href).toBe('https://ko-fi.com/');
 await type(tipInputs()[0],'nightferry');
 expect(el.querySelector('#tip-link-0-msg')?.textContent).toContain('nightferry');
 el.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));await settle();
 expect(fixture.save.mock.calls[0][1].tipLinks).toEqual(['https://ko-fi.com/nightferry']);
});
it('blocks saving while a tip link is unrecognized and stops offering platforms after three',async()=>{
 await pickPlatform('pixiv FANBOX');
 await type(tipInputs()[0],'https://paypal.me/nightferry');
 expect(tipInputs()[0].getAttribute('aria-invalid')).toBe('true');
 el.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));await settle();
 expect(fixture.save).not.toHaveBeenCalled();expect(el.querySelector('[role=alert]')).not.toBeNull();
 const add=()=>el.querySelector<HTMLButtonElement>('.tips-field__add');
 add()!.click();await settle();await pickPlatform('Patreon');
 add()!.click();await settle();await pickPlatform('Fantia');
 expect(tipInputs()).toHaveLength(3);expect(add()).toBeNull();expect(el.querySelector('.tips-pick')).toBeNull();
});
