import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {createApp,h,nextTick,type App} from 'vue';
const api=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../src/lib/community',()=>({communityRequest:api.request}));
import {usePublicAppearance,clearAppearanceCache} from '../src/lib/community-appearance';
let app:App,el:HTMLElement;
beforeEach(()=>{clearAppearanceCache();api.request.mockReset();el=document.createElement('div');document.body.append(el);});
afterEach(()=>{app?.unmount();el.remove();});
it('coalesces different authors and duplicate names/avatars into one batch',async()=>{
 api.request.mockResolvedValue({members:{alice:{badges:[],level:1},bob:{badges:[],level:2}}});
 const Child={props:['handle'],setup(props:any){const identity=usePublicAppearance(()=>props.handle);return()=>h('span',identity.value?.level);}};
 app=createApp({render:()=>h('div',[h(Child,{handle:'alice'}),h(Child,{handle:'bob'}),h(Child,{handle:'alice'})])});app.mount(el);
 await new Promise(r=>setTimeout(r,20));await nextTick();
 expect(api.request).toHaveBeenCalledTimes(1);expect(api.request.mock.calls[0][0]).toBe('/community/members?handle=alice&handle=bob');expect(el.textContent).toBe('121');
});
